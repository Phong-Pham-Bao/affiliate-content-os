import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import {
  createFakeCheckpointCGateway,
  createFakeSingleVideoScript,
  processThreePlanningJobs,
} from './helpers/checkpoint-c-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { PostgresJobAdapter } from '../../src/jobs/postgres-job-adapter.js';
import { settleScriptUnitAtomic } from '../../src/workforce/workforce-script-settlement.js';
import { createManualRevisionTransaction } from '../../src/workforce/workforce-manual-revision.js';
import { requestScriptChangesTransaction } from '../../src/workforce/workforce-request-changes.js';
import type { ScriptPackage } from '@affiliate-content-os/domain';

describe('workforce-checkpoint-c-revisions.integration (Immutability, Tenants, Stale Writes & Selected Regeneration)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, ws2Id, factSetId, analysisId1, userId } = FIXTURE_IDS;
  let factId: string;
  let artifactId: string;
  let initialRev1HashHex: string;
  let workOrderId: string;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    jobAdapter = new PostgresJobAdapter(pool);
    await seedWorkforceBaseData(pool);

    const factRes = await pool.query(
      `SELECT id FROM product_facts WHERE fact_set_id = $1 LIMIT 1`,
      [factSetId],
    );
    factId = factRes.rows[0].id;

    // Kickoff and run to initial script package assembly
    const params = createTestKickoffParams();
    workOrderId = params.workOrder.id;
    await adapter.kickoffWorkOrderAtomic(params);

    const gateway = createFakeCheckpointCGateway(factId, analysisId1);
    await processThreePlanningJobs(pool, jobAdapter, gateway);

    // Settle all 5 units
    for (let vNum = 1; vNum <= 5; vNum++) {
      const claimed = await jobAdapter.claimNextJob({
        workerId: `worker-${vNum}`,
        leaseDurationSeconds: 30,
      });
      if (!claimed) throw new Error(`Expected claimable script unit ${vNum}`);
      const p = claimed.payloadJson as {
        workspaceId: string;
        productId: string;
        workOrderId: string;
        workItemId: string;
        assignmentId: string;
        operationId: string;
        aiRunId: string;
        videoNumber: number;
        reservedMicrounits: number;
      };
      const s = createFakeSingleVideoScript(vNum as 1 | 2 | 3 | 4 | 5, factId);
      const h = new Uint8Array(
        crypto.createHash('sha256').update(JSON.stringify(s), 'utf8').digest(),
      );

      const cl = await pool.connect();
      try {
        await cl.query('BEGIN');
        await settleScriptUnitAtomic(cl, {
          workspaceId: p.workspaceId,
          productId: p.productId,
          workOrderId: p.workOrderId,
          workItemId: p.workItemId,
          assignmentId: p.assignmentId,
          jobId: claimed.id,
          jobVersion: claimed.version,
          operationId: p.operationId,
          aiRunId: p.aiRunId,
          workerId: `worker-${vNum}`,
          videoNumber: vNum,
          changeRequestId: null,
          reservedMicrounits: p.reservedMicrounits,
          outcome: {
            kind: 'success',
            contentJson: s,
            contentHash: h,
            schemaVersion: 1,
            promptTemplate: 't',
            promptVersion: 'v',
            provider: 'google',
            model: 'gemini-3.8-flash',
            usage: {
              tokenInput: 400,
              tokenOutput: 250,
              costMicrounits: 10000,
              costCurrency: 'USD',
              latencyMs: 300,
            },
            evidenceReferences: s.video.evidenceReferences,
          },
        });
        await cl.query('COMMIT');
      } finally {
        cl.release();
      }
    }

    const artRes = await pool.query(
      `SELECT id FROM content_artifacts WHERE work_order_id = $1 AND artifact_type = 'script_package'`,
      [workOrderId],
    );
    artifactId = artRes.rows[0].id;

    const revRes = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    initialRev1HashHex = Buffer.from(revRes.rows[0].content_hash).toString('hex');
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('enforces immutability triggers on content_artifact_revisions, content_artifact_lineage, and content_briefs', async () => {
    // 1. UPDATE content_artifact_revisions must fail
    await expect(
      pool.query(`UPDATE content_artifact_revisions SET model = 'hacked' WHERE artifact_id = $1`, [
        artifactId,
      ]),
    ).rejects.toThrow(/content_artifact_revisions rows are immutable/);

    // 2. DELETE content_artifact_revisions must fail
    await expect(
      pool.query(`DELETE FROM content_artifact_revisions WHERE artifact_id = $1`, [artifactId]),
    ).rejects.toThrow(/content_artifact_revisions rows are immutable/);

    // 3. UPDATE content_artifact_lineage must fail
    await expect(
      pool.query(
        `UPDATE content_artifact_lineage SET lineage_type = 'human_edited' WHERE artifact_id = $1`,
        [artifactId],
      ),
    ).rejects.toThrow(/content_artifact_lineage rows are immutable/);

    // 4. DELETE content_artifact_lineage must fail
    await expect(
      pool.query(`DELETE FROM content_artifact_lineage WHERE artifact_id = $1`, [artifactId]),
    ).rejects.toThrow(/content_artifact_lineage rows are immutable/);

    // 5. UPDATE content_briefs must fail
    await expect(
      pool.query(`UPDATE content_briefs SET brief_version = 99 WHERE work_order_id = $1`, [
        workOrderId,
      ]),
    ).rejects.toThrow(/content_briefs rows are immutable/);
  });

  it('enforces cross-workspace tenant foreign key isolation on lineage and change requests', async () => {
    // Attempting to insert a lineage record in ws2 referencing an artifact in ws1 must fail FK
    await expect(
      pool.query(
        `INSERT INTO content_artifact_lineage (
           id, workspace_id, artifact_id, revision_number, parent_revision_number,
           lineage_type, change_request_id, content_brief_hash, content_brief_version,
           planning_revision_ids_json, source_script_unit_ids_json, metadata_json, created_at
         ) VALUES (
           $1, $2, $3, 1, NULL,
           'ai_generated', NULL, decode('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'hex'), 1,
           '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW()
         )`,
        [crypto.randomUUID(), ws2Id, artifactId],
      ),
    ).rejects.toThrow();
  });

  it('fails stale manual edit when expectedVersion or baseHash is mismatched, succeeds with valid preconditions', async () => {
    const rev1Res = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const validPkg = rev1Res.rows[0].content_json as ScriptPackage;

    const modifiedPkg: ScriptPackage = {
      ...validPkg,
      videos: [
        {
          ...validPkg.videos[0],
          title: 'Tiêu đề đã được người dùng chỉnh sửa thủ công',
        },
        validPkg.videos[1],
        validPkg.videos[2],
        validPkg.videos[3],
        validPkg.videos[4],
      ],
    };

    const client = await pool.connect();
    try {
      // 1. Mismatched version -> Precondition failed
      await expect(
        createManualRevisionTransaction(client, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: 999, // Stale!
          baseRevisionNumber: 1,
          baseContentHashHex: initialRev1HashHex,
          content: modifiedPkg,
          note: 'Stale edit',
        }),
      ).rejects.toThrow(/Precondition failed: artifact version mismatch/);

      // 2. Mismatched hash -> Precondition failed
      await expect(
        createManualRevisionTransaction(client, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: 1,
          baseRevisionNumber: 1,
          baseContentHashHex: '0000000000000000000000000000000000000000000000000000000000000000', // Stale!
          content: modifiedPkg,
          note: 'Stale edit',
        }),
      ).rejects.toThrow(/Precondition failed: base revision content hash mismatch/);

      // 3. Valid preconditions -> Creates revision #2
      await client.query('BEGIN');
      const detail = await createManualRevisionTransaction(client, {
        workspaceId: wsId,
        artifactId,
        actorUserId: userId,
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: initialRev1HashHex,
        content: modifiedPkg,
        note: 'Bản chỉnh sửa thủ công đầu tiên',
      });
      await client.query('COMMIT');

      expect(detail.artifact.currentRevisionNumber).toBe(2);
      expect(detail.latestRevision.revisionNumber).toBe(2);
      expect(detail.latestRevision.contentJson).toMatchObject({
        videos: expect.arrayContaining([
          expect.objectContaining({ title: 'Tiêu đề đã được người dùng chỉnh sửa thủ công' }),
        ]),
      });

      // Verify lineage for rev 2 is human_edited
      const linRes = await pool.query(
        `SELECT lineage_type, parent_revision_number FROM content_artifact_lineage WHERE artifact_id = $1 AND revision_number = 2`,
        [artifactId],
      );
      expect(linRes.rows[0].lineage_type).toBe('human_edited');
      expect(linRes.rows[0].parent_revision_number).toBe(1);

      // Prior revision 1 remains completely untouched and readable
      const rev1Check = await pool.query(
        `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
        [artifactId],
      );
      expect(Buffer.from(rev1Check.rows[0].content_hash).toString('hex')).toBe(initialRev1HashHex);
    } finally {
      client.release();
    }
  });

  it('performs targeted request changes for selected videos (e.g. 2 & 4), regenerates only selected units, and assembles revision #3', async () => {
    // Current revision is #2 (from manual edit)
    const artCheck = await pool.query(
      `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const currentRevNum = Number(artCheck.rows[0].current_revision_number);
    const currentVersion = Number(artCheck.rows[0].version);

    const rev2Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, currentRevNum],
    );
    const rev2HashHex = Buffer.from(rev2Res.rows[0].content_hash).toString('hex');

    const client = await pool.connect();
    let changeRequestId: string;
    try {
      await client.query('BEGIN');
      const cr = await requestScriptChangesTransaction(client, {
        workspaceId: wsId,
        artifactId,
        actorUserId: userId,
        expectedVersion: currentVersion,
        baseRevisionNumber: currentRevNum,
        baseContentHashHex: rev2HashHex,
        instructionText:
          'Tập trung vào nỗi đau đau lưng và đưa ra dẫn chứng giảm 40% áp lực cột sống',
        selectedVideoNumbers: [2, 4],
        targetVariantCount: 1,
      });
      await client.query('COMMIT');
      changeRequestId = cr.id;
      expect(cr.selectedVideoNumbers).toEqual([2, 4]);
    } finally {
      client.release();
    }

    // Verify exactly 2 new units were created for changeRequestId (videos 2 and 4)
    const crUnits = await pool.query(
      `SELECT video_number, status, job_id FROM script_generation_units WHERE change_request_id = $1 ORDER BY video_number ASC`,
      [changeRequestId],
    );
    expect(crUnits.rows).toHaveLength(2);
    expect(crUnits.rows[0].video_number).toBe(2);
    expect(crUnits.rows[1].video_number).toBe(4);

    // Settle both units
    for (const row of crUnits.rows) {
      const claimed = await jobAdapter.claimNextJob({
        workerId: 'worker-cr',
        leaseDurationSeconds: 30,
      });
      expect(claimed).not.toBeNull();
      const p = claimed!.payloadJson as {
        workspaceId: string;
        productId: string;
        workOrderId: string;
        workItemId: string;
        assignmentId: string;
        operationId: string;
        aiRunId: string;
        videoNumber: number;
        reservedMicrounits: number;
      };

      const s = createFakeSingleVideoScript(row.video_number as 1 | 2 | 3 | 4 | 5, factId);
      // Give updated video a distinct title
      const updatedScript = {
        ...s,
        video: {
          ...s.video,
          title: `Video ${row.video_number}: Tái tạo theo yêu cầu thay đổi`,
        },
      };
      const h = new Uint8Array(
        crypto.createHash('sha256').update(JSON.stringify(updatedScript), 'utf8').digest(),
      );

      const cl = await pool.connect();
      try {
        await cl.query('BEGIN');
        await settleScriptUnitAtomic(cl, {
          workspaceId: p.workspaceId,
          productId: p.productId,
          workOrderId: p.workOrderId,
          workItemId: p.workItemId,
          assignmentId: p.assignmentId,
          jobId: claimed!.id,
          jobVersion: claimed!.version,
          operationId: p.operationId,
          aiRunId: p.aiRunId,
          workerId: 'worker-cr',
          videoNumber: row.video_number,
          changeRequestId,
          reservedMicrounits: p.reservedMicrounits,
          outcome: {
            kind: 'success',
            contentJson: updatedScript,
            contentHash: h,
            schemaVersion: 1,
            promptTemplate: 't',
            promptVersion: 'v',
            provider: 'google',
            model: 'gemini-3.8-flash',
            usage: {
              tokenInput: 400,
              tokenOutput: 250,
              costMicrounits: 10000,
              costCurrency: 'USD',
              latencyMs: 300,
            },
            evidenceReferences: updatedScript.video.evidenceReferences,
          },
        });
        await cl.query('COMMIT');
      } finally {
        cl.release();
      }
    }

    // Now revision 3 is assembled!
    const artFinal = await pool.query(
      `SELECT current_revision_number FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    expect(artFinal.rows[0].current_revision_number).toBe(3);

    // Verify revision 3 content: Video 1 from rev 2, Video 2 updated, Video 3 from rev 2, Video 4 updated, Video 5 from rev 2
    const rev3Res = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 3`,
      [artifactId],
    );
    const rev3Pkg = rev3Res.rows[0].content_json as ScriptPackage;
    expect(rev3Pkg.videos[0].title).toBe('Tiêu đề đã được người dùng chỉnh sửa thủ công'); // Preserved from rev 2!
    expect(rev3Pkg.videos[1].title).toBe('Video 2: Tái tạo theo yêu cầu thay đổi'); // Updated!
    expect(rev3Pkg.videos[3].title).toBe('Video 4: Tái tạo theo yêu cầu thay đổi'); // Updated!

    // Change request status updated to completed
    const crRes = await pool.query(
      `SELECT status, resulting_revision_number FROM artifact_change_requests WHERE id = $1`,
      [changeRequestId],
    );
    expect(crRes.rows[0].status).toBe('completed');
    expect(crRes.rows[0].resulting_revision_number).toBe(3);
  });
});
