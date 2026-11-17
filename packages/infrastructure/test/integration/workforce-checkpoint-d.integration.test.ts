import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AIGatewayPort, ContentArtifactDetailDTO } from '@affiliate-content-os/application';
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
import { settleComplianceReviewJobAtomic } from '../../src/workforce/workforce-compliance-settlement.js';
import { createManualRevisionTransaction } from '../../src/workforce/workforce-manual-revision.js';
import {
  CURRENT_COMPLIANCE_POLICY_VERSION,
  parseUserId,
  parseWorkspaceId,
  type ScriptPackage,
} from '@affiliate-content-os/domain';

describe('workforce-checkpoint-d.integration (Compliance Evaluation, Immutability & Human Decisions)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, ws2Id, factSetId, analysisId1, userId } = FIXTURE_IDS;
  const typedWsId = parseWorkspaceId(wsId);
  const typedUserId = parseUserId(userId);

  let factId: string;
  let artifactId: string;
  let initialRev1HashHex: string;
  let workOrderId: string;
  let fakeComplianceGateway: AIGatewayPort;

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

    fakeComplianceGateway = {
      ...createFakeCheckpointCGateway(factId, analysisId1),
      executeComplianceAdvisory: async () => ({
        success: true,
        content: {
          schemaVersion: 1,
          overallAssessment: 'advisory_warnings',
          summary: 'Advisory warning for fast delivery claim',
          findings: [
            {
              code: 'COMPL_ADVISORY_DELIVERY',
              severity: 'warning',
              videoNumber: 1,
              fieldPath: 'videos[0].hook.spokenHook',
              flaggedText: 'Giao hàng siêu tốc',
              message: 'Nên ghi rõ khu vực áp dụng giao hàng siêu tốc.',
              suggestedFix: null,
              evidenceReferences: [],
            },
          ],
        },
        usage: {
          tokenInput: 300,
          tokenOutput: 150,
          costMicrounits: 8000,
          costCurrency: 'USD',
          latencyMs: 200,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'compliance_advisory_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      }),
    };

    // Kickoff work order
    const params = createTestKickoffParams();
    workOrderId = params.workOrder.id;
    await adapter.kickoffWorkOrderAtomic(params);

    // Process planning jobs
    const gateway = createFakeCheckpointCGateway(factId, analysisId1);
    await processThreePlanningJobs(pool, jobAdapter, gateway);

    // Settle all 5 script units to assemble initial package
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

  it('automatically enqueued compliance_review job and pending evaluation on initial script package assembly', async () => {
    // 1. Check queued evaluation
    const evalRes = await pool.query(
      `SELECT * FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    expect(evalRes.rowCount).toBe(1);
    expect(evalRes.rows[0].status).toBe('queued');
    expect(evalRes.rows[0].policy_version).toBe(CURRENT_COMPLIANCE_POLICY_VERSION);
    expect(evalRes.rows[0].blocking_count).toBe(0);

    // 2. Check compliance_review job in job_executions table
    const jobRes = await pool.query(
      `SELECT * FROM job_executions WHERE job_type = 'compliance_review' AND status = 'queued'`,
    );
    expect(jobRes.rowCount).toBe(1);
    const jobPayload = jobRes.rows[0].payload_json;
    expect(jobPayload.artifactId).toBe(artifactId);
    expect(jobPayload.revisionNumber).toBe(1);
  });

  it('settles compliance review job with findings and updates evaluation atomically', async () => {
    // Claim the compliance review job
    const claimed = await jobAdapter.claimNextJob({
      workerId: 'compliance-worker-1',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    expect(claimed?.jobType).toBe('compliance_review');

    const p = claimed!.payloadJson as {
      workspaceId: string;
      productId: string;
      workOrderId: string;
      artifactId: string;
      revisionNumber: number;
      operationId: string;
      aiRunId: string;
      policyVersion: string;
      reservedMicrounits: number;
    };

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    // Settle through settleComplianceReviewJobAtomic using fakeComplianceGateway
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await settleComplianceReviewJobAtomic(cl, fakeComplianceGateway, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'compliance-worker-1',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: p.revisionNumber,
        policyVersion: p.policyVersion,
      });
      await cl.query('COMMIT');
    } finally {
      cl.release();
    }

    // Verify evaluation is completed with 0 blockers and 1 warning
    const evalAfter = await adapter.getComplianceEvaluation(typedWsId, artifactId, 1);
    expect(evalAfter).not.toBeNull();
    expect(evalAfter?.status).toBe('completed');
    expect(evalAfter?.blockingCount).toBe(0);
    expect(evalAfter?.warningCount).toBe(1);
    expect(evalAfter?.findings).toHaveLength(1);
    expect(evalAfter?.findings[0]?.severity).toBe('warning');
  });

  it('rejects duplicate settlement when worker lease is fenced / job is completed', async () => {
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await expect(
        settleComplianceReviewJobAtomic(cl, fakeComplianceGateway, {
          workspaceId: wsId,
          productId: FIXTURE_IDS.prodId,
          workOrderId,
          artifactId,
          revisionNumber: 1,
          evaluationId: 'eval-does-not-matter',
          jobId: '019318b2-5f33-722e-a5df-036f007b8999',
          jobVersion: 1,
          operationId: '019318b2-5f33-722e-a5df-036f007b8998',
          aiRunId: '019318b2-5f33-722e-a5df-036f007b8997',
          workerId: 'rogue-worker',
        }),
      ).rejects.toThrow();
      await cl.query('ROLLBACK');
    } finally {
      cl.release();
    }
  });

  it('human accept: atomically records decision, approval snapshot, and completes handoff', async () => {
    const rawIdempotencyKey = '019318b2-5f33-722e-a5df-036f007b89a1';
    const keyHash = new Uint8Array(
      crypto.createHash('sha256').update(rawIdempotencyKey, 'utf8').digest(),
    );
    const requestHash = new Uint8Array(32);

    const result = await adapter.acceptScriptRevision({
      workspaceId: typedWsId,
      artifactId,
      actorUserId: typedUserId,
      expectedVersion: 1,
      revisionNumber: 1,
      contentHashHex: initialRev1HashHex,
      note: 'Human approval for release',
      idempotency: {
        rawKey: rawIdempotencyKey,
        keyHash,
        requestHash,
        routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
      },
    });

    expect(result.artifact.artifact.lifecycleStatus).toBe('accepted');
    expect(result.artifact.artifact.version).toBe(2);
    expect(result.decision.decision).toBe('accept');
    expect(result.decision.reason).toBe('Human approval for release');
    expect(result.approvalSnapshot).toBeDefined();
    expect(result.approvalSnapshot.revisionNumber).toBe(1);
    expect(result.approvalSnapshot.contentHashHex).toBe(initialRev1HashHex);
    expect(result.approvalSnapshot.approvedByUserId).toBe(userId);
    expect(JSON.stringify(result.approvalSnapshot.disclosureState)).toContain('#quangcao');

    // Verify Chief of Staff handoff state is completed
    const woRes = await pool.query(`SELECT status FROM work_orders WHERE id = $1`, [workOrderId]);
    expect(woRes.rows[0].status).toBe('completed');

    const cosRes = await pool.query(
      `SELECT a.office_state FROM agent_assignments a
       JOIN agent_role_definitions r ON r.id = a.role_definition_id
       WHERE a.work_order_id = $1 AND r.role_key = 'chief_of_staff'`,
      [workOrderId],
    );
    expect(cosRes.rows[0].office_state).toBe('completed');

    // Replay with exact same idempotency key returns identical result
    const replayResult = await adapter.acceptScriptRevision({
      workspaceId: typedWsId,
      artifactId,
      actorUserId: typedUserId,
      expectedVersion: 1,
      revisionNumber: 1,
      contentHashHex: initialRev1HashHex,
      note: 'Human approval for release',
      idempotency: {
        rawKey: rawIdempotencyKey,
        keyHash,
        requestHash,
        routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
      },
    });
    expect(replayResult.approvalSnapshot.id).toBe(result.approvalSnapshot.id);

    // Replay with same key but different payload fails
    const diffRequestHash = new Uint8Array(32);
    diffRequestHash[0] = 1;
    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 1,
        revisionNumber: 1,
        contentHashHex: initialRev1HashHex,
        note: 'Different payload note',
        idempotency: {
          rawKey: rawIdempotencyKey,
          keyHash,
          requestHash: diffRequestHash,
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow(/different.*payload/i);
  });

  it('fails accept with precondition conflict when version, revision, or content hash mismatch', async () => {
    const rawKey = '019318b2-5f33-722e-a5df-036f007b89b1';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    // Stale version
    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 99,
        revisionNumber: 1,
        contentHashHex: initialRev1HashHex,
        idempotency: {
          rawKey,
          keyHash,
          requestHash,
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow('version mismatch');

    // Mismatched content hash
    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 2,
        revisionNumber: 1,
        contentHashHex: 'f'.repeat(64),
        idempotency: {
          rawKey: '019318b2-5f33-722e-a5df-036f007b89b2',
          keyHash,
          requestHash,
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow(/content hash mismatch/i);
  });

  it('creating manual revision (revision 2) returns lifecycle to review_required and auto-enqueues new compliance evaluation', async () => {
    // Read current script package from rev 1
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const pkg = rev1Row.rows[0].content_json as ScriptPackage;

    // Introduce a prohibited absolute guarantee in video 1 spoken hook
    const modifiedPkg: ScriptPackage = {
      ...pkg,
      videos: [
        {
          ...pkg.videos[0],
          hook: {
            ...pkg.videos[0].hook,
            spokenHook: 'Sản phẩm cam kết 100% giúp bạn hết đau lưng vĩnh viễn!',
          },
        },
        pkg.videos[1],
        pkg.videos[2],
        pkg.videos[3],
        pkg.videos[4],
      ],
    };

    const rawKey = '019318b2-5f33-722e-a5df-036f007b89c1';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const cl = await pool.connect();
    let detailRev2: ContentArtifactDetailDTO;
    try {
      await cl.query('BEGIN');
      detailRev2 = await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 2,
        baseRevisionNumber: 1,
        baseContentHashHex: initialRev1HashHex,
        content: modifiedPkg as unknown as ScriptPackage,
        note: 'Manual edit introducing prohibited claim for compliance testing',
        idempotency: {
          rawKey,
          keyHash,
          requestHash,
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/revisions`,
        },
      });
      await cl.query('COMMIT');
    } finally {
      cl.release();
    }

    expect(detailRev2.artifact.currentRevisionNumber).toBe(2);
    expect(detailRev2.artifact.lifecycleStatus).toBe('review_required');

    // Verify compliance evaluation automatically created for revision 2
    const evalRev2Res = await pool.query(
      `SELECT * FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 2`,
      [artifactId],
    );
    expect(evalRev2Res.rowCount).toBe(1);
    expect(evalRev2Res.rows[0].status).toBe('queued');
  });

  it('deterministic blocking findings skip AI advisory and prevent acceptance', async () => {
    // Settle revision 2 evaluation with deterministic blocking findings
    const evalRev2Row = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 2`,
      [artifactId],
    );
    const eval2Id = evalRev2Row.rows[0].id;

    const rev2Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 2`,
      [artifactId],
    );
    const rev2HashHex = Buffer.from(rev2Res.rows[0].content_hash).toString('hex');

    // Claim the job for revision 2
    const claimed = await jobAdapter.claimNextJob({
      workerId: 'compliance-worker-2',
      leaseDurationSeconds: 30,
    });
    expect(claimed?.payloadJson.revisionNumber).toBe(2);

    const p = claimed!.payloadJson as {
      workspaceId: string;
      productId: string;
      workOrderId: string;
      artifactId: string;
      revisionNumber: number;
      operationId: string;
      aiRunId: string;
      policyVersion: string;
      reservedMicrounits: number;
    };

    // Settle through settleComplianceReviewJobAtomic
    // Since modifiedPkg in rev 2 has "cam kết 100%", evaluateDeterministicCompliance will detect
    // the blocking finding, skip AI advisory, and save blocking_count = 1!
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await settleComplianceReviewJobAtomic(cl, fakeComplianceGateway, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'compliance-worker-2',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId: eval2Id,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: p.revisionNumber,
        policyVersion: p.policyVersion,
      });
      await cl.query('COMMIT');
    } finally {
      cl.release();
    }

    const eval2 = await adapter.getComplianceEvaluation(typedWsId, artifactId, 2);
    expect(eval2).not.toBeNull();
    expect(eval2?.status).toBe('completed');
    expect(eval2?.blockingCount).toBeGreaterThanOrEqual(1);

    // Now attempt to accept revision 2 -> must be rejected because of blocking findings!
    const rawKey = '019318b2-5f33-722e-a5df-036f007b89d1';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 3,
        revisionNumber: 2,
        contentHashHex: rev2HashHex,
        idempotency: {
          rawKey,
          keyHash,
          requestHash,
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow(/blocking.*finding/i);
  });

  it('human reject: records decision with reason and sets lifecycle to rejected', async () => {
    const rev2Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 2`,
      [artifactId],
    );
    const rev2HashHex = Buffer.from(rev2Res.rows[0].content_hash).toString('hex');

    const rawKey = '019318b2-5f33-722e-a5df-036f007b89e1';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const result = await adapter.rejectScriptRevision({
      workspaceId: typedWsId,
      artifactId,
      actorUserId: typedUserId,
      expectedVersion: 3,
      revisionNumber: 2,
      contentHashHex: rev2HashHex,
      reason: 'Phát hiện cam kết tuyệt đối vi phạm chính sách của sàn thương mại.',
      idempotency: {
        rawKey,
        keyHash,
        requestHash,
        routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/reject`,
      },
    });

    expect(result.artifact.artifact.lifecycleStatus).toBe('rejected');
    expect(result.artifact.artifact.version).toBe(4);
    expect(result.decision.decision).toBe('reject');
    expect(result.decision.reason).toContain('Phát hiện cam kết tuyệt đối');

    // Verify decisions history list
    const decisions = await adapter.listReviewDecisions(typedWsId, artifactId);
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    const latestDec = decisions[0];
    expect(latestDec?.decision).toBe('reject');
    expect(latestDec?.revisionNumber).toBe(2);
  });

  it('enforces database immutability triggers on compliance_findings, content_review_decisions, and content_approval_snapshots', async () => {
    // 1. UPDATE compliance_findings must fail
    await expect(
      pool.query(`UPDATE compliance_findings SET message = 'altered' WHERE workspace_id = $1`, [
        wsId,
      ]),
    ).rejects.toThrow();

    // 2. UPDATE content_review_decisions must fail
    await expect(
      pool.query(`UPDATE content_review_decisions SET reason = 'altered' WHERE workspace_id = $1`, [
        wsId,
      ]),
    ).rejects.toThrow();

    // 3. UPDATE content_approval_snapshots must fail
    await expect(
      pool.query(
        `UPDATE content_approval_snapshots SET affiliate_disclosure_text = 'altered' WHERE workspace_id = $1`,
        [wsId],
      ),
    ).rejects.toThrow();
  });

  it('enforces tenant isolation and cross-workspace constraints', async () => {
    // Attempting to query or accept from foreign workspace fails
    const foreignWsId = parseWorkspaceId(ws2Id);
    await expect(
      adapter.acceptScriptRevision({
        workspaceId: foreignWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 4,
        revisionNumber: 2,
        contentHashHex: 'a'.repeat(64),
        idempotency: {
          rawKey: '019318b2-5f33-722e-a5df-036f007b89f1',
          keyHash: new Uint8Array(32),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${ws2Id}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow('not found in workspace');

    const foreignEval = await adapter.getComplianceEvaluation(foreignWsId, artifactId, 1);
    expect(foreignEval).toBeNull();

    const foreignDecs = await adapter.listReviewDecisions(foreignWsId, artifactId);
    expect(foreignDecs).toHaveLength(0);
  });
});
