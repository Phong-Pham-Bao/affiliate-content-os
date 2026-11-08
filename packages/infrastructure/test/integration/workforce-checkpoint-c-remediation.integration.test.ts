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
import { assembleScriptPackageInitialAtomic } from '../../src/workforce/workforce-script-assembly.js';
import { generateUuidV7, IdempotencyKeyReusedError } from '@affiliate-content-os/application';
import type { ScriptPackage } from '@affiliate-content-os/domain';

describe('workforce-checkpoint-c-remediation.integration (Hardening, Fencing, Idempotency & Provenance)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, ws2Id, factSetId, analysisId1, userId } = FIXTURE_IDS;
  let factId: string;
  let workOrderId: string;
  let artifactId: string;

  function makeTestIdemp(routeKey: string, key = 'test-idemp-key') {
    const rawKey = `${key}-${Date.now()}-${Math.random()}`;
    return {
      rawKey,
      keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      requestHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      routeKey,
    };
  }

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

    // Kickoff work order
    const params = createTestKickoffParams();
    workOrderId = params.workOrder.id;
    await adapter.kickoffWorkOrderAtomic(params);

    const gateway = createFakeCheckpointCGateway(factId, analysisId1);
    await processThreePlanningJobs(pool, jobAdapter, gateway);

    // Settle 5 initial units
    for (let vNum = 1; vNum <= 5; vNum++) {
      const claimed = await jobAdapter.claimNextJob({
        workerId: `worker-${vNum}`,
        leaseDurationSeconds: 30,
      });
      expect(claimed).not.toBeNull();
      const p = claimed!.payloadJson as Record<string, unknown>;
      const s = createFakeSingleVideoScript(vNum as 1 | 2 | 3 | 4 | 5, factId);
      const h = new Uint8Array(
        crypto.createHash('sha256').update(JSON.stringify(s), 'utf8').digest(),
      );

      const cl = await pool.connect();
      try {
        await cl.query('BEGIN');
        await settleScriptUnitAtomic(cl, {
          workspaceId: wsId,
          productId: p.productId as string,
          workOrderId: p.workOrderId as string,
          workItemId: p.workItemId as string,
          assignmentId: p.assignmentId as string,
          jobId: claimed!.id,
          jobVersion: claimed!.version,
          operationId: p.operationId as string,
          aiRunId: p.aiRunId as string,
          workerId: `worker-${vNum}`,
          videoNumber: vNum,
          changeRequestId: null,
          reservedMicrounits: p.reservedMicrounits as number,
          outcome: {
            kind: 'success',
            contentJson: s,
            contentHash: h,
            schemaVersion: 1,
            promptTemplate: 'scriptwriting',
            promptVersion: '1.0.0',
            provider: 'google',
            model: 'gemini-3.8-flash',
            usage: {
              tokenInput: 500,
              tokenOutput: 300,
              costMicrounits: 5000,
              costCurrency: 'USD',
              latencyMs: 400,
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
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  describe('1. Stale Lease Fencing on Every Settlement Outcome', () => {
    it('fences success settlement when workerId does not match lease_owner or version is stale', async () => {
      // Claim job
      const claimRes = await pool.query(
        `SELECT id, version, lease_owner, operation_id, ai_run_id, work_order_id, work_item_id, reserved_spend_microunits
         FROM job_executions
         WHERE workspace_id = $1 AND job_type = 'scriptwriting'
         LIMIT 1`,
        [wsId],
      );
      const j = claimRes.rows[0];

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Wrong workerId
        await expect(
          settleScriptUnitAtomic(client, {
            workspaceId: wsId,
            productId: FIXTURE_IDS.prodId,
            workOrderId: j.work_order_id,
            workItemId: j.work_item_id,
            assignmentId: generateUuidV7(),
            jobId: j.id,
            jobVersion: Number(j.version),
            operationId: j.operation_id,
            aiRunId: j.ai_run_id,
            workerId: 'imposter-worker-id',
            videoNumber: 1,
            changeRequestId: null,
            reservedMicrounits: Number(j.reserved_spend_microunits),
            outcome: {
              kind: 'success',
              contentJson: createFakeSingleVideoScript(1, factId),
              contentHash: new Uint8Array(32),
              schemaVersion: 1,
              promptTemplate: 't',
              promptVersion: 'v',
              provider: 'google',
              model: 'gemini-3.8-flash',
              usage: {
                tokenInput: 10,
                tokenOutput: 10,
                costMicrounits: 100,
                costCurrency: 'USD',
                latencyMs: 1,
              },
              evidenceReferences: [],
            },
          }),
        ).rejects.toThrow(/Lease fencing conflict on job/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('fences transient_failure settlement when job version is stale', async () => {
      const claimRes = await pool.query(
        `SELECT id, version, operation_id, ai_run_id, work_order_id, work_item_id, reserved_spend_microunits
         FROM job_executions
         WHERE workspace_id = $1 AND job_type = 'scriptwriting'
         LIMIT 1`,
        [wsId],
      );
      const j = claimRes.rows[0];

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          settleScriptUnitAtomic(client, {
            workspaceId: wsId,
            productId: FIXTURE_IDS.prodId,
            workOrderId: j.work_order_id,
            workItemId: j.work_item_id,
            assignmentId: generateUuidV7(),
            jobId: j.id,
            jobVersion: 99999, // Stale version!
            operationId: j.operation_id,
            aiRunId: j.ai_run_id,
            workerId: 'worker-1',
            videoNumber: 1,
            changeRequestId: null,
            reservedMicrounits: Number(j.reserved_spend_microunits),
            outcome: {
              kind: 'transient_failure',
              errorCategory: 'rate_limited',
              errorMessage: 'Rate limit hit',
              nextAttemptAt: new Date(Date.now() + 5000),
            },
          }),
        ).rejects.toThrow(/Lease fencing conflict on job/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('fences repair settlement when job status is not running', async () => {
      const claimRes = await pool.query(
        `SELECT id, version, operation_id, ai_run_id, work_order_id, work_item_id, reserved_spend_microunits
         FROM job_executions
         WHERE workspace_id = $1 AND job_type = 'scriptwriting'
         LIMIT 1`,
        [wsId],
      );
      const j = claimRes.rows[0];

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Job status in database is already succeeded or queued, not running with worker-99
        await expect(
          settleScriptUnitAtomic(client, {
            workspaceId: wsId,
            productId: FIXTURE_IDS.prodId,
            workOrderId: j.work_order_id,
            workItemId: j.work_item_id,
            assignmentId: generateUuidV7(),
            jobId: j.id,
            jobVersion: Number(j.version),
            operationId: j.operation_id,
            aiRunId: j.ai_run_id,
            workerId: 'worker-99',
            videoNumber: 1,
            changeRequestId: null,
            reservedMicrounits: Number(j.reserved_spend_microunits),
            outcome: {
              kind: 'repair',
              errorCategory: 'invalid_output',
              errorMessage: 'Missing hook',
              repairDelaySeconds: 1,
            },
          }),
        ).rejects.toThrow(/Lease fencing conflict on job/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('fences terminal_failure settlement: stale worker rolls back completely without releasing budget or failing work order', async () => {
      const claimRes = await pool.query(
        `SELECT id, version, operation_id, ai_run_id, work_order_id, work_item_id, reserved_spend_microunits
         FROM job_executions
         WHERE workspace_id = $1 AND job_type = 'scriptwriting'
         LIMIT 1`,
        [wsId],
      );
      const j = claimRes.rows[0];

      // Get policy spend before
      const policyBefore = await pool.query(
        `SELECT reserved_spend_microunits, current_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
        [wsId],
      );

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          settleScriptUnitAtomic(client, {
            workspaceId: wsId,
            productId: FIXTURE_IDS.prodId,
            workOrderId: j.work_order_id,
            workItemId: j.work_item_id,
            assignmentId: generateUuidV7(),
            jobId: j.id,
            jobVersion: 99999, // Stale!
            operationId: j.operation_id,
            aiRunId: j.ai_run_id,
            workerId: 'stale-worker',
            videoNumber: 1,
            changeRequestId: null,
            reservedMicrounits: 50000,
            outcome: {
              kind: 'terminal_failure',
              errorCategory: 'internal_error',
              errorCode: 'STALE_TEST',
              errorMessage: 'Stale worker terminal fail',
            },
          }),
        ).rejects.toThrow(/Lease fencing conflict on job/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Verify budget spend was NOT released
      const policyAfter = await pool.query(
        `SELECT reserved_spend_microunits, current_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
        [wsId],
      );
      expect(policyAfter.rows[0].reserved_spend_microunits).toBe(
        policyBefore.rows[0].reserved_spend_microunits,
      );
      expect(policyAfter.rows[0].current_spend_microunits).toBe(
        policyBefore.rows[0].current_spend_microunits,
      );

      // Verify work order was NOT failed
      const woRes = await pool.query(`SELECT status FROM work_orders WHERE id = $1`, [
        j.work_order_id,
      ]);
      expect(woRes.rows[0].status).not.toBe('failed');
    });
  });

  describe('2. Mutation Idempotency & Replay', () => {
    it('creates manual revision once on first call and replays cached result on same idempotency key', async () => {
      const artRes = await pool.query(
        `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
        [artifactId],
      );
      const curRev = Number(artRes.rows[0].current_revision_number);
      const curVer = Number(artRes.rows[0].version);

      const curContentRes = await pool.query(
        `SELECT content_json, content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
        [artifactId, curRev],
      );
      const curContent = curContentRes.rows[0].content_json as ScriptPackage;
      const curHashHex = Buffer.from(curContentRes.rows[0].content_hash).toString('hex');

      const updatedPackage: ScriptPackage = {
        ...curContent,
        seriesTitle: 'Updated by Idempotency Test',
      };

      const key = `manual-rev-key-${Date.now()}`;
      const idempParam = {
        rawKey: key,
        keyHash: new Uint8Array(crypto.createHash('sha256').update(key).digest()),
        requestHash: new Uint8Array(
          crypto
            .createHash('sha256')
            .update(
              JSON.stringify({
                artifactId,
                baseContentHashHex: curHashHex,
                baseRevisionNumber: curRev,
                content: updatedPackage,
                expectedVersion: curVer,
                note: 'Idempotency test note',
                workspaceId: wsId,
              }),
            )
            .digest(),
        ),
        routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/revisions`,
      };

      const client = await pool.connect();
      let firstResult: Awaited<ReturnType<typeof createManualRevisionTransaction>> | undefined;
      try {
        await client.query('BEGIN');
        firstResult = await createManualRevisionTransaction(client, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: curVer,
          baseRevisionNumber: curRev,
          baseContentHashHex: curHashHex,
          content: updatedPackage,
          note: 'Idempotency test note',
          idempotency: idempParam,
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const newRevNum = firstResult.latestRevision.revisionNumber;
      expect(newRevNum).toBe(curRev + 1);

      // Replay identical call with exact same idempotency key
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        const replayedResult = await createManualRevisionTransaction(client2, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: curVer,
          baseRevisionNumber: curRev,
          baseContentHashHex: curHashHex,
          content: updatedPackage,
          note: 'Idempotency test note',
          idempotency: idempParam,
        });
        await client2.query('COMMIT');

        expect(replayedResult.latestRevision.revisionNumber).toBe(newRevNum);
        expect(replayedResult.artifact.id).toBe(artifactId);
      } finally {
        client2.release();
      }

      // Verify no extra revision was created
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
        [artifactId, newRevNum],
      );
      expect(Number(countRes.rows[0].count)).toBe(1);

      // Same key with different payload throws IdempotencyKeyReusedError
      const client3 = await pool.connect();
      try {
        await client3.query('BEGIN');
        const conflictingIdemp = {
          ...idempParam,
          requestHash: new Uint8Array(32).fill(0xee), // Different payload hash!
        };
        await expect(
          createManualRevisionTransaction(client3, {
            workspaceId: wsId,
            artifactId,
            actorUserId: userId,
            expectedVersion: curVer,
            baseRevisionNumber: curRev,
            baseContentHashHex: curHashHex,
            content: { ...updatedPackage, seriesTitle: 'Conflict title' },
            note: 'Conflict note',
            idempotency: conflictingIdemp,
          }),
        ).rejects.toThrow(IdempotencyKeyReusedError);
        await client3.query('ROLLBACK');
      } finally {
        client3.release();
      }
    });

    it('creates request changes once and replays cached result on same key without reserving budget twice', async () => {
      const artRes = await pool.query(
        `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
        [artifactId],
      );
      const curRev = Number(artRes.rows[0].current_revision_number);
      const curVer = Number(artRes.rows[0].version);

      const curContentRes = await pool.query(
        `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
        [artifactId, curRev],
      );
      const curHashHex = Buffer.from(curContentRes.rows[0].content_hash).toString('hex');

      const policyBefore = await pool.query(
        `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
        [wsId],
      );
      const reservedBefore = Number(policyBefore.rows[0].reserved_spend_microunits);

      const key = `req-changes-key-${Date.now()}`;
      const idempParam = {
        rawKey: key,
        keyHash: new Uint8Array(crypto.createHash('sha256').update(key).digest()),
        requestHash: new Uint8Array(crypto.createHash('sha256').update(key).digest()),
        routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/request-changes`,
      };

      const client = await pool.connect();
      let crResult: Awaited<ReturnType<typeof requestScriptChangesTransaction>> | undefined;
      try {
        await client.query('BEGIN');
        crResult = await requestScriptChangesTransaction(client, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: curVer,
          baseRevisionNumber: curRev,
          baseContentHashHex: curHashHex,
          instructionText: 'Tăng tính thuyết phục của hook ở video 1',
          selectedVideoNumbers: [1],
          targetVariantCount: 1,
          idempotency: idempParam,
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      // Budget increased by 1 unit reservation
      const policyAfterFirst = await pool.query(
        `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
        [wsId],
      );
      expect(Number(policyAfterFirst.rows[0].reserved_spend_microunits)).toBe(
        reservedBefore + 10000,
      );

      // Replay identical call with exact same idempotency key
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        const replayed = await requestScriptChangesTransaction(client2, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: curVer,
          baseRevisionNumber: curRev,
          baseContentHashHex: curHashHex,
          instructionText: 'Tăng tính thuyết phục của hook ở video 1',
          selectedVideoNumbers: [1],
          targetVariantCount: 1,
          idempotency: idempParam,
        });
        await client2.query('COMMIT');

        expect(replayed.id).toBe(crResult.id);
      } finally {
        client2.release();
      }

      // Budget was NOT reserved a second time
      const policyAfterSecond = await pool.query(
        `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
        [wsId],
      );
      expect(Number(policyAfterSecond.rows[0].reserved_spend_microunits)).toBe(
        reservedBefore + 10000,
      );

      // Replay with different payload throws IdempotencyKeyReusedError
      const client3 = await pool.connect();
      try {
        await client3.query('BEGIN');
        const conflictingIdemp = {
          ...idempParam,
          requestHash: new Uint8Array(32).fill(0xcc),
        };
        await expect(
          requestScriptChangesTransaction(client3, {
            workspaceId: wsId,
            artifactId,
            actorUserId: userId,
            expectedVersion: curVer,
            baseRevisionNumber: curRev,
            baseContentHashHex: curHashHex,
            instructionText: 'Different instruction text',
            selectedVideoNumbers: [1],
            targetVariantCount: 1,
            idempotency: conflictingIdemp,
          }),
        ).rejects.toThrow(IdempotencyKeyReusedError);
        await client3.query('ROLLBACK');
      } finally {
        client3.release();
      }
    });
  });

  describe('3. Concurrent Revision Races (Targeted Regeneration vs Newer Content)', () => {
    it('assembly detects stale base when manual edit completes before change request and fails change request honestly without overwriting', async () => {
      // 1. Get current artifact state
      const artRes = await pool.query(
        `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
        [artifactId],
      );
      const baseRev = Number(artRes.rows[0].current_revision_number);
      const baseVer = Number(artRes.rows[0].version);

      const baseRevRes = await pool.query(
        `SELECT content_hash, content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
        [artifactId, baseRev],
      );
      const baseHashHex = Buffer.from(baseRevRes.rows[0].content_hash).toString('hex');
      const baseContent = baseRevRes.rows[0].content_json as ScriptPackage;

      // 2. Create Change Request A against baseRev
      const clientA = await pool.connect();
      let crAId: string;
      try {
        await clientA.query('BEGIN');
        const crA = await requestScriptChangesTransaction(clientA, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: baseVer,
          baseRevisionNumber: baseRev,
          baseContentHashHex: baseHashHex,
          instructionText: 'CR-A instruction for video 3',
          selectedVideoNumbers: [3],
          targetVariantCount: 1,
          idempotency: makeTestIdemp('cr-a'),
        });
        await clientA.query('COMMIT');
        crAId = crA.id;
      } finally {
        clientA.release();
      }

      // 3. Meanwhile, a manual edit races and creates newer revision (baseRev + 1)
      const manualClient = await pool.connect();
      try {
        await manualClient.query('BEGIN');
        const manualPkg: ScriptPackage = {
          ...baseContent,
          seriesTitle: 'Manual Edit Won The Race',
        };
        await createManualRevisionTransaction(manualClient, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: baseVer,
          baseRevisionNumber: baseRev,
          baseContentHashHex: baseHashHex,
          content: manualPkg,
          note: 'Racing manual edit',
          idempotency: makeTestIdemp('manual-racing-key'),
        });
        await manualClient.query('COMMIT');
      } finally {
        manualClient.release();
      }

      // Current revision of artifact is now (baseRev + 1)
      const artCheck = await pool.query(
        `SELECT current_revision_number FROM content_artifacts WHERE id = $1`,
        [artifactId],
      );
      const newerRevNum = Number(artCheck.rows[0].current_revision_number);
      expect(newerRevNum).toBe(baseRev + 1);

      // 4. Settle CR-A unit for video 3
      const unitRes = await pool.query(
        `SELECT id, job_id, operation_id, ai_run_id FROM script_generation_units WHERE change_request_id = $1 AND video_number = 3`,
        [crAId],
      );
      const unitA = unitRes.rows[0];

      // Claim and settle CR-A job
      await pool.query(
        `UPDATE job_executions SET status = 'running', lease_owner = 'cr-worker', lease_expires_at = NOW() + INTERVAL '1 hour', started_at = NOW() WHERE id = $1`,
        [unitA.job_id],
      );
      const jobRes = await pool.query(`SELECT version FROM job_executions WHERE id = $1`, [
        unitA.job_id,
      ]);

      const s = createFakeSingleVideoScript(3, factId);
      const h = new Uint8Array(
        crypto.createHash('sha256').update(JSON.stringify(s), 'utf8').digest(),
      );

      const settleClient = await pool.connect();
      try {
        await settleClient.query('BEGIN');
        await settleScriptUnitAtomic(settleClient, {
          workspaceId: wsId,
          productId: FIXTURE_IDS.prodId,
          workOrderId,
          workItemId: generateUuidV7(),
          assignmentId: generateUuidV7(),
          jobId: unitA.job_id,
          jobVersion: Number(jobRes.rows[0].version),
          operationId: unitA.operation_id,
          aiRunId: unitA.ai_run_id,
          workerId: 'cr-worker',
          videoNumber: 3,
          changeRequestId: crAId,
          reservedMicrounits: 10000,
          outcome: {
            kind: 'success',
            contentJson: s,
            contentHash: h,
            schemaVersion: 1,
            promptTemplate: 'scriptwriting',
            promptVersion: '1.0.0',
            provider: 'google',
            model: 'gemini-3.8-flash',
            usage: {
              tokenInput: 100,
              tokenOutput: 100,
              costMicrounits: 5000,
              costCurrency: 'USD',
              latencyMs: 50,
            },
            evidenceReferences: s.video.evidenceReferences,
          },
        });
        await settleClient.query('COMMIT');
      } finally {
        settleClient.release();
      }

      // 5. Verify that CR-A failed honestly due to stale base and did NOT overwrite newer revision
      const crACheck = await pool.query(
        `SELECT status, failure_reason, resulting_revision_number FROM artifact_change_requests WHERE id = $1`,
        [crAId],
      );
      expect(crACheck.rows[0].status).toBe('failed');
      expect(crACheck.rows[0].failure_reason).toContain('Stale base revision');
      expect(crACheck.rows[0].resulting_revision_number).toBeNull();

      // Newer revision remains the current revision
      const artAfter = await pool.query(
        `SELECT current_revision_number FROM content_artifacts WHERE id = $1`,
        [artifactId],
      );
      expect(Number(artAfter.rows[0].current_revision_number)).toBe(newerRevNum);
    });
  });

  describe('4. Authoritative Context Drift & Evidence Validation', () => {
    it('fails closed when planning revision changes before script package assembly', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Mutate a planning artifact revision number in transaction to simulate drift
        await client.query(
          `UPDATE content_artifacts
           SET current_revision_number = current_revision_number + 1
           WHERE work_order_id = $1 AND artifact_type = 'video_series_plan'`,
          [workOrderId],
        );

        await expect(
          assembleScriptPackageInitialAtomic(client, {
            workspaceId: wsId,
            productId: FIXTURE_IDS.prodId,
            workOrderId,
            workItemId: generateUuidV7(),
            assignmentId: generateUuidV7(),
          }),
        ).rejects.toThrow(/Authoritative context drift/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects manual revision with nested video evidence not declared in package-level evidence', async () => {
      const artRes = await pool.query(
        `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
        [artifactId],
      );
      const curRev = Number(artRes.rows[0].current_revision_number);
      const curVer = Number(artRes.rows[0].version);

      const curContentRes = await pool.query(
        `SELECT content_json, content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
        [artifactId, curRev],
      );
      const curContent = curContentRes.rows[0].content_json as ScriptPackage;
      const curHashHex = Buffer.from(curContentRes.rows[0].content_hash).toString('hex');

      // Video 1 references factId, but package-level evidenceReferences is EMPTY
      const invalidPkg: ScriptPackage = {
        ...curContent,
        videos: [
          {
            ...curContent.videos[0],
            evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
          },
          curContent.videos[1],
          curContent.videos[2],
          curContent.videos[3],
          curContent.videos[4],
        ],
        evidenceReferences: [], // Omitted at package level!
      };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          createManualRevisionTransaction(client, {
            workspaceId: wsId,
            artifactId,
            actorUserId: userId,
            expectedVersion: curVer,
            baseRevisionNumber: curRev,
            baseContentHashHex: curHashHex,
            content: invalidPkg,
            idempotency: makeTestIdemp('nested-evidence-test'),
          }),
        ).rejects.toThrow(/not declared in package evidenceReferences/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects manual revision referencing a fact from another workspace or product', async () => {
      const artRes = await pool.query(
        `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
        [artifactId],
      );
      const curRev = Number(artRes.rows[0].current_revision_number);
      const curVer = Number(artRes.rows[0].version);

      const curContentRes = await pool.query(
        `SELECT content_json, content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
        [artifactId, curRev],
      );
      const curContent = curContentRes.rows[0].content_json as ScriptPackage;
      const curHashHex = Buffer.from(curContentRes.rows[0].content_hash).toString('hex');

      const foreignFactId = generateUuidV7();
      const invalidPkg: ScriptPackage = {
        ...curContent,
        videos: [
          {
            ...curContent.videos[0],
            evidenceReferences: [{ sourceKind: 'product_fact', sourceId: foreignFactId }],
          },
          curContent.videos[1],
          curContent.videos[2],
          curContent.videos[3],
          curContent.videos[4],
        ],
        evidenceReferences: [{ sourceKind: 'product_fact', sourceId: foreignFactId }],
      };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          createManualRevisionTransaction(client, {
            workspaceId: wsId,
            artifactId,
            actorUserId: userId,
            expectedVersion: curVer,
            baseRevisionNumber: curRev,
            baseContentHashHex: curHashHex,
            content: invalidPkg,
            idempotency: makeTestIdemp('foreign-fact-test'),
          }),
        ).rejects.toThrow(/Evidence validation failed/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });

  describe('5. Database Constraints & Unit Uniqueness (Migration 0011)', () => {
    it('enforces composite workspace foreign key from script_generation_units to operations', async () => {
      // Find valid work_item_id, change_request_id, ai_run_id, and job_id from wsId
      const crRes = await pool.query(
        `SELECT id, artifact_id FROM artifact_change_requests WHERE workspace_id = $1 LIMIT 1`,
        [wsId],
      );
      const crId = crRes.rows[0].id;
      const unitSample = await pool.query(
        `SELECT work_item_id, ai_run_id, job_id FROM script_generation_units WHERE workspace_id = $1 LIMIT 1`,
        [wsId],
      );
      const { work_item_id: wiId, ai_run_id: aiRunId, job_id: jobId } = unitSample.rows[0];

      // Insert a product and operation in another workspace (ws2Id)
      const foreignProdId = generateUuidV7();
      await pool.query(
        `INSERT INTO products (
           id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
           category, description, status, current_fact_set_id, created_at, updated_at, version
         ) VALUES ($1, $2, 'WF Product 2', 'Merchant', 'https://example.com/wf2', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
        [foreignProdId, ws2Id, new Uint8Array(32)],
      );

      const foreignOpId = generateUuidV7();
      await pool.query(
        `INSERT INTO operations (
           id, workspace_id, operation_type, resource_type, resource_id, status, requested_by_user_id, created_at, updated_at
         ) VALUES ($1, $2, 'scriptwriting', 'product', $3, 'queued', $4, NOW(), NOW())`,
        [foreignOpId, ws2Id, foreignProdId, userId],
      );

      await expect(
        pool.query(
          `INSERT INTO script_generation_units (
             id, workspace_id, work_order_id, work_item_id, video_number,
             change_request_id, status, operation_id, ai_run_id, job_id, brief_hash, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, 5,
             $5, 'queued', $6, $7, $8, $9, NOW(), NOW()
           )`,
          [
            generateUuidV7(),
            wsId,
            workOrderId,
            wiId,
            crId,
            foreignOpId, // Exists in operations, but belongs to ws2Id!
            aiRunId,
            jobId,
            new Uint8Array(32),
          ],
        ),
      ).rejects.toThrow(/script_generation_units_ws_operation_fk/);
    });

    it('enforces uniqueness on initial video units (WHERE change_request_id IS NULL)', async () => {
      // Find an existing initial unit for video 1 in this work order
      const unitRes = await pool.query(
        `SELECT operation_id, ai_run_id, job_id, work_item_id, brief_hash
         FROM script_generation_units
         WHERE workspace_id = $1 AND work_order_id = $2 AND video_number = 1 AND change_request_id IS NULL`,
        [wsId, workOrderId],
      );
      const u = unitRes.rows[0];

      // Attempt duplicate initial unit for video 1
      await expect(
        pool.query(
          `INSERT INTO script_generation_units (
             id, workspace_id, work_order_id, work_item_id, video_number,
             change_request_id, status, operation_id, ai_run_id, job_id, brief_hash, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, 1,
             NULL, 'queued', $5, $6, $7, $8, NOW(), NOW()
           )`,
          [
            generateUuidV7(),
            wsId,
            workOrderId,
            u.work_item_id,
            u.operation_id,
            u.ai_run_id,
            u.job_id,
            u.brief_hash,
          ],
        ),
      ).rejects.toThrow(/uq_script_gen_units_initial/);
    });

    it('enforces uniqueness on change-request video units (WHERE change_request_id IS NOT NULL)', async () => {
      // Find an existing change request unit
      const crUnitRes = await pool.query(
        `SELECT change_request_id, video_number, operation_id, ai_run_id, job_id, work_item_id, brief_hash
         FROM script_generation_units
         WHERE workspace_id = $1 AND change_request_id IS NOT NULL
         LIMIT 1`,
        [wsId],
      );
      if (crUnitRes.rows[0]) {
        const u = crUnitRes.rows[0];
        await expect(
          pool.query(
            `INSERT INTO script_generation_units (
               id, workspace_id, work_order_id, work_item_id, video_number,
               change_request_id, status, operation_id, ai_run_id, job_id, brief_hash, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5,
               $6, 'queued', $7, $8, $9, $10, NOW(), NOW()
             )`,
            [
              generateUuidV7(),
              wsId,
              workOrderId,
              u.work_item_id,
              u.video_number,
              u.change_request_id,
              u.operation_id,
              u.ai_run_id,
              u.job_id,
              u.brief_hash,
            ],
          ),
        ).rejects.toThrow(/uq_script_gen_units_change_request/);
      }
    });

    it('enforces lineage constraint rejecting change request from another artifact or workspace', async () => {
      const testRevNum = 999;
      await pool.query(
        `INSERT INTO content_artifact_revisions (
           id, workspace_id, artifact_id, revision_number, author_role_key,
           schema_version, prompt_template, prompt_version, provider, model,
           content_json, content_hash, created_at
         ) VALUES (
           $1, $2, $3, $4, 'scriptwriter',
           1, 't', 'v', 'google', 'gemini-3.8-flash',
           '{}'::jsonb, $5, NOW()
         )`,
        [generateUuidV7(), wsId, artifactId, testRevNum, new Uint8Array(32)],
      );

      const foreignCrId = generateUuidV7();
      await expect(
        pool.query(
          `INSERT INTO content_artifact_lineage (
             id, workspace_id, artifact_id, revision_number, parent_revision_number,
             lineage_type, change_request_id, content_brief_hash, content_brief_version,
             created_at
           ) VALUES (
             $1, $2, $3, $4, 1,
             'change_request', $5, $6, 1, NOW()
           )`,
          [generateUuidV7(), wsId, artifactId, testRevNum, foreignCrId, new Uint8Array(32)],
        ),
      ).rejects.toThrow(/content_artifact_lineage_ws_art_change_req_fk/);
    });
  });

  describe('6. Provider Provenance & Lineage Persistence', () => {
    it('persists real provider provenance, actual model, and token/cost accounting in artifact revision and lineage', async () => {
      const revRes = await pool.query(
        `SELECT provider, model, prompt_template, prompt_version, token_input, token_output, cost_microunits
         FROM content_artifact_revisions
         WHERE artifact_id = $1 AND revision_number = 1`,
        [artifactId],
      );
      const rev = revRes.rows[0];
      expect(rev.provider).toBe('google');
      expect(rev.model).toBe('gemini-3.8-flash');
      expect(rev.prompt_template).toBe('scriptwriting');
      expect(Number(rev.token_input)).toBeGreaterThan(0);
      expect(Number(rev.cost_microunits)).toBeGreaterThan(0);

      const linRes = await pool.query(
        `SELECT planning_revision_ids_json, metadata_json FROM content_artifact_lineage WHERE artifact_id = $1 AND revision_number = 1`,
        [artifactId],
      );
      const planningIds = linRes.rows[0].planning_revision_ids_json;
      expect(planningIds).toHaveProperty('productCampaignPlanRevisionId');
      expect(planningIds).toHaveProperty('audienceInsightBoardRevisionId');
      expect(planningIds).toHaveProperty('videoSeriesPlanRevisionId');

      const meta = linRes.rows[0].metadata_json;
      expect(meta.provenance.provider).toBe('google');
      expect(meta.usage.costMicrounits).toBeGreaterThan(0);
    });
  });
});
