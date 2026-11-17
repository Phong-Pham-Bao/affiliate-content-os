import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AIGatewayPort,
  ContentArtifactDetailDTO,
  ExecuteComplianceAdvisoryResult,
} from '@affiliate-content-os/application';
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
import {
  prepareComplianceReviewExecution,
  settleComplianceBudgetExhaustedAtomic,
  settleComplianceDriftAtomic,
  settleComplianceMalformedJobAtomic,
  settleCompliancePreflightBlockerAtomic,
  settleComplianceReviewExecutionAtomic,
} from '../../src/workforce/workforce-compliance-settlement.js';
import { createManualRevisionTransaction } from '../../src/workforce/workforce-manual-revision.js';
import { DatabaseError } from '../../src/database/errors.js';
import {
  generateUuidV7,
  ComplianceEvaluationNotApprovableError,
  ComplianceEvaluationStaleError,
  JobLeaseExpiredError,
} from '@affiliate-content-os/application';
import {
  CURRENT_COMPLIANCE_POLICY_VERSION,
  computeCompliancePolicyHash,
  evaluateDeterministicCompliance,
  parseUserId,
  parseWorkspaceId,
  type ComplianceReportContent,
  type ScriptPackage,
} from '@affiliate-content-os/domain';

interface TestJobPayload {
  readonly workspaceId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly policyVersion: string;
  readonly reservedMicrounits: number;
}

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

  async function runComplianceExecutionThreePhase(
    gateway: AIGatewayPort,
    params: {
      workspaceId: string;
      jobId: string;
      jobVersion: number;
      workerId: string;
      operationId: string;
      aiRunId: string;
      evaluationId: string;
      productId: string;
      workOrderId: string;
      artifactId: string;
      revisionNumber: number;
      policyVersion?: string;
      expectedContentHashHex?: string;
    },
  ) {
    const prepCl = await pool.connect();
    let prep;
    try {
      prep = await prepareComplianceReviewExecution(prepCl, params);
    } finally {
      prepCl.release();
    }

    if (prep.kind === 'already_terminal') return { status: 'already_terminal' };
    if (prep.kind === 'drift_detected') {
      const settleCl = await pool.connect();
      try {
        await settleCl.query('BEGIN');
        const res = await settleComplianceDriftAtomic(settleCl, {
          ...params,
          reason: prep.reason,
          reservedSpend: prep.reservedSpend,
        });
        await settleCl.query('COMMIT');
        return res;
      } catch (err) {
        await settleCl.query('ROLLBACK');
        throw err;
      } finally {
        settleCl.release();
      }
    }
    if (prep.kind === 'preflight_blocked') {
      const settleCl = await pool.connect();
      try {
        await settleCl.query('BEGIN');
        const res = await settleCompliancePreflightBlockerAtomic(settleCl, {
          ...params,
          deterministicResult: prep.deterministicResult,
          scriptContent: prep.scriptContent,
          contentHashHex: prep.contentHashHex,
          reservedSpend: prep.reservedSpend,
        });
        await settleCl.query('COMMIT');
        return res;
      } catch (err) {
        await settleCl.query('ROLLBACK');
        throw err;
      } finally {
        settleCl.release();
      }
    }
    if (prep.kind === 'budget_exhausted') {
      const settleCl = await pool.connect();
      try {
        await settleCl.query('BEGIN');
        const res = await settleComplianceBudgetExhaustedAtomic(settleCl, {
          ...params,
          deterministicResult: prep.deterministicResult,
          productId: params.productId,
          artifactId: params.artifactId,
          revisionNumber: params.revisionNumber,
        });
        await settleCl.query('COMMIT');
        return res;
      } catch (err) {
        await settleCl.query('ROLLBACK');
        throw err;
      } finally {
        settleCl.release();
      }
    }

    let advisoryRes: ExecuteComplianceAdvisoryResult | null;
    try {
      advisoryRes = await gateway.executeComplianceAdvisory!(prep.providerInput);
    } catch {
      advisoryRes = null;
    }

    const settleCl = await pool.connect();
    try {
      await settleCl.query('BEGIN');
      const res = await settleComplianceReviewExecutionAtomic(settleCl, {
        ...params,
        contentHashHex: prep.contentHashHex,
        deterministicResult: prep.deterministicResult,
        reservedSpend: prep.reservedSpend,
        policyVersion: prep.policyVersion,
        policyHashHex: prep.policyHashHex,
        providerInput: prep.providerInput,
        providerInputHash: prep.providerInputHash,
        briefSnapshot: prep.briefSnapshot,
        planningRevisionsSnapshot: prep.planningRevisionsSnapshot,
        contextPackageSnapshot: prep.contextPackageSnapshot,
        providerResult: advisoryRes,
      });
      await settleCl.query('COMMIT');
      return res;
    } catch (err) {
      await settleCl.query('ROLLBACK');
      throw err;
    } finally {
      settleCl.release();
    }
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

    // Settle through three-phase flow using fakeComplianceGateway
    await runComplianceExecutionThreePhase(fakeComplianceGateway, {
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

    // Verify evaluation is completed with 0 blockers and 1 warning
    const evalAfter = await adapter.getComplianceEvaluation(typedWsId, artifactId, 1);
    expect(evalAfter).not.toBeNull();
    expect(evalAfter?.status).toBe('completed');
    expect(evalAfter?.blockingCount).toBe(0);
    expect(evalAfter?.warningCount).toBe(1);
    expect(evalAfter?.findings).toHaveLength(1);
    expect(evalAfter?.findings[0]?.severity).toBe('warning');
  });

  it('rejects duplicate settlement when worker lease is fenced / job is non-existent or completed', async () => {
    const cl = await pool.connect();
    try {
      await expect(
        prepareComplianceReviewExecution(cl, {
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
    } finally {
      cl.release();
    }
  });

  async function createTestRevision(note: string) {
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const artRes = await pool.query(
      `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const baseRevNum = Number(artRes.rows[0].current_revision_number);
    const expectedVersion = Number(artRes.rows[0].version);

    const baseRevRes = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, baseRevNum],
    );
    const baseHashHex = Buffer.from(baseRevRes.rows[0].content_hash).toString('hex');

    const rawKey = generateUuidV7();
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      const res = await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion,
        baseRevisionNumber: baseRevNum,
        baseContentHashHex: baseHashHex,
        content: cleanPkg,
        note,
        idempotency: {
          rawKey,
          keyHash,
          requestHash,
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/revisions`,
        },
      });
      await cl.query('COMMIT');
      return res;
    } finally {
      cl.release();
    }
  }

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
        expectedVersion: 1,
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

    // Settle through three-phase flow
    // Since modifiedPkg in rev 2 has "cam kết 100%", evaluateDeterministicCompliance will detect
    // the blocking finding, skip AI advisory, and save blocking_count = 1 via settleCompliancePreflightBlockerAtomic!
    await runComplianceExecutionThreePhase(fakeComplianceGateway, {
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

  it('enforces database immutability triggers on evaluations, findings, decisions, and snapshots', async () => {
    // 1. UPDATE and DELETE on terminal compliance_evaluations must fail with 55000
    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE workspace_id = $1 AND status IN ('completed', 'failed') LIMIT 1`,
      [wsId],
    );
    expect(evalRow.rowCount).toBe(1);
    const evalId = evalRow.rows[0].id;

    await expect(
      pool.query(`UPDATE compliance_evaluations SET result = 'passed' WHERE id = $1`, [evalId]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(`DELETE FROM compliance_evaluations WHERE id = $1`, [evalId]),
    ).rejects.toMatchObject({ code: '55000' });

    // 2. UPDATE and DELETE on compliance_findings must fail with 55000
    const findRow = await pool.query(
      `SELECT id FROM compliance_findings WHERE workspace_id = $1 LIMIT 1`,
      [wsId],
    );
    expect(findRow.rowCount).toBe(1);
    const findId = findRow.rows[0].id;

    await expect(
      pool.query(`UPDATE compliance_findings SET message = 'altered' WHERE id = $1`, [findId]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(`DELETE FROM compliance_findings WHERE id = $1`, [findId]),
    ).rejects.toMatchObject({ code: '55000' });

    // 3. UPDATE and DELETE on content_review_decisions must fail with 55000
    const decRow = await pool.query(
      `SELECT id FROM content_review_decisions WHERE workspace_id = $1 LIMIT 1`,
      [wsId],
    );
    expect(decRow.rowCount).toBe(1);
    const decId = decRow.rows[0].id;

    await expect(
      pool.query(`UPDATE content_review_decisions SET reason = 'altered' WHERE id = $1`, [decId]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(`DELETE FROM content_review_decisions WHERE id = $1`, [decId]),
    ).rejects.toMatchObject({ code: '55000' });

    // 4. UPDATE and DELETE on content_approval_snapshots must fail with 55000 (real column)
    const snapRow = await pool.query(
      `SELECT id FROM content_approval_snapshots WHERE workspace_id = $1 LIMIT 1`,
      [wsId],
    );
    expect(snapRow.rowCount).toBe(1);
    const snapId = snapRow.rows[0].id;

    await expect(
      pool.query(`UPDATE content_approval_snapshots SET policy_version = 'altered' WHERE id = $1`, [
        snapId,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(`DELETE FROM content_approval_snapshots WHERE id = $1`, [snapId]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('competing decisions: concurrent accept/accept race allows exactly one winner and rejects the loser', async () => {
    // 1. Create clean revision 3
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const rawKey = '019318b2-5f33-722e-a5df-036f007b89d2';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const rev2Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 2`,
      [artifactId],
    );
    const rev2HashHex = Buffer.from(rev2Res.rows[0].content_hash).toString('hex');

    const cl = await pool.connect();
    let rev3Artifact: ContentArtifactDetailDTO;
    try {
      await cl.query('BEGIN');
      rev3Artifact = await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 4,
        baseRevisionNumber: 2,
        baseContentHashHex: rev2HashHex,
        content: cleanPkg,
        note: 'Create revision 3 for race testing',
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

    expect(rev3Artifact.artifact.currentRevisionNumber).toBe(3);
    expect(rev3Artifact.artifact.version).toBe(5);

    const rev3Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 3`,
      [artifactId],
    );
    const rev3HashHex = Buffer.from(rev3Res.rows[0].content_hash).toString('hex');

    // Settle compliance for rev 3
    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-rev3-compliance',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 3`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    await runComplianceExecutionThreePhase(fakeComplianceGateway, {
      workspaceId: p.workspaceId,
      jobId: claimed!.id,
      jobVersion: claimed!.version,
      workerId: 'worker-rev3-compliance',
      operationId: p.operationId,
      aiRunId: p.aiRunId,
      evaluationId,
      productId: p.productId,
      workOrderId: p.workOrderId,
      artifactId: p.artifactId,
      revisionNumber: 3,
      policyVersion: p.policyVersion,
    });

    // Launch concurrent accept/accept race
    const rawKeyA = '019318b2-5f33-722e-a5df-036f007b89d3';
    const rawKeyB = '019318b2-5f33-722e-a5df-036f007b89d4';

    const [resA, resB] = await Promise.allSettled([
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 5,
        revisionNumber: 3,
        contentHashHex: rev3HashHex,
        note: 'Concurrent accept A',
        idempotency: {
          rawKey: rawKeyA,
          keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKeyA).digest()),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 5,
        revisionNumber: 3,
        contentHashHex: rev3HashHex,
        note: 'Concurrent accept B',
        idempotency: {
          rawKey: rawKeyB,
          keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKeyB).digest()),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Verify DB state: exactly 1 accept decision, 1 approval snapshot
    const decs = await pool.query(
      `SELECT * FROM content_review_decisions WHERE artifact_id = $1 AND revision_number = 3`,
      [artifactId],
    );
    expect(decs.rowCount).toBe(1);
    expect(decs.rows[0].decision).toBe('accept');

    const snaps = await pool.query(
      `SELECT * FROM content_approval_snapshots WHERE artifact_id = $1 AND revision_number = 3`,
      [artifactId],
    );
    expect(snaps.rowCount).toBe(1);

    // Verify idempotent replay of the winner returns identical snapshot
    const winningKey = resA.status === 'fulfilled' ? rawKeyA : rawKeyB;
    const replay = await adapter.acceptScriptRevision({
      workspaceId: typedWsId,
      artifactId,
      actorUserId: typedUserId,
      expectedVersion: 5,
      revisionNumber: 3,
      contentHashHex: rev3HashHex,
      note: 'Replay winning accept',
      idempotency: {
        rawKey: winningKey,
        keyHash: new Uint8Array(crypto.createHash('sha256').update(winningKey).digest()),
        requestHash: new Uint8Array(32),
        routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
      },
    });
    expect(replay.approvalSnapshot.id).toBe(snaps.rows[0].id);
  });

  it('competing decisions: concurrent accept/reject race allows exactly one terminal decision', async () => {
    // Create revision 4
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const rawKey = '019318b2-5f33-722e-a5df-036f007b89e2';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const rev3Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 3`,
      [artifactId],
    );
    const rev3HashHex = Buffer.from(rev3Res.rows[0].content_hash).toString('hex');

    const cl = await pool.connect();
    let rev4Artifact: ContentArtifactDetailDTO;
    try {
      await cl.query('BEGIN');
      rev4Artifact = await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 6,
        baseRevisionNumber: 3,
        baseContentHashHex: rev3HashHex,
        content: cleanPkg,
        note: 'Create revision 4 for accept/reject race',
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

    expect(rev4Artifact.artifact.currentRevisionNumber).toBe(4);
    expect(rev4Artifact.artifact.version).toBe(7);

    const rev4Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 4`,
      [artifactId],
    );
    const rev4HashHex = Buffer.from(rev4Res.rows[0].content_hash).toString('hex');

    // Settle compliance for rev 4
    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-rev4-compliance',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 4`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    await runComplianceExecutionThreePhase(fakeComplianceGateway, {
      workspaceId: p.workspaceId,
      jobId: claimed!.id,
      jobVersion: claimed!.version,
      workerId: 'worker-rev4-compliance',
      operationId: p.operationId,
      aiRunId: p.aiRunId,
      evaluationId,
      productId: p.productId,
      workOrderId: p.workOrderId,
      artifactId: p.artifactId,
      revisionNumber: 4,
      policyVersion: p.policyVersion,
    });

    // Launch concurrent accept vs reject race
    const rawKeyAcc = '019318b2-5f33-722e-a5df-036f007b89e3';
    const rawKeyRej = '019318b2-5f33-722e-a5df-036f007b89e4';

    const [resAccept, resReject] = await Promise.allSettled([
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 7,
        revisionNumber: 4,
        contentHashHex: rev4HashHex,
        note: 'Race accept',
        idempotency: {
          rawKey: rawKeyAcc,
          keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKeyAcc).digest()),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
      adapter.rejectScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 7,
        revisionNumber: 4,
        contentHashHex: rev4HashHex,
        reason: 'Race reject',
        idempotency: {
          rawKey: rawKeyRej,
          keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKeyRej).digest()),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/reject`,
        },
      }),
    ]);

    const fulfilled = [resAccept, resReject].filter((r) => r.status === 'fulfilled');
    const rejected = [resAccept, resReject].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Exactly 1 decision in DB
    const decs = await pool.query(
      `SELECT decision FROM content_review_decisions WHERE artifact_id = $1 AND revision_number = 4`,
      [artifactId],
    );
    expect(decs.rowCount).toBe(1);
    expect(['accept', 'reject']).toContain(decs.rows[0].decision);
  });

  it('competing decisions: concurrent reject/accept race allows exactly one terminal decision', async () => {
    // Create revision 5
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const rawKey = '019318b2-5f33-722e-a5df-036f007b89f2';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const rev4Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 4`,
      [artifactId],
    );
    const rev4HashHex = Buffer.from(rev4Res.rows[0].content_hash).toString('hex');

    const cl = await pool.connect();
    let rev5Artifact: ContentArtifactDetailDTO;
    try {
      await cl.query('BEGIN');
      rev5Artifact = await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 8,
        baseRevisionNumber: 4,
        baseContentHashHex: rev4HashHex,
        content: cleanPkg,
        note: 'Create revision 5 for reject/accept race',
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

    expect(rev5Artifact.artifact.currentRevisionNumber).toBe(5);
    expect(rev5Artifact.artifact.version).toBe(9);

    const rev5Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 5`,
      [artifactId],
    );
    const rev5HashHex = Buffer.from(rev5Res.rows[0].content_hash).toString('hex');

    // Settle compliance for rev 5
    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-rev5-compliance',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 5`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    await runComplianceExecutionThreePhase(fakeComplianceGateway, {
      workspaceId: p.workspaceId,
      jobId: claimed!.id,
      jobVersion: claimed!.version,
      workerId: 'worker-rev5-compliance',
      operationId: p.operationId,
      aiRunId: p.aiRunId,
      evaluationId,
      productId: p.productId,
      workOrderId: p.workOrderId,
      artifactId: p.artifactId,
      revisionNumber: 5,
      policyVersion: p.policyVersion,
    });

    // Launch concurrent reject vs accept race
    const rawKeyRej = '019318b2-5f33-722e-a5df-036f007b89f3';
    const rawKeyAcc = '019318b2-5f33-722e-a5df-036f007b89f4';

    const [resReject, resAccept] = await Promise.allSettled([
      adapter.rejectScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 9,
        revisionNumber: 5,
        contentHashHex: rev5HashHex,
        reason: 'Race reject',
        idempotency: {
          rawKey: rawKeyRej,
          keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKeyRej).digest()),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/reject`,
        },
      }),
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 9,
        revisionNumber: 5,
        contentHashHex: rev5HashHex,
        note: 'Race accept',
        idempotency: {
          rawKey: rawKeyAcc,
          keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKeyAcc).digest()),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ]);

    const fulfilled = [resReject, resAccept].filter((r) => r.status === 'fulfilled');
    const rejected = [resReject, resAccept].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Exactly 1 decision in DB
    const decs = await pool.query(
      `SELECT decision FROM content_review_decisions WHERE artifact_id = $1 AND revision_number = 5`,
      [artifactId],
    );
    expect(decs.rowCount).toBe(1);
    expect(['accept', 'reject']).toContain(decs.rows[0].decision);
  });

  it('pre-provider drift fencing makes zero provider calls and evaluation is non-approvable', async () => {
    // Create revision 6
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const rawKey = '019318b2-5f33-722e-a5df-036f007b8901';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const rev5Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 5`,
      [artifactId],
    );
    const rev5HashHex = Buffer.from(rev5Res.rows[0].content_hash).toString('hex');

    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 10,
        baseRevisionNumber: 5,
        baseContentHashHex: rev5HashHex,
        content: cleanPkg,
        note: 'Create revision 6 for drift testing',
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

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-rev6-drift',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 6`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    // Simulate pre-provider content hash drift
    const prepCl = await pool.connect();
    let prep;
    try {
      prep = await prepareComplianceReviewExecution(prepCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev6-drift',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: 6,
        policyVersion: p.policyVersion,
        expectedContentHashHex: '0'.repeat(64), // deliberately drifted hash
      });
    } finally {
      prepCl.release();
    }

    expect(prep.kind).toBe('drift_detected');
    if (prep.kind !== 'drift_detected') throw new Error('Expected drift_detected');

    // Settle drift atomically (zero provider calls!)
    const settleCl = await pool.connect();
    try {
      await settleCl.query('BEGIN');
      await settleComplianceDriftAtomic(settleCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev6-drift',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        workOrderId: p.workOrderId,
        reason: prep.reason,
        reservedSpend: prep.reservedSpend,
      });
      await settleCl.query('COMMIT');
    } finally {
      settleCl.release();
    }

    // Evaluation is failed / non-approvable
    const evalRes = await pool.query(
      `SELECT status, result FROM compliance_evaluations WHERE id = $1`,
      [evaluationId],
    );
    expect(evalRes.rows[0].status).toBe('failed');
    expect(evalRes.rows[0].result).toBe('failed');

    // Attempting to accept revision 6 must fail with ComplianceEvaluationNotApprovableError
    const rev6Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 6`,
      [artifactId],
    );
    const rev6HashHex = Buffer.from(rev6Res.rows[0].content_hash).toString('hex');

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 11,
        revisionNumber: 6,
        contentHashHex: rev6HashHex,
        idempotency: {
          rawKey: '019318b2-5f33-722e-a5df-036f007b8902',
          keyHash: new Uint8Array(32),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow(ComplianceEvaluationNotApprovableError);
  });

  it('budget exhausted makes zero provider calls and evaluation is non-approvable', async () => {
    // Max out monthly budget spend temporarily
    await pool.query(
      `UPDATE workspace_ai_policies SET current_spend_microunits = monthly_budget_microunits WHERE workspace_id = $1`,
      [wsId],
    );

    // Create revision 7 (enqueue will reserve 0 because budget is exhausted)
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const rawKey = '019318b2-5f33-722e-a5df-036f007b8903';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const rev6Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 6`,
      [artifactId],
    );
    const rev6HashHex = Buffer.from(rev6Res.rows[0].content_hash).toString('hex');

    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 11,
        baseRevisionNumber: 6,
        baseContentHashHex: rev6HashHex,
        content: cleanPkg,
        note: 'Create revision 7 for budget exhaustion testing',
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

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-rev7-budget',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 7`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    // Prepare execution -> returns budget_exhausted
    const prepCl = await pool.connect();
    let prep;
    try {
      prep = await prepareComplianceReviewExecution(prepCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev7-budget',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: 7,
        policyVersion: p.policyVersion,
      });
    } finally {
      prepCl.release();
    }

    expect(prep.kind).toBe('budget_exhausted');
    if (prep.kind !== 'budget_exhausted') throw new Error('Expected budget_exhausted');

    // Settle budget exhausted atomically (zero provider calls!)
    const settleCl = await pool.connect();
    try {
      await settleCl.query('BEGIN');
      await settleComplianceBudgetExhaustedAtomic(settleCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev7-budget',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: 7,
        deterministicResult: prep.deterministicResult,
      });
      await settleCl.query('COMMIT');
    } finally {
      settleCl.release();
    }

    // Reset budget spend
    await pool.query(
      `UPDATE workspace_ai_policies SET current_spend_microunits = 0 WHERE workspace_id = $1`,
      [wsId],
    );

    // Evaluation is failed / non-approvable
    const evalRes = await pool.query(
      `SELECT status, result, ai_advisory_status FROM compliance_evaluations WHERE id = $1`,
      [evaluationId],
    );
    expect(evalRes.rows[0].status).toBe('failed');
    expect(evalRes.rows[0].result).toBe('failed');
    expect(evalRes.rows[0].ai_advisory_status).toBe('failed');

    // Attempting to accept revision 7 fails with ComplianceEvaluationNotApprovableError
    const rev7Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 7`,
      [artifactId],
    );
    const rev7HashHex = Buffer.from(rev7Res.rows[0].content_hash).toString('hex');

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 12,
        revisionNumber: 7,
        contentHashHex: rev7HashHex,
        idempotency: {
          rawKey: '019318b2-5f33-722e-a5df-036f007b8904',
          keyHash: new Uint8Array(32),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow(ComplianceEvaluationNotApprovableError);
  });

  it('post-provider drift fencing detects state changes during execution, releases reservation, and fails closed', async () => {
    // Create revision 8
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const rawKey = '019318b2-5f33-722e-a5df-036f007b8905';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const rev7Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 7`,
      [artifactId],
    );
    const rev7HashHex = Buffer.from(rev7Res.rows[0].content_hash).toString('hex');

    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 12,
        baseRevisionNumber: 7,
        baseContentHashHex: rev7HashHex,
        content: cleanPkg,
        note: 'Create revision 8 for post-provider drift testing',
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

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-rev8-drift',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 8`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    // Prepare execution succeeds
    const prepCl = await pool.connect();
    let prep;
    try {
      prep = await prepareComplianceReviewExecution(prepCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev8-drift',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: 8,
        policyVersion: p.policyVersion,
      });
    } finally {
      prepCl.release();
    }

    expect(prep.kind).toBe('execute_advisory');
    if (prep.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    // Execute advisory call
    const advisoryRes = await fakeComplianceGateway.executeComplianceAdvisory!(prep.providerInput);

    // Simulate post-provider drift: another revision or external process bumps current_revision_number
    await pool.query(`UPDATE content_artifacts SET current_revision_number = 999 WHERE id = $1`, [
      artifactId,
    ]);

    // Settle execution -> post-provider fencing detects drift!
    const settleCl = await pool.connect();
    let settleOutcome;
    try {
      await settleCl.query('BEGIN');
      settleOutcome = await settleComplianceReviewExecutionAtomic(settleCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev8-drift',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: 8,
        contentHashHex: prep.contentHashHex,
        deterministicResult: prep.deterministicResult,
        reservedSpend: prep.reservedSpend,
        policyVersion: prep.policyVersion,
        policyHashHex: prep.policyHashHex,
        providerInput: prep.providerInput,
        providerInputHash: prep.providerInputHash,
        briefSnapshot: prep.briefSnapshot,
        planningRevisionsSnapshot: prep.planningRevisionsSnapshot,
        contextPackageSnapshot: prep.contextPackageSnapshot,
        providerResult: advisoryRes,
      });
      await settleCl.query('COMMIT');
    } finally {
      settleCl.release();
    }

    expect(settleOutcome.status).toBe('drift_canceled');

    // Evaluation is failed / non-approvable
    const evalRes = await pool.query(
      `SELECT status, result FROM compliance_evaluations WHERE id = $1`,
      [evaluationId],
    );
    expect(evalRes.rows[0].status).toBe('failed');
    expect(evalRes.rows[0].result).toBe('failed');

    // Restore artifact current_revision_number
    await pool.query(`UPDATE content_artifacts SET current_revision_number = 8 WHERE id = $1`, [
      artifactId,
    ]);
  });

  it('provider failure results in non-approvable failed evaluation and releases reservation', async () => {
    // Create revision 9
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const rawKey = '019318b2-5f33-722e-a5df-036f007b8906';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(rawKey, 'utf8').digest());
    const requestHash = new Uint8Array(32);

    const rev8Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 8`,
      [artifactId],
    );
    const rev8HashHex = Buffer.from(rev8Res.rows[0].content_hash).toString('hex');

    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await createManualRevisionTransaction(cl, {
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 13,
        baseRevisionNumber: 8,
        baseContentHashHex: rev8HashHex,
        content: cleanPkg,
        note: 'Create revision 9 for provider failure testing',
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

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-rev9-fail',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = 9`,
      [artifactId],
    );
    const evaluationId = evalRow.rows[0].id;

    // Prepare execution
    const prepCl = await pool.connect();
    let prep;
    try {
      prep = await prepareComplianceReviewExecution(prepCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev9-fail',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: 9,
        policyVersion: p.policyVersion,
      });
    } finally {
      prepCl.release();
    }

    expect(prep.kind).toBe('execute_advisory');
    if (prep.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    // Simulate provider failure
    const failedProviderResult: ExecuteComplianceAdvisoryResult = {
      success: false,
      errorCategory: 'provider_timeout',
      errorMessage: 'Provider upstream timeout during compliance advisory',
      usage: {
        tokenInput: 0,
        tokenOutput: 0,
        costMicrounits: 0,
        latencyMs: 0,
        costCurrency: 'USD',
      },
      provenance: {
        provider: 'google',
        model: 'gemini-3.8-flash',
        promptTemplate: 'compliance_advisory_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
      },
    };

    // Settle execution with provider failure
    const settleCl = await pool.connect();
    let settleOutcome;
    try {
      await settleCl.query('BEGIN');
      settleOutcome = await settleComplianceReviewExecutionAtomic(settleCl, {
        workspaceId: p.workspaceId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-rev9-fail',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId,
        productId: p.productId,
        workOrderId: p.workOrderId,
        artifactId: p.artifactId,
        revisionNumber: 9,
        contentHashHex: prep.contentHashHex,
        deterministicResult: prep.deterministicResult,
        reservedSpend: prep.reservedSpend,
        policyVersion: prep.policyVersion,
        policyHashHex: prep.policyHashHex,
        providerInput: prep.providerInput,
        providerInputHash: prep.providerInputHash,
        briefSnapshot: prep.briefSnapshot,
        planningRevisionsSnapshot: prep.planningRevisionsSnapshot,
        contextPackageSnapshot: prep.contextPackageSnapshot,
        providerResult: failedProviderResult,
      });
      await settleCl.query('COMMIT');
    } finally {
      settleCl.release();
    }

    expect(settleOutcome.status).toBe('failed');

    // Evaluation is failed / non-approvable
    const evalRes = await pool.query(
      `SELECT status, result, ai_advisory_status FROM compliance_evaluations WHERE id = $1`,
      [evaluationId],
    );
    expect(evalRes.rows[0].status).toBe('failed');
    expect(evalRes.rows[0].result).toBe('failed');
    expect(evalRes.rows[0].ai_advisory_status).toBe('failed');

    // Attempting to accept revision 9 fails with ComplianceEvaluationNotApprovableError
    const rev9Res = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 9`,
      [artifactId],
    );
    const rev9HashHex = Buffer.from(rev9Res.rows[0].content_hash).toString('hex');

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: 14,
        revisionNumber: 9,
        contentHashHex: rev9HashHex,
        idempotency: {
          rawKey: '019318b2-5f33-722e-a5df-036f007b8907',
          keyHash: new Uint8Array(32),
          requestHash: new Uint8Array(32),
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        },
      }),
    ).rejects.toThrow(ComplianceEvaluationNotApprovableError);
  });

  it('fail-closed evidence validation: empty allowed facts/analyses set rejects references as unsupported', async () => {
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const pkg = rev1Row.rows[0].content_json as ScriptPackage;

    // Run deterministic compliance with empty allowed sets
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: new Set(), // EMPTY!
      allowedAnalysisIds: new Set(), // EMPTY!
      revokedEvidenceIds: new Set(),
    });

    expect(result.passed).toBe(false);
    expect(result.blockingCount).toBeGreaterThan(0);
    const unsupportedFindings = result.findings.filter((f) => f.code === 'CLAIM_UNSUPPORTED');
    expect(unsupportedFindings.length).toBeGreaterThan(0);
    expect(unsupportedFindings[0]?.severity).toBe('blocking');

    // Also verify invalid source kinds fail closed
    const invalidSourcePkg: ScriptPackage = {
      ...pkg,
      evidenceReferences: [
        {
          sourceKind: 'external_unverified_url' as unknown as 'product_fact',
          sourceId: 'http://example.com',
        },
      ],
    };
    const invalidResult = evaluateDeterministicCompliance({
      scriptPackage: invalidSourcePkg,
      allowedFactIds: new Set(),
      allowedAnalysisIds: new Set(),
      revokedEvidenceIds: new Set(),
    });
    expect(invalidResult.passed).toBe(false);
    expect(invalidResult.findings.some((f) => f.code === 'EVIDENCE_SOURCE_INVALID')).toBe(true);
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

  it('cleans up malformed job payload atomically without budget or evaluation leaks', async () => {
    const newRev = await createTestRevision('Test malformed payload cleanup');
    const revNum = newRev.artifact.currentRevisionNumber;

    const policyBefore = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    const reservedBefore = Number(policyBefore.rows[0].reserved_spend_microunits);
    expect(reservedBefore).toBeGreaterThanOrEqual(10_000);

    // Claim the job
    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-corrupted-test',
      leaseDurationSeconds: 30,
    });
    expect(claimed?.payloadJson.revisionNumber).toBe(revNum);
    const enqJobId = claimed!.id;

    // Corrupt the payload on job_executions
    await pool.query(
      `UPDATE job_executions
       SET payload_json = '{"corrupted": true}'::jsonb
       WHERE id = $1`,
      [enqJobId],
    );

    // Perform atomic malformed job cleanup
    const clClean = await pool.connect();
    try {
      await clClean.query('BEGIN');
      await settleComplianceMalformedJobAtomic(clClean, {
        workspaceId: wsId,
        jobId: enqJobId,
        jobVersion: claimed!.version,
        workerId: 'worker-corrupted-test',
      });
      await clClean.query('COMMIT');
    } finally {
      clClean.release();
    }

    // Reservation released back
    const policyAfter = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(policyAfter.rows[0].reserved_spend_microunits)).toBe(reservedBefore - 10_000);

    // Linked records are cleanly terminal
    const jobRow = await pool.query(
      `SELECT status, lease_owner, last_error_category FROM job_executions WHERE id = $1`,
      [enqJobId],
    );
    expect(jobRow.rows[0].status).toBe('failed');
    expect(jobRow.rows[0].lease_owner).toBeNull();
    expect(jobRow.rows[0].last_error_category).toBe('internal_error');

    const evalRows = await pool.query(
      `SELECT status, result, evaluation_report_artifact_id FROM compliance_evaluations WHERE job_id = $1`,
      [enqJobId],
    );
    expect(evalRows.rows[0].status).toBe('failed');
    expect(evalRows.rows[0].result).toBe('failed');
    expect(evalRows.rows[0].evaluation_report_artifact_id).toBeNull();
  });

  it('stale worker calling malformed payload cleanup on expired/reclaimed job is rejected with zero mutations', async () => {
    const revStale = await createTestRevision('Test stale malformed worker race');
    const revNum = revStale.artifact.currentRevisionNumber;

    // Worker 1 claims job
    const claimedW1 = await jobAdapter.claimNextJob({
      workerId: 'worker-stale-1',
      leaseDurationSeconds: 30,
    });
    expect(claimedW1?.payloadJson.revisionNumber).toBe(revNum);
    const staleJobId = claimedW1!.id;
    const staleVersion = claimedW1!.version;

    // Force lease expiration
    await pool.query(
      `UPDATE job_executions
       SET lease_expires_at = NOW() - INTERVAL '10 seconds'
       WHERE id = $1`,
      [staleJobId],
    );

    // Worker 2 reclaims the job
    const claimedW2 = await jobAdapter.claimNextJob({
      workerId: 'worker-reclaim-2',
      leaseDurationSeconds: 30,
    });
    expect(claimedW2).not.toBeNull();
    expect(claimedW2!.id).toBe(staleJobId);
    expect(claimedW2!.leaseOwner).toBe('worker-reclaim-2');
    expect(claimedW2!.version).toBeGreaterThan(staleVersion);

    // Capture state before stale worker tries cleanup
    const policyBefore = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    const reservedBefore = Number(policyBefore.rows[0].reserved_spend_microunits);

    // Worker 1 tries to settle malformed job with old version
    const clStale = await pool.connect();
    try {
      await clStale.query('BEGIN');
      await expect(
        settleComplianceMalformedJobAtomic(clStale, {
          workspaceId: wsId,
          jobId: staleJobId,
          jobVersion: staleVersion,
          workerId: 'worker-stale-1',
        }),
      ).rejects.toThrow(JobLeaseExpiredError);
      await clStale.query('ROLLBACK');
    } finally {
      clStale.release();
    }

    // Verify 0 mutations occurred: job is still running owned by worker-reclaim-2
    const jobRow = await pool.query(
      `SELECT status, lease_owner, version FROM job_executions WHERE id = $1`,
      [staleJobId],
    );
    expect(jobRow.rows[0].status).toBe('running');
    expect(jobRow.rows[0].lease_owner).toBe('worker-reclaim-2');
    expect(Number(jobRow.rows[0].version)).toBe(claimedW2!.version);

    // Reservation is untouched
    const policyAfter = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(policyAfter.rows[0].reserved_spend_microunits)).toBe(reservedBefore);

    // Evaluation is still queued (untouched by stale worker)
    const evalRow = await pool.query(
      `SELECT id, status FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum],
    );
    expect(evalRow.rows[0].status).toBe('queued');

    // Clean up test job
    await pool.query(
      `UPDATE job_executions
       SET status = 'failed', completed_at = NOW(), last_error_category = 'internal_error', lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1`,
      [staleJobId],
    );
    await pool.query(
      `UPDATE compliance_evaluations
       SET status = 'failed', result = 'failed'
       WHERE id = $1`,
      [evalRow.rows[0].id],
    );
  });

  it('malformed cleanup fails closed and rolls back if reserved spend invariant is violated', async () => {
    await createTestRevision('Test accounting invariant violation');
    const claimedInv = await jobAdapter.claimNextJob({
      workerId: 'worker-inv-test',
      leaseDurationSeconds: 30,
    });
    expect(claimedInv).not.toBeNull();
    const invJobId = claimedInv!.id;

    const policyBefore = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    const origReserved = Number(policyBefore.rows[0].reserved_spend_microunits);

    // Artificially corrupt workspace reserved spend to 0 (less than 10_000 reserved by job)
    await pool.query(
      `UPDATE workspace_ai_policies SET reserved_spend_microunits = 0 WHERE workspace_id = $1`,
      [wsId],
    );

    const clInv = await pool.connect();
    try {
      await clInv.query('BEGIN');
      await expect(
        settleComplianceMalformedJobAtomic(clInv, {
          workspaceId: wsId,
          jobId: invJobId,
          jobVersion: claimedInv!.version,
          workerId: 'worker-inv-test',
        }),
      ).rejects.toThrow(DatabaseError);
      await clInv.query('ROLLBACK');
    } finally {
      clInv.release();
    }

    // Verify job is still running and not corrupted by partial settlement
    const jobRow = await pool.query(`SELECT status FROM job_executions WHERE id = $1`, [invJobId]);
    expect(jobRow.rows[0].status).toBe('running');

    // Restore reserved spend
    await pool.query(
      `UPDATE workspace_ai_policies SET reserved_spend_microunits = $1 WHERE workspace_id = $2`,
      [origReserved, wsId],
    );

    // Clean up test job
    await pool.query(
      `UPDATE job_executions
       SET status = 'failed', completed_at = NOW(), last_error_category = 'internal_error', lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1`,
      [invJobId],
    );
  });

  it('malformed cleanup rolls back if linked operation is already terminal', async () => {
    await createTestRevision('Test already terminal op');
    const claimedOp = await jobAdapter.claimNextJob({
      workerId: 'worker-terminal-op',
      leaseDurationSeconds: 30,
    });
    expect(claimedOp).not.toBeNull();
    const opJobId = claimedOp!.id;

    // Get the operation id from the job
    const jobRes = await pool.query(`SELECT operation_id FROM job_executions WHERE id = $1`, [
      opJobId,
    ]);
    const opId = jobRes.rows[0].operation_id;

    // Artificially mark the operation as canceled ahead of time
    await pool.query(
      `UPDATE operations SET status = 'canceled', completed_at = NOW() WHERE id = $1`,
      [opId],
    );

    const clOp = await pool.connect();
    try {
      await clOp.query('BEGIN');
      await expect(
        settleComplianceMalformedJobAtomic(clOp, {
          workspaceId: wsId,
          jobId: opJobId,
          jobVersion: claimedOp!.version,
          workerId: 'worker-terminal-op',
        }),
      ).rejects.toThrow(DatabaseError);
      await clOp.query('ROLLBACK');
    } finally {
      clOp.release();
    }

    // Verify job is still running (rolled back)
    const jobAfter = await pool.query(`SELECT status FROM job_executions WHERE id = $1`, [opJobId]);
    expect(jobAfter.rows[0].status).toBe('running');

    // Clean up test job
    await pool.query(
      `UPDATE job_executions
       SET status = 'failed', completed_at = NOW(), last_error_category = 'internal_error', lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1`,
      [opJobId],
    );
  });

  it('post-provider drift fencing detects state changes during execution and cancels with reservation release', async () => {
    // 1. Post-provider brief drift (simulated via briefSnapshot diff from live DB)
    const revBrief = await createTestRevision('Test drift brief');
    const revNum1 = revBrief.artifact.currentRevisionNumber;

    const claimed1 = await jobAdapter.claimNextJob({
      workerId: 'worker-drift-brief',
      leaseDurationSeconds: 30,
    });
    expect(claimed1?.payloadJson.revisionNumber).toBe(revNum1);
    const p1 = claimed1!.payloadJson as unknown as TestJobPayload;

    const evalRow1 = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum1],
    );
    const evalId1 = evalRow1.rows[0].id;

    const prepCl1 = await pool.connect();
    let prep1;
    try {
      prep1 = await prepareComplianceReviewExecution(prepCl1, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum1,
        evaluationId: evalId1,
        jobId: claimed1!.id,
        jobVersion: claimed1!.version,
        workerId: 'worker-drift-brief',
        operationId: p1.operationId,
        aiRunId: p1.aiRunId,
      });
    } finally {
      prepCl1.release();
    }
    expect(prep1.kind).toBe('execute_advisory');
    if (prep1.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const advisoryRes1 = await fakeComplianceGateway.executeComplianceAdvisory!(
      prep1.providerInput,
    );

    const settleCl1 = await pool.connect();
    let settleOutcome1;
    try {
      await settleCl1.query('BEGIN');
      settleOutcome1 = await settleComplianceReviewExecutionAtomic(settleCl1, {
        workspaceId: wsId,
        jobId: claimed1!.id,
        jobVersion: claimed1!.version,
        workerId: 'worker-drift-brief',
        operationId: p1.operationId,
        aiRunId: p1.aiRunId,
        evaluationId: evalId1,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum1,
        contentHashHex: prep1.contentHashHex,
        deterministicResult: prep1.deterministicResult,
        reservedSpend: prep1.reservedSpend,
        policyVersion: prep1.policyVersion,
        policyHashHex: prep1.policyHashHex,
        providerInput: prep1.providerInput,
        providerInputHash: prep1.providerInputHash,
        briefSnapshot: {
          ...prep1.briefSnapshot,
          briefHashHex: 'e'.repeat(64), // Drifted hash!
        },
        planningRevisionsSnapshot: prep1.planningRevisionsSnapshot,
        contextPackageSnapshot: prep1.contextPackageSnapshot,
        providerResult: advisoryRes1,
      });
      await settleCl1.query('COMMIT');
    } finally {
      settleCl1.release();
    }

    expect(settleOutcome1.status).toBe('drift_canceled');

    // 2. Post-provider planning drift
    const revPlanning = await createTestRevision('Test drift planning');
    const revNum2 = revPlanning.artifact.currentRevisionNumber;

    const claimed2 = await jobAdapter.claimNextJob({
      workerId: 'worker-drift-planning',
      leaseDurationSeconds: 30,
    });
    expect(claimed2?.payloadJson.revisionNumber).toBe(revNum2);
    const p2 = claimed2!.payloadJson as unknown as TestJobPayload;

    const evalRow2 = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum2],
    );
    const evalId2 = evalRow2.rows[0].id;

    const prepCl2 = await pool.connect();
    let prep2;
    try {
      prep2 = await prepareComplianceReviewExecution(prepCl2, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum2,
        evaluationId: evalId2,
        jobId: claimed2!.id,
        jobVersion: claimed2!.version,
        workerId: 'worker-drift-planning',
        operationId: p2.operationId,
        aiRunId: p2.aiRunId,
      });
    } finally {
      prepCl2.release();
    }
    expect(prep2.kind).toBe('execute_advisory');
    if (prep2.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const advisoryRes2 = await fakeComplianceGateway.executeComplianceAdvisory!(
      prep2.providerInput,
    );

    // Bump planning artifact revision before settlement
    await pool.query(
      `UPDATE content_artifacts SET current_revision_number = 999
       WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'product_campaign_plan'`,
      [wsId, workOrderId],
    );

    const settleCl2 = await pool.connect();
    let settleOutcome2;
    try {
      await settleCl2.query('BEGIN');
      settleOutcome2 = await settleComplianceReviewExecutionAtomic(settleCl2, {
        workspaceId: wsId,
        jobId: claimed2!.id,
        jobVersion: claimed2!.version,
        workerId: 'worker-drift-planning',
        operationId: p2.operationId,
        aiRunId: p2.aiRunId,
        evaluationId: evalId2,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum2,
        contentHashHex: prep2.contentHashHex,
        deterministicResult: prep2.deterministicResult,
        reservedSpend: prep2.reservedSpend,
        policyVersion: prep2.policyVersion,
        policyHashHex: prep2.policyHashHex,
        providerInput: prep2.providerInput,
        providerInputHash: prep2.providerInputHash,
        briefSnapshot: prep2.briefSnapshot,
        planningRevisionsSnapshot: prep2.planningRevisionsSnapshot,
        contextPackageSnapshot: prep2.contextPackageSnapshot,
        providerResult: advisoryRes2,
      });
      await settleCl2.query('COMMIT');
    } finally {
      settleCl2.release();
    }
    expect(settleOutcome2.status).toBe('drift_canceled');

    // Restore planning revision
    await pool.query(
      `UPDATE content_artifacts SET current_revision_number = 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'product_campaign_plan'`,
      [wsId, workOrderId],
    );

    // 3. Post-provider context evidence revocation (simulated via snapshot diff from live DB)
    const revEv = await createTestRevision('Test drift evidence');
    const revNum3 = revEv.artifact.currentRevisionNumber;

    const claimed3 = await jobAdapter.claimNextJob({
      workerId: 'worker-drift-evidence',
      leaseDurationSeconds: 30,
    });
    expect(claimed3?.payloadJson.revisionNumber).toBe(revNum3);
    const p3 = claimed3!.payloadJson as unknown as TestJobPayload;

    const evalRow3 = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum3],
    );
    const evalId3 = evalRow3.rows[0].id;

    const prepCl3 = await pool.connect();
    let prep3;
    try {
      prep3 = await prepareComplianceReviewExecution(prepCl3, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum3,
        evaluationId: evalId3,
        jobId: claimed3!.id,
        jobVersion: claimed3!.version,
        workerId: 'worker-drift-evidence',
        operationId: p3.operationId,
        aiRunId: p3.aiRunId,
      });
    } finally {
      prepCl3.release();
    }
    expect(prep3.kind).toBe('execute_advisory');
    if (prep3.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const advisoryRes3 = await fakeComplianceGateway.executeComplianceAdvisory!(
      prep3.providerInput,
    );

    const settleCl3 = await pool.connect();
    let settleOutcome3;
    try {
      await settleCl3.query('BEGIN');
      settleOutcome3 = await settleComplianceReviewExecutionAtomic(settleCl3, {
        workspaceId: wsId,
        jobId: claimed3!.id,
        jobVersion: claimed3!.version,
        workerId: 'worker-drift-evidence',
        operationId: p3.operationId,
        aiRunId: p3.aiRunId,
        evaluationId: evalId3,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum3,
        contentHashHex: prep3.contentHashHex,
        deterministicResult: prep3.deterministicResult,
        reservedSpend: prep3.reservedSpend,
        policyVersion: prep3.policyVersion,
        policyHashHex: prep3.policyHashHex,
        providerInput: prep3.providerInput,
        providerInputHash: prep3.providerInputHash,
        briefSnapshot: prep3.briefSnapshot,
        planningRevisionsSnapshot: prep3.planningRevisionsSnapshot,
        contextPackageSnapshot: {
          ...prep3.contextPackageSnapshot,
          allowedFactIds: ['019318b2-5f33-722e-a5df-036f007b8999'], // Drifted evidence set!
        },
        providerResult: advisoryRes3,
      });
      await settleCl3.query('COMMIT');
    } finally {
      settleCl3.release();
    }
    expect(settleOutcome3.status).toBe('drift_canceled');

    // 4. Post-provider tampered input hash
    const revHash = await createTestRevision('Test drift input hash');
    const revNum4 = revHash.artifact.currentRevisionNumber;

    const claimed4 = await jobAdapter.claimNextJob({
      workerId: 'worker-drift-hash',
      leaseDurationSeconds: 30,
    });
    expect(claimed4?.payloadJson.revisionNumber).toBe(revNum4);
    const p4 = claimed4!.payloadJson as unknown as TestJobPayload;

    const evalRow4 = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum4],
    );
    const evalId4 = evalRow4.rows[0].id;

    const prepCl4 = await pool.connect();
    let prep4;
    try {
      prep4 = await prepareComplianceReviewExecution(prepCl4, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum4,
        evaluationId: evalId4,
        jobId: claimed4!.id,
        jobVersion: claimed4!.version,
        workerId: 'worker-drift-hash',
        operationId: p4.operationId,
        aiRunId: p4.aiRunId,
      });
    } finally {
      prepCl4.release();
    }
    expect(prep4.kind).toBe('execute_advisory');
    if (prep4.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const settleCl4 = await pool.connect();
    let settleOutcome4;
    try {
      await settleCl4.query('BEGIN');
      settleOutcome4 = await settleComplianceReviewExecutionAtomic(settleCl4, {
        workspaceId: wsId,
        jobId: claimed4!.id,
        jobVersion: claimed4!.version,
        workerId: 'worker-drift-hash',
        operationId: p4.operationId,
        aiRunId: p4.aiRunId,
        evaluationId: evalId4,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum4,
        contentHashHex: prep4.contentHashHex,
        deterministicResult: prep4.deterministicResult,
        reservedSpend: prep4.reservedSpend,
        policyVersion: prep4.policyVersion,
        policyHashHex: prep4.policyHashHex,
        providerInput: prep4.providerInput,
        providerInputHash: '0'.repeat(64), // TAMPERED!
        briefSnapshot: prep4.briefSnapshot,
        planningRevisionsSnapshot: prep4.planningRevisionsSnapshot,
        contextPackageSnapshot: prep4.contextPackageSnapshot,
        providerResult: advisoryRes3,
      });
      await settleCl4.query('COMMIT');
    } finally {
      settleCl4.release();
    }
    expect(settleOutcome4.status).toBe('drift_canceled');
  });

  it('fails closed on invalid, negative, or over-budget provider cost and charges exact reported cost on valid', async () => {
    // 1. Provider cost exceeds reservation
    const revOver = await createTestRevision('Test overbudget cost');
    const revNum1 = revOver.artifact.currentRevisionNumber;

    const claimed1 = await jobAdapter.claimNextJob({
      workerId: 'worker-overbudget',
      leaseDurationSeconds: 30,
    });
    expect(claimed1?.payloadJson.revisionNumber).toBe(revNum1);
    const p1 = claimed1!.payloadJson as unknown as TestJobPayload;

    const evalRow1 = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum1],
    );
    const evalId1 = evalRow1.rows[0].id;

    const prepCl1 = await pool.connect();
    let prep1;
    try {
      prep1 = await prepareComplianceReviewExecution(prepCl1, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum1,
        evaluationId: evalId1,
        jobId: claimed1!.id,
        jobVersion: claimed1!.version,
        workerId: 'worker-overbudget',
        operationId: p1.operationId,
        aiRunId: p1.aiRunId,
      });
    } finally {
      prepCl1.release();
    }
    expect(prep1.kind).toBe('execute_advisory');
    if (prep1.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const overbudgetAdvisory: ExecuteComplianceAdvisoryResult = {
      success: true,
      content: {
        summary: 'Clean',
        findings: [],
      },
      usage: {
        tokenInput: 100,
        tokenOutput: 100,
        costMicrounits: 50_000, // 50_000 > 10_000 reserved!
        latencyMs: 10,
        costCurrency: 'USD',
      },
      provenance: {
        provider: 'google',
        model: 'gemini-3.8-flash',
        promptTemplate: 'compliance_advisory_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
      },
    };

    const settleCl1 = await pool.connect();
    let settleRes1;
    try {
      await settleCl1.query('BEGIN');
      settleRes1 = await settleComplianceReviewExecutionAtomic(settleCl1, {
        workspaceId: wsId,
        jobId: claimed1!.id,
        jobVersion: claimed1!.version,
        workerId: 'worker-overbudget',
        operationId: p1.operationId,
        aiRunId: p1.aiRunId,
        evaluationId: evalId1,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum1,
        contentHashHex: prep1.contentHashHex,
        deterministicResult: prep1.deterministicResult,
        reservedSpend: prep1.reservedSpend,
        policyVersion: prep1.policyVersion,
        policyHashHex: prep1.policyHashHex,
        providerInput: prep1.providerInput,
        providerInputHash: prep1.providerInputHash,
        briefSnapshot: prep1.briefSnapshot,
        planningRevisionsSnapshot: prep1.planningRevisionsSnapshot,
        contextPackageSnapshot: prep1.contextPackageSnapshot,
        providerResult: overbudgetAdvisory,
      });
      await settleCl1.query('COMMIT');
    } finally {
      settleCl1.release();
    }
    expect(settleRes1.status).toBe('failed');

    const evalRowCheck1 = await pool.query(
      `SELECT status, result, evaluation_report_artifact_id FROM compliance_evaluations WHERE id = $1`,
      [evalId1],
    );
    expect(evalRowCheck1.rows[0].status).toBe('failed');
    expect(evalRowCheck1.rows[0].result).toBe('failed');
    expect(evalRowCheck1.rows[0].evaluation_report_artifact_id).toBeNull();

    // 2. Negative provider cost fails closed
    const revNeg = await createTestRevision('Test negative cost');
    const revNum2 = revNeg.artifact.currentRevisionNumber;

    const claimed2 = await jobAdapter.claimNextJob({
      workerId: 'worker-negative-cost',
      leaseDurationSeconds: 30,
    });
    expect(claimed2?.payloadJson.revisionNumber).toBe(revNum2);
    const p2 = claimed2!.payloadJson as unknown as TestJobPayload;

    const evalRow2 = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum2],
    );
    const evalId2 = evalRow2.rows[0].id;

    const prepCl2 = await pool.connect();
    let prep2;
    try {
      prep2 = await prepareComplianceReviewExecution(prepCl2, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum2,
        evaluationId: evalId2,
        jobId: claimed2!.id,
        jobVersion: claimed2!.version,
        workerId: 'worker-negative-cost',
        operationId: p2.operationId,
        aiRunId: p2.aiRunId,
      });
    } finally {
      prepCl2.release();
    }
    expect(prep2.kind).toBe('execute_advisory');
    if (prep2.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const negativeCostAdvisory: ExecuteComplianceAdvisoryResult = {
      ...overbudgetAdvisory,
      usage: {
        ...overbudgetAdvisory.usage,
        costMicrounits: -500,
      },
    };

    const settleCl2 = await pool.connect();
    let settleRes2;
    try {
      await settleCl2.query('BEGIN');
      settleRes2 = await settleComplianceReviewExecutionAtomic(settleCl2, {
        workspaceId: wsId,
        jobId: claimed2!.id,
        jobVersion: claimed2!.version,
        workerId: 'worker-negative-cost',
        operationId: p2.operationId,
        aiRunId: p2.aiRunId,
        evaluationId: evalId2,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum2,
        contentHashHex: prep2.contentHashHex,
        deterministicResult: prep2.deterministicResult,
        reservedSpend: prep2.reservedSpend,
        policyVersion: prep2.policyVersion,
        policyHashHex: prep2.policyHashHex,
        providerInput: prep2.providerInput,
        providerInputHash: prep2.providerInputHash,
        briefSnapshot: prep2.briefSnapshot,
        planningRevisionsSnapshot: prep2.planningRevisionsSnapshot,
        contextPackageSnapshot: prep2.contextPackageSnapshot,
        providerResult: negativeCostAdvisory,
      });
      await settleCl2.query('COMMIT');
    } finally {
      settleCl2.release();
    }
    expect(settleRes2.status).toBe('failed');

    // 3. Valid cost charges exact reported amount
    const revValid = await createTestRevision('Test valid cost');
    const revNum3 = revValid.artifact.currentRevisionNumber;

    const claimed3 = await jobAdapter.claimNextJob({
      workerId: 'worker-valid-cost',
      leaseDurationSeconds: 30,
    });
    expect(claimed3?.payloadJson.revisionNumber).toBe(revNum3);
    const p3 = claimed3!.payloadJson as unknown as TestJobPayload;

    const evalRow3 = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum3],
    );
    const evalId3 = evalRow3.rows[0].id;

    const policyBefore3 = await pool.query(
      `SELECT current_spend_microunits, reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    const spendBefore3 = Number(policyBefore3.rows[0].current_spend_microunits);
    const reservedBefore3 = Number(policyBefore3.rows[0].reserved_spend_microunits);

    const prepCl3 = await pool.connect();
    let prep3;
    try {
      prep3 = await prepareComplianceReviewExecution(prepCl3, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum3,
        evaluationId: evalId3,
        jobId: claimed3!.id,
        jobVersion: claimed3!.version,
        workerId: 'worker-valid-cost',
        operationId: p3.operationId,
        aiRunId: p3.aiRunId,
      });
    } finally {
      prepCl3.release();
    }
    expect(prep3.kind).toBe('execute_advisory');
    if (prep3.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const validCostAdvisory: ExecuteComplianceAdvisoryResult = {
      ...overbudgetAdvisory,
      usage: {
        ...overbudgetAdvisory.usage,
        costMicrounits: 7_500,
      },
    };

    const settleCl3 = await pool.connect();
    let settleRes3;
    try {
      await settleCl3.query('BEGIN');
      settleRes3 = await settleComplianceReviewExecutionAtomic(settleCl3, {
        workspaceId: wsId,
        jobId: claimed3!.id,
        jobVersion: claimed3!.version,
        workerId: 'worker-valid-cost',
        operationId: p3.operationId,
        aiRunId: p3.aiRunId,
        evaluationId: evalId3,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum3,
        contentHashHex: prep3.contentHashHex,
        deterministicResult: prep3.deterministicResult,
        reservedSpend: prep3.reservedSpend,
        policyVersion: prep3.policyVersion,
        policyHashHex: prep3.policyHashHex,
        providerInput: prep3.providerInput,
        providerInputHash: prep3.providerInputHash,
        briefSnapshot: prep3.briefSnapshot,
        planningRevisionsSnapshot: prep3.planningRevisionsSnapshot,
        contextPackageSnapshot: prep3.contextPackageSnapshot,
        providerResult: validCostAdvisory,
      });
      await settleCl3.query('COMMIT');
    } finally {
      settleCl3.release();
    }
    expect(settleRes3.status).toBe('completed');

    const policyAfter3 = await pool.query(
      `SELECT current_spend_microunits, reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(policyAfter3.rows[0].current_spend_microunits)).toBe(spendBefore3 + 7_500);
    expect(Number(policyAfter3.rows[0].reserved_spend_microunits)).toBe(reservedBefore3 - 10_000);
  });

  it('constrains provider-supplied evidence IDs strictly to allowed context package evidence', async () => {
    const revChips = await createTestRevision('Test evidence chips');
    const revNum = revChips.artifact.currentRevisionNumber;

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-evidence-chips',
      leaseDurationSeconds: 30,
    });
    expect(claimed?.payloadJson.revisionNumber).toBe(revNum);
    const p = claimed!.payloadJson as unknown as TestJobPayload;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum],
    );
    const evalId = evalRow.rows[0].id;

    const prepCl = await pool.connect();
    let prep;
    try {
      prep = await prepareComplianceReviewExecution(prepCl, {
        workspaceId: wsId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum,
        evaluationId: evalId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-evidence-chips',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
      });
    } finally {
      prepCl.release();
    }
    expect(prep.kind).toBe('execute_advisory');
    if (prep.kind !== 'execute_advisory') throw new Error('Expected execute_advisory');

    const advisoryWithForeignChips: ExecuteComplianceAdvisoryResult = {
      success: true,
      content: {
        summary: 'Moderate',
        findings: [
          {
            code: 'CLAIM_DISCLOSURE_WEAK',
            severity: 'warning',
            videoNumber: 1,
            message: 'Tuyên bố cần làm rõ điều kiện áp dụng',
            fieldPath: 'videos[0].dialogue',
            evidenceIds: [factId, 'foreign-cross-tenant-chip-999', 'arbitrary-injected-id'],
          },
        ],
      },
      usage: {
        tokenInput: 50,
        tokenOutput: 50,
        costMicrounits: 5_000,
        latencyMs: 5,
        costCurrency: 'USD',
      },
      provenance: {
        provider: 'google',
        model: 'gemini-3.8-flash',
        promptTemplate: 'compliance_advisory_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
      },
    };

    const settleCl = await pool.connect();
    try {
      await settleCl.query('BEGIN');
      await settleComplianceReviewExecutionAtomic(settleCl, {
        workspaceId: wsId,
        jobId: claimed!.id,
        jobVersion: claimed!.version,
        workerId: 'worker-evidence-chips',
        operationId: p.operationId,
        aiRunId: p.aiRunId,
        evaluationId: evalId,
        productId: FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        revisionNumber: revNum,
        contentHashHex: prep.contentHashHex,
        deterministicResult: prep.deterministicResult,
        reservedSpend: prep.reservedSpend,
        policyVersion: prep.policyVersion,
        policyHashHex: prep.policyHashHex,
        providerInput: prep.providerInput,
        providerInputHash: prep.providerInputHash,
        briefSnapshot: prep.briefSnapshot,
        planningRevisionsSnapshot: prep.planningRevisionsSnapshot,
        contextPackageSnapshot: prep.contextPackageSnapshot,
        providerResult: advisoryWithForeignChips,
      });
      await settleCl.query('COMMIT');
    } finally {
      settleCl.release();
    }

    // Assert findings in DB only contain allowed factId
    const findingsRows = await pool.query(
      `SELECT evidence_ids_json FROM compliance_findings WHERE evaluation_id = $1 AND code = 'CLAIM_DISCLOSURE_WEAK'`,
      [evalId],
    );
    expect(findingsRows.rowCount).toBe(1);
    const persistedEvidence = findingsRows.rows[0].evidence_ids_json as string[];
    expect(persistedEvidence).toEqual([factId]);
    expect(persistedEvidence).not.toContain('foreign-cross-tenant-chip-999');
    expect(persistedEvidence).not.toContain('arbitrary-injected-id');
  });

  it('acceptance freshness checks reject mismatched report, advanced container, and drifted evidence/lineage', async () => {
    // Check latest revision (completed in previous test with warnings)
    const artRes = await pool.query(
      `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const revNum = Number(artRes.rows[0].current_revision_number);
    const curVersion = Number(artRes.rows[0].version);

    const revRes = await pool.query(
      `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum],
    );
    const revHashHex = Buffer.from(revRes.rows[0].content_hash).toString('hex');

    const evalRow = await pool.query(
      `SELECT id, evaluation_report_artifact_id, evaluation_report_revision_number
       FROM compliance_evaluations
       WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3 AND status = 'completed'`,
      [wsId, artifactId, revNum],
    );
    expect(evalRow.rowCount).toBe(1);
    const repArtId = evalRow.rows[0].evaluation_report_artifact_id;
    const repRevNum = evalRow.rows[0].evaluation_report_revision_number;

    const makeIdemp = (rawKey: string, routeKey: string) => ({
      rawKey,
      keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      requestHash: new Uint8Array(32),
      routeKey,
    });

    // 1. Advanced report container revision
    await pool.query(`UPDATE content_artifacts SET current_revision_number = 99 WHERE id = $1`, [
      repArtId,
    ]);

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: curVersion,
        revisionNumber: revNum,
        contentHashHex: revHashHex,
        idempotency: makeIdemp(
          '019318b2-5f33-722e-a5df-036f007b89ab',
          `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        ),
      }),
    ).rejects.toThrow(ComplianceEvaluationStaleError);

    // Restore report container current_revision_number
    await pool.query(`UPDATE content_artifacts SET current_revision_number = $1 WHERE id = $2`, [
      repRevNum,
      repArtId,
    ]);

    // 2. Evidence revoked/missing after evaluation
    const origWo = await pool.query(`SELECT context_package_id FROM work_orders WHERE id = $1`, [
      workOrderId,
    ]);
    const origCpId = origWo.rows[0].context_package_id;

    const emptyFsId = generateUuidV7();
    await pool.query(
      `INSERT INTO product_fact_sets (id, workspace_id, product_id, revision_number, status, created_by_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, 999, 'proposed', $4, NOW(), NOW())`,
      [emptyFsId, wsId, FIXTURE_IDS.prodId, userId],
    );
    const emptyCpId = generateUuidV7();
    await pool.query(
      `INSERT INTO context_packages (id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [emptyCpId, wsId, FIXTURE_IDS.prodId, emptyFsId, Buffer.alloc(32, 1), userId],
    );

    await pool.query(`UPDATE work_orders SET context_package_id = $1 WHERE id = $2`, [
      emptyCpId,
      workOrderId,
    ]);

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: curVersion,
        revisionNumber: revNum,
        contentHashHex: revHashHex,
        idempotency: makeIdemp(
          '019318b2-5f33-722e-a5df-036f007b89ac',
          `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        ),
      }),
    ).rejects.toThrow(ComplianceEvaluationStaleError);

    // Restore work order context package
    await pool.query(`UPDATE work_orders SET context_package_id = $1 WHERE id = $2`, [
      origCpId,
      workOrderId,
    ]);

    // 3. Lineage planning artifact revision drifted after evaluation
    await pool.query(
      `UPDATE content_artifacts SET current_revision_number = 999
       WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'product_campaign_plan'`,
      [wsId, workOrderId],
    );

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: curVersion,
        revisionNumber: revNum,
        contentHashHex: revHashHex,
        idempotency: makeIdemp(
          '019318b2-5f33-722e-a5df-036f007b89ae',
          `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        ),
      }),
    ).rejects.toThrow(ComplianceEvaluationStaleError);

    // Restore planning revision
    await pool.query(
      `UPDATE content_artifacts SET current_revision_number = 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'product_campaign_plan'`,
      [wsId, workOrderId],
    );

    // 4. Clean acceptance succeeds!
    const acceptRes = await adapter.acceptScriptRevision({
      workspaceId: typedWsId,
      artifactId,
      actorUserId: typedUserId,
      expectedVersion: curVersion,
      revisionNumber: revNum,
      contentHashHex: revHashHex,
      note: 'Accepted with warnings acknowledged',
      idempotency: makeIdemp(
        '019318b2-5f33-722e-a5df-036f007b89af',
        `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
      ),
    });
    expect(acceptRes.artifact.artifact.lifecycleStatus).toBe('accepted');

    // 5. Lineage brief drifted after evaluation
    const revBriefTest = await createTestRevision('Test brief drift during accept');
    const briefRevNum = revBriefTest.artifact.currentRevisionNumber;
    const briefVersion = revBriefTest.artifact.version;
    const briefRevHashHex = Buffer.from(
      (
        await pool.query(
          `SELECT content_hash FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
          [artifactId, briefRevNum],
        )
      ).rows[0].content_hash,
    ).toString('hex');

    // Settle compliance for this revision so it has a completed evaluation
    const claimedBrief = await jobAdapter.claimNextJob({
      workerId: 'worker-brief-freshness',
      leaseDurationSeconds: 30,
    });
    const pBrief = claimedBrief!.payloadJson as unknown as TestJobPayload;
    const evalBriefRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, briefRevNum],
    );
    await runComplianceExecutionThreePhase(fakeComplianceGateway, {
      workspaceId: wsId,
      jobId: claimedBrief!.id,
      jobVersion: claimedBrief!.version,
      workerId: 'worker-brief-freshness',
      operationId: pBrief.operationId,
      aiRunId: pBrief.aiRunId,
      evaluationId: evalBriefRow.rows[0].id,
      productId: FIXTURE_IDS.prodId,
      workOrderId,
      artifactId,
      revisionNumber: briefRevNum,
      policyVersion: pBrief.policyVersion,
    });

    // Insert brief version 999 with drifted hash
    await pool.query(
      `INSERT INTO content_briefs (
         id, workspace_id, product_id, work_order_id, brief_version, brief_json, brief_hash, created_at
       ) VALUES ($1, $2, $3, $4, 999, '{}'::jsonb, $5, NOW())`,
      [generateUuidV7(), wsId, FIXTURE_IDS.prodId, workOrderId, Buffer.alloc(32, 9)],
    );

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: briefVersion,
        revisionNumber: briefRevNum,
        contentHashHex: briefRevHashHex,
        idempotency: makeIdemp(
          '019318b2-5f33-722e-a5df-036f007b89ad',
          `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        ),
      }),
    ).rejects.toThrow(ComplianceEvaluationStaleError);

    // Restore content brief state by inserting higher version with original hash
    const origBriefRes = await pool.query(
      `SELECT brief_hash, brief_json FROM content_briefs WHERE work_order_id = $1 AND brief_version = 1`,
      [workOrderId],
    );
    await pool.query(
      `INSERT INTO content_briefs (
         id, workspace_id, product_id, work_order_id, brief_version, brief_json, brief_hash, created_at
       ) VALUES ($1, $2, $3, $4, 1000, $5::jsonb, $6, NOW())`,
      [
        generateUuidV7(),
        wsId,
        FIXTURE_IDS.prodId,
        workOrderId,
        JSON.stringify(origBriefRes.rows[0].brief_json),
        origBriefRes.rows[0].brief_hash,
      ],
    );
  });

  it('enforces live lease expiry and checked row counts across all terminalizers', async () => {
    const revLease = await createTestRevision('Test lease expiry');
    const revNum = revLease.artifact.currentRevisionNumber;

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-lease-fence-test',
      leaseDurationSeconds: 30,
    });
    expect(claimed?.payloadJson.revisionNumber).toBe(revNum);
    const p = claimed!.payloadJson as unknown as TestJobPayload;
    const jobId = claimed!.id;

    const evalRow = await pool.query(
      `SELECT id FROM compliance_evaluations WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum],
    );
    const evalId = evalRow.rows[0].id;

    // Manually expire the lease in DB
    await pool.query(
      `UPDATE job_executions
       SET lease_expires_at = NOW() - INTERVAL '10 seconds'
       WHERE id = $1`,
      [jobId],
    );

    const clTest = await pool.connect();
    try {
      await clTest.query('BEGIN');

      // settleCompliancePreflightBlockerAtomic should throw JobLeaseExpiredError
      await expect(
        settleCompliancePreflightBlockerAtomic(clTest, {
          workspaceId: wsId,
          jobId,
          jobVersion: claimed!.version,
          workerId: 'worker-lease-fence-test',
          operationId: p.operationId,
          aiRunId: p.aiRunId,
          evaluationId: evalId,
          productId: FIXTURE_IDS.prodId,
          workOrderId,
          artifactId,
          revisionNumber: revNum,
          deterministicResult: {
            passed: false,
            result: 'blocked',
            blockingCount: 1,
            warningCount: 0,
            infoCount: 0,
            policyVersion: CURRENT_COMPLIANCE_POLICY_VERSION,
            policyHash: '0'.repeat(64),
            findings: [],
          },
          scriptContent: {} as ScriptPackage,
          contentHashHex: '0'.repeat(64),
          reservedSpend: 10_000,
        }),
      ).rejects.toThrow(JobLeaseExpiredError);

      // settleComplianceBudgetExhaustedAtomic should throw JobLeaseExpiredError
      await expect(
        settleComplianceBudgetExhaustedAtomic(clTest, {
          workspaceId: wsId,
          jobId,
          jobVersion: claimed!.version,
          workerId: 'worker-lease-fence-test',
          operationId: p.operationId,
          aiRunId: p.aiRunId,
          evaluationId: evalId,
          productId: FIXTURE_IDS.prodId,
          workOrderId,
          artifactId,
          revisionNumber: revNum,
          deterministicResult: {
            passed: true,
            result: 'passed',
            blockingCount: 0,
            warningCount: 0,
            infoCount: 0,
            policyVersion: CURRENT_COMPLIANCE_POLICY_VERSION,
            policyHash: '0'.repeat(64),
            findings: [],
          },
        }),
      ).rejects.toThrow(JobLeaseExpiredError);

      // settleComplianceDriftAtomic should throw JobLeaseExpiredError
      await expect(
        settleComplianceDriftAtomic(clTest, {
          workspaceId: wsId,
          jobId,
          jobVersion: claimed!.version,
          workerId: 'worker-lease-fence-test',
          operationId: p.operationId,
          aiRunId: p.aiRunId,
          evaluationId: evalId,
          workOrderId,
          reason: 'Test lease fence',
          reservedSpend: 10_000,
        }),
      ).rejects.toThrow(JobLeaseExpiredError);

      await clTest.query('ROLLBACK');
    } finally {
      clTest.release();
    }

    // Clean up expired test job so it does not poison subsequent tests
    await pool.query(
      `UPDATE job_executions
       SET status = 'failed', completed_at = NOW(), last_error_category = 'provider_timeout', lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1`,
      [jobId],
    );
    await pool.query(
      `UPDATE compliance_evaluations
       SET status = 'failed', result = 'failed'
       WHERE id = $1`,
      [evalId],
    );
  });

  async function insertScriptRevisionWithEvaluation(options: {
    scriptContent: ScriptPackage;
    reportContent: ComplianceReportContent;
    evalOverrides?: Partial<{
      status: string;
      result: string;
      blockingCount: number;
      warningCount: number;
      infoCount: number;
      deterministicPassed: boolean;
      aiAdvisoryStatus: string;
      contextPackageId: string;
    }>;
  }) {
    const artRes = await pool.query(
      `SELECT current_revision_number, version FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const targetRevNum = Number(artRes.rows[0].current_revision_number) + 1;
    const scriptHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(options.scriptContent), 'utf8')
      .digest();

    // 1. Script revision
    await pool.query(
      `INSERT INTO content_artifact_revisions (
         id, workspace_id, artifact_id, revision_number, content_json, content_hash,
         schema_version, prompt_template, prompt_version, provider, model,
         author_role_key, created_at
       ) VALUES (
         $1, $2, $3, $4, $5::jsonb, $6,
         1, 'test', '1.0', 'test', 'test',
         'scriptwriter', NOW()
       )`,
      [
        generateUuidV7(),
        wsId,
        artifactId,
        targetRevNum,
        JSON.stringify(options.scriptContent),
        scriptHash,
      ],
    );

    // 2. Lineage
    const linRes = await pool.query(
      `SELECT content_brief_hash, content_brief_version, planning_revision_ids_json
       FROM content_artifact_lineage
       WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = 1`,
      [wsId, artifactId],
    );
    await pool.query(
      `INSERT INTO content_artifact_lineage (
         id, workspace_id, artifact_id, revision_number, lineage_type,
         content_brief_hash, content_brief_version, planning_revision_ids_json, created_at
       ) VALUES ($1, $2, $3, $4, 'human_edited', $5, $6, $7::jsonb, NOW())`,
      [
        generateUuidV7(),
        wsId,
        artifactId,
        targetRevNum,
        linRes.rows[0].content_brief_hash,
        linRes.rows[0].content_brief_version,
        JSON.stringify(linRes.rows[0].planning_revision_ids_json),
      ],
    );

    // 3. Advance artifact current_revision_number
    const upArt = await pool.query(
      `UPDATE content_artifacts
       SET current_revision_number = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2
       RETURNING version`,
      [targetRevNum, artifactId],
    );
    const expectedVersion = Number(upArt.rows[0].version);

    // 4. Report revision
    const repArtRes = await pool.query(
      `SELECT id FROM content_artifacts WHERE workspace_id = $1 AND artifact_type = 'compliance_report' LIMIT 1`,
      [wsId],
    );
    const repArtId = repArtRes.rows[0].id;
    const repRevNumRes = await pool.query(
      `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_rev FROM content_artifact_revisions WHERE artifact_id = $1`,
      [repArtId],
    );
    const repRevNum = Number(repRevNumRes.rows[0].next_rev);
    const repHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(options.reportContent), 'utf8')
      .digest();

    await pool.query(
      `INSERT INTO content_artifact_revisions (
         id, workspace_id, artifact_id, revision_number, content_json, content_hash,
         schema_version, prompt_template, prompt_version, provider, model,
         author_role_key, created_at
       ) VALUES (
         $1, $2, $3, $4, $5::jsonb, $6,
         1, 'test', '1.0', 'test', 'test',
         'compliance_reviewer', NOW()
       )`,
      [generateUuidV7(), wsId, repArtId, repRevNum, JSON.stringify(options.reportContent), repHash],
    );
    await pool.query(
      `UPDATE content_artifacts SET current_revision_number = $1, version = version + 1 WHERE id = $2`,
      [repRevNum, repArtId],
    );

    // 5. Compliance evaluation
    const evalId = generateUuidV7();
    const policyVersion = CURRENT_COMPLIANCE_POLICY_VERSION;
    const policyHash = Buffer.from(computeCompliancePolicyHash(policyVersion), 'hex');
    const woRow = await pool.query(`SELECT context_package_id FROM work_orders WHERE id = $1`, [
      workOrderId,
    ]);
    const cpId = options.evalOverrides?.contextPackageId ?? woRow.rows[0].context_package_id;

    await pool.query(
      `INSERT INTO compliance_evaluations (
         id, workspace_id, product_id, work_order_id, artifact_id, revision_number,
         policy_version, policy_hash, status, result, blocking_count, warning_count,
         info_count, deterministic_passed, ai_advisory_status,
         evaluation_report_artifact_id, evaluation_report_revision_number,
         evaluation_report_content_hash, script_content_hash, context_package_id,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13, $14, $15,
         $16, $17,
         $18, $19, $20,
         NOW(), NOW()
       )`,
      [
        evalId,
        wsId,
        FIXTURE_IDS.prodId,
        workOrderId,
        artifactId,
        targetRevNum,
        policyVersion,
        policyHash,
        options.evalOverrides?.status ?? 'completed',
        options.evalOverrides?.result ?? 'passed',
        options.evalOverrides?.blockingCount ?? 0,
        options.evalOverrides?.warningCount ?? 0,
        options.evalOverrides?.infoCount ?? 0,
        options.evalOverrides?.deterministicPassed ?? true,
        options.evalOverrides?.aiAdvisoryStatus ?? 'skipped',
        repArtId,
        repRevNum,
        repHash,
        scriptHash,
        cpId,
      ],
    );

    return {
      revisionNumber: targetRevNum,
      expectedVersion,
      contentHashHex: scriptHash.toString('hex'),
      evalId,
    };
  }

  it('acceptance rejects report with mismatched infoCount or deterministicPassed', async () => {
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    const makeIdemp = (rawKey: string, routeKey: string) => ({
      rawKey,
      keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      requestHash: new Uint8Array(32),
      routeKey,
    });

    const baseReportContent: ComplianceReportContent = {
      schemaVersion: 1,
      policyVersion: CURRENT_COMPLIANCE_POLICY_VERSION,
      policyHash: computeCompliancePolicyHash(CURRENT_COMPLIANCE_POLICY_VERSION),
      scriptArtifactId: artifactId,
      scriptRevisionNumber: 999,
      scriptContentHash: '',
      result: 'passed',
      blockingCount: 0,
      warningCount: 0,
      infoCount: 0,
      deterministicPassed: true,
      aiAdvisoryStatus: 'skipped',
      findings: [],
      summary: 'Clean deterministic test',
      evaluatedAt: new Date().toISOString(),
    };

    const artRes = await pool.query(
      `SELECT current_revision_number FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const nextRevNum = Number(artRes.rows[0].current_revision_number) + 1;
    const scriptHashHex = crypto
      .createHash('sha256')
      .update(JSON.stringify(cleanPkg), 'utf8')
      .digest('hex');

    // 1. Report infoCount (0) mismatches evaluation info_count (99)
    const repMismatchInfo: ComplianceReportContent = {
      ...baseReportContent,
      scriptRevisionNumber: nextRevNum,
      scriptContentHash: scriptHashHex,
      infoCount: 0,
    };

    const test1 = await insertScriptRevisionWithEvaluation({
      scriptContent: cleanPkg,
      reportContent: repMismatchInfo,
      evalOverrides: { infoCount: 99 },
    });

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: test1.expectedVersion,
        revisionNumber: test1.revisionNumber,
        contentHashHex: test1.contentHashHex,
        idempotency: makeIdemp(
          generateUuidV7(),
          `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        ),
      }),
    ).rejects.toThrow(ComplianceEvaluationNotApprovableError);

    // 2. Report deterministicPassed (true) mismatches evaluation deterministic_passed (false)
    const artRes2 = await pool.query(
      `SELECT current_revision_number FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const nextRevNum2 = Number(artRes2.rows[0].current_revision_number) + 1;

    const repMismatchDet: ComplianceReportContent = {
      ...baseReportContent,
      scriptRevisionNumber: nextRevNum2,
      scriptContentHash: scriptHashHex,
      deterministicPassed: true,
    };

    const test2 = await insertScriptRevisionWithEvaluation({
      scriptContent: cleanPkg,
      reportContent: repMismatchDet,
      evalOverrides: { deterministicPassed: false },
    });

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: test2.expectedVersion,
        revisionNumber: test2.revisionNumber,
        contentHashHex: test2.contentHashHex,
        idempotency: makeIdemp(
          generateUuidV7(),
          `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        ),
      }),
    ).rejects.toThrow(ComplianceEvaluationNotApprovableError);
  });

  it('acceptance rejects evaluation if work order is repointed to a different context package even with same facts', async () => {
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;
    const scriptHashHex = crypto
      .createHash('sha256')
      .update(JSON.stringify(cleanPkg), 'utf8')
      .digest('hex');

    const artRes = await pool.query(
      `SELECT current_revision_number FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const nextRevNum = Number(artRes.rows[0].current_revision_number) + 1;

    const reportContent: ComplianceReportContent = {
      schemaVersion: 1,
      policyVersion: CURRENT_COMPLIANCE_POLICY_VERSION,
      policyHash: computeCompliancePolicyHash(CURRENT_COMPLIANCE_POLICY_VERSION),
      scriptArtifactId: artifactId,
      scriptRevisionNumber: nextRevNum,
      scriptContentHash: scriptHashHex,
      result: 'passed',
      blockingCount: 0,
      warningCount: 0,
      infoCount: 0,
      deterministicPassed: true,
      aiAdvisoryStatus: 'skipped',
      findings: [],
      summary: 'Clean report',
      evaluatedAt: new Date().toISOString(),
    };

    const inserted = await insertScriptRevisionWithEvaluation({
      scriptContent: cleanPkg,
      reportContent,
    });

    // Create second context package with same fact set
    const secondCpId = generateUuidV7();
    await pool.query(
      `INSERT INTO context_packages (id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [secondCpId, wsId, FIXTURE_IDS.prodId, factSetId, Buffer.alloc(32, 5), userId],
    );

    const woOrig = await pool.query(`SELECT context_package_id FROM work_orders WHERE id = $1`, [
      workOrderId,
    ]);
    const origCp = woOrig.rows[0].context_package_id;

    // Repoint work order to second context package
    await pool.query(`UPDATE work_orders SET context_package_id = $1 WHERE id = $2`, [
      secondCpId,
      workOrderId,
    ]);

    const makeIdemp = (rawKey: string, routeKey: string) => ({
      rawKey,
      keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      requestHash: new Uint8Array(32),
      routeKey,
    });

    try {
      await expect(
        adapter.acceptScriptRevision({
          workspaceId: typedWsId,
          artifactId,
          actorUserId: typedUserId,
          expectedVersion: inserted.expectedVersion,
          revisionNumber: inserted.revisionNumber,
          contentHashHex: inserted.contentHashHex,
          idempotency: makeIdemp(
            generateUuidV7(),
            `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
          ),
        }),
      ).rejects.toThrow(ComplianceEvaluationStaleError);
    } finally {
      // Restore original context package
      await pool.query(`UPDATE work_orders SET context_package_id = $1 WHERE id = $2`, [
        origCp,
        workOrderId,
      ]);
    }
  });

  it('acceptance validates video.evidenceReferences and catches unallowed evidence in video', async () => {
    const rev1Row = await pool.query(
      `SELECT content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = 1`,
      [artifactId],
    );
    const cleanPkg = rev1Row.rows[0].content_json as ScriptPackage;

    // Video 1 references an unallowed foreign evidence ID
    const foreignFactId = generateUuidV7();
    const tamperedVideos = cleanPkg.videos.map((v) =>
      v.videoNumber === 1
        ? {
            ...v,
            evidenceReferences: [{ sourceKind: 'product_fact', sourceId: foreignFactId }],
          }
        : v,
    );
    const scriptWithForeignEv: ScriptPackage = {
      ...cleanPkg,
      videos: tamperedVideos as unknown as ScriptPackage['videos'],
    };
    const scriptHashHex = crypto
      .createHash('sha256')
      .update(JSON.stringify(scriptWithForeignEv), 'utf8')
      .digest('hex');

    const artRes = await pool.query(
      `SELECT current_revision_number FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const nextRevNum = Number(artRes.rows[0].current_revision_number) + 1;

    const reportContent: ComplianceReportContent = {
      schemaVersion: 1,
      policyVersion: CURRENT_COMPLIANCE_POLICY_VERSION,
      policyHash: computeCompliancePolicyHash(CURRENT_COMPLIANCE_POLICY_VERSION),
      scriptArtifactId: artifactId,
      scriptRevisionNumber: nextRevNum,
      scriptContentHash: scriptHashHex,
      result: 'passed',
      blockingCount: 0,
      warningCount: 0,
      infoCount: 0,
      deterministicPassed: true,
      aiAdvisoryStatus: 'skipped',
      findings: [],
      summary: 'Clean report',
      evaluatedAt: new Date().toISOString(),
    };

    const inserted = await insertScriptRevisionWithEvaluation({
      scriptContent: scriptWithForeignEv,
      reportContent,
    });

    const makeIdemp = (rawKey: string, routeKey: string) => ({
      rawKey,
      keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      requestHash: new Uint8Array(32),
      routeKey,
    });

    await expect(
      adapter.acceptScriptRevision({
        workspaceId: typedWsId,
        artifactId,
        actorUserId: typedUserId,
        expectedVersion: inserted.expectedVersion,
        revisionNumber: inserted.revisionNumber,
        contentHashHex: inserted.contentHashHex,
        idempotency: makeIdemp(
          generateUuidV7(),
          `POST /api/v1/workspaces/${wsId}/artifacts/${artifactId}/accept`,
        ),
      }),
    ).rejects.toThrow(ComplianceEvaluationStaleError);
  });
});
