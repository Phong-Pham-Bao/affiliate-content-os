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
import { requestScriptChangesTransaction } from '../../src/workforce/workforce-request-changes.js';
import { createManualRevisionTransaction } from '../../src/workforce/workforce-manual-revision.js';
import { assembleScriptPackageChangeRequestAtomic } from '../../src/workforce/workforce-change-request-assembly.js';
import type { ScriptPackage } from '@affiliate-content-os/domain';

describe('workforce-checkpoint-c-remediation-02.integration (Terminal States, Drift, & Attempt Accounting)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, factSetId, analysisId1, userId } = FIXTURE_IDS;
  let factId: string;
  let workOrderId: string;
  let artifactId: string;

  function makeTestIdemp(routeKey: string, key = 'test-idemp-rem2') {
    const rawKey = `${key}-${Date.now()}-${Math.random()}`;
    return {
      rawKey,
      keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      requestHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      routeKey,
    };
  }

  async function getArtifactState() {
    const artRes = await pool.query(
      `SELECT version, current_revision_number FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const revNum = Number(artRes.rows[0].current_revision_number);
    const revRes = await pool.query(
      `SELECT content_hash, content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum],
    );
    return {
      version: Number(artRes.rows[0].version),
      currentRevisionNumber: revNum,
      contentHashHex: Buffer.from(revRes.rows[0].content_hash).toString('hex'),
      contentJson: revRes.rows[0].content_json as ScriptPackage,
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

    // Kickoff work order and finish planning to establish 5 initial scriptwriting jobs
    const params = createTestKickoffParams();
    workOrderId = params.workOrder.id;
    await adapter.kickoffWorkOrderAtomic(params);

    const gateway = createFakeCheckpointCGateway(factId, analysisId1);
    await processThreePlanningJobs(pool, jobAdapter, gateway);

    // Settle 5 initial units to create initial revision 1 of script_package
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
              tokenInput: 600,
              tokenOutput: 350,
              costMicrounits: 9500,
              costCurrency: 'USD',
              latencyMs: 400,
            },
            evidenceReferences: s.video.evidenceReferences ?? [],
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

  describe('1. Assignment State on Change-Request Terminal Outcomes', () => {
    it('transitions assignment to review_required on completed change request', async () => {
      const artState = await getArtifactState();

      // 1. Create change request for video 3
      const crClient = await pool.connect();
      let crId: string;
      try {
        await crClient.query('BEGIN');
        const crRes = await requestScriptChangesTransaction(crClient, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: artState.version,
          baseRevisionNumber: artState.currentRevisionNumber,
          baseContentHashHex: artState.contentHashHex,
          instructionText: 'Update video 3 scenes',
          selectedVideoNumbers: [3],
          targetVariantCount: 1,
          idempotency: makeTestIdemp('req-changes-comp'),
        });
        crId = crRes.id;
        await crClient.query('COMMIT');
      } finally {
        crClient.release();
      }

      // Verify assignment is currently running
      const asgBefore = await pool.query(
        `SELECT aa.office_state
         FROM agent_assignments aa
         JOIN agent_role_definitions rd ON rd.id = aa.role_definition_id
         WHERE aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
        [wsId, workOrderId],
      );
      expect(asgBefore.rows[0].office_state).toBe('running');

      // Claim and settle the unit
      const claimed = await jobAdapter.claimNextJob({
        workerId: 'worker-cr-comp',
        leaseDurationSeconds: 30,
      });
      expect(claimed).not.toBeNull();

      const p = claimed!.payloadJson as Record<string, unknown>;
      const s = createFakeSingleVideoScript(3, factId);
      const h = new Uint8Array(
        crypto.createHash('sha256').update(JSON.stringify(s), 'utf8').digest(),
      );

      const settleClient = await pool.connect();
      try {
        await settleClient.query('BEGIN');
        await settleScriptUnitAtomic(settleClient, {
          workspaceId: wsId,
          productId: p.productId as string,
          workOrderId: p.workOrderId as string,
          workItemId: p.workItemId as string,
          assignmentId: p.assignmentId as string,
          jobId: claimed!.id,
          jobVersion: claimed!.version,
          operationId: p.operationId as string,
          aiRunId: p.aiRunId as string,
          workerId: 'worker-cr-comp',
          videoNumber: 3,
          changeRequestId: crId,
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
              tokenOutput: 250,
              costMicrounits: 7500,
              costCurrency: 'USD',
              latencyMs: 300,
            },
            evidenceReferences: s.video.evidenceReferences ?? [],
          },
        });
        await settleClient.query('COMMIT');
      } finally {
        settleClient.release();
      }

      // Verify change request is completed
      const crCheck = await pool.query(
        `SELECT status, resulting_revision_number FROM artifact_change_requests WHERE id = $1`,
        [crId],
      );
      expect(crCheck.rows[0].status).toBe('completed');
      expect(crCheck.rows[0].resulting_revision_number).toBe(2);

      // Verify assignment transitioned out of running to review_required
      const asgAfter = await pool.query(
        `SELECT aa.office_state
         FROM agent_assignments aa
         JOIN agent_role_definitions rd ON rd.id = aa.role_definition_id
         WHERE aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
        [wsId, workOrderId],
      );
      expect(asgAfter.rows[0].office_state).toBe('review_required');
    });

    it('transitions assignment to failed on terminal failure of a change request unit', async () => {
      const artState = await getArtifactState();

      // Create change request for video 4 against current base revision
      const crClient = await pool.connect();
      let crId: string;
      try {
        await crClient.query('BEGIN');
        const crRes = await requestScriptChangesTransaction(crClient, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: artState.version,
          baseRevisionNumber: artState.currentRevisionNumber,
          baseContentHashHex: artState.contentHashHex,
          instructionText: 'Update video 4 hook',
          selectedVideoNumbers: [4],
          targetVariantCount: 1,
          idempotency: makeTestIdemp('req-changes-fail'),
        });
        crId = crRes.id;
        await crClient.query('COMMIT');
      } finally {
        crClient.release();
      }

      const claimed = await jobAdapter.claimNextJob({
        workerId: 'worker-cr-fail',
        leaseDurationSeconds: 30,
      });
      expect(claimed).not.toBeNull();
      const p = claimed!.payloadJson as Record<string, unknown>;

      // Settle unit as terminal failure
      const settleClient = await pool.connect();
      try {
        await settleClient.query('BEGIN');
        await settleScriptUnitAtomic(settleClient, {
          workspaceId: wsId,
          productId: p.productId as string,
          workOrderId: p.workOrderId as string,
          workItemId: p.workItemId as string,
          assignmentId: p.assignmentId as string,
          jobId: claimed!.id,
          jobVersion: claimed!.version,
          operationId: p.operationId as string,
          aiRunId: p.aiRunId as string,
          workerId: 'worker-cr-fail',
          videoNumber: 4,
          changeRequestId: crId,
          reservedMicrounits: p.reservedMicrounits as number,
          outcome: {
            kind: 'terminal_failure',
            errorCategory: 'rate_limited',
            errorCode: 'PROVIDER_RATE_LIMIT_EXCEEDED',
            errorMessage: 'AI Provider rate limit reached',
          },
        });
        await settleClient.query('COMMIT');
      } finally {
        settleClient.release();
      }

      // Verify change request is failed with failure_code
      const crCheck = await pool.query(
        `SELECT status, failure_code, failure_reason FROM artifact_change_requests WHERE id = $1`,
        [crId],
      );
      expect(crCheck.rows[0].status).toBe('failed');
      expect(crCheck.rows[0].failure_code).toBe('provider_failure');

      // Verify assignment transitioned out of running to failed
      const asgAfter = await pool.query(
        `SELECT aa.office_state
         FROM agent_assignments aa
         JOIN agent_role_definitions rd ON rd.id = aa.role_definition_id
         WHERE aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
        [wsId, workOrderId],
      );
      expect(asgAfter.rows[0].office_state).toBe('failed');
    });

    it('transitions assignment to review_required on stale-conflict without rolling back or stuck in running', async () => {
      const artState = await getArtifactState();

      // 1. Create change request targeting video 5 against current base revision
      const crClient = await pool.connect();
      let crId: string;
      try {
        await crClient.query('BEGIN');
        const crRes = await requestScriptChangesTransaction(crClient, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: artState.version,
          baseRevisionNumber: artState.currentRevisionNumber,
          baseContentHashHex: artState.contentHashHex,
          instructionText: 'Update video 5 for stale conflict test',
          selectedVideoNumbers: [5],
          targetVariantCount: 1,
          idempotency: makeTestIdemp('req-changes-stale'),
        });
        crId = crRes.id;
        await crClient.query('COMMIT');
      } finally {
        crClient.release();
      }

      // 2. While change request is in flight, user creates a manual edit (next revision wins)
      const manualState = await getArtifactState();
      const manualClient = await pool.connect();
      try {
        await manualClient.query('BEGIN');
        await createManualRevisionTransaction(manualClient, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: manualState.version,
          baseRevisionNumber: manualState.currentRevisionNumber,
          baseContentHashHex: manualState.contentHashHex,
          content: {
            ...manualState.contentJson,
            seriesTitle: 'Manual Edit Superseded Revision',
          },
          note: 'Manual edit wins over change request',
          idempotency: makeTestIdemp('manual-stale-win'),
        });
        await manualClient.query('COMMIT');
      } finally {
        manualClient.release();
      }

      // 3. Now the change request unit finishes and calls settleScriptUnitAtomic (which detects stale base)
      const claimed = await jobAdapter.claimNextJob({
        workerId: 'worker-stale',
        leaseDurationSeconds: 30,
      });
      expect(claimed).not.toBeNull();
      const p = claimed!.payloadJson as Record<string, unknown>;
      const s = createFakeSingleVideoScript(5, factId);
      const h = new Uint8Array(
        crypto.createHash('sha256').update(JSON.stringify(s), 'utf8').digest(),
      );

      const settleClient = await pool.connect();
      try {
        await settleClient.query('BEGIN');
        await settleScriptUnitAtomic(settleClient, {
          workspaceId: wsId,
          productId: p.productId as string,
          workOrderId: p.workOrderId as string,
          workItemId: p.workItemId as string,
          assignmentId: p.assignmentId as string,
          jobId: claimed!.id,
          jobVersion: claimed!.version,
          operationId: p.operationId as string,
          aiRunId: p.aiRunId as string,
          workerId: 'worker-stale',
          videoNumber: 5,
          changeRequestId: crId,
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
              tokenOutput: 250,
              costMicrounits: 7500,
              costCurrency: 'USD',
              latencyMs: 300,
            },
            evidenceReferences: s.video.evidenceReferences ?? [],
          },
        });
        await settleClient.query('COMMIT');
      } finally {
        settleClient.release();
      }

      // Verify change request is marked failed with stale_base_conflict
      const crCheck = await pool.query(
        `SELECT status, failure_code FROM artifact_change_requests WHERE id = $1`,
        [crId],
      );
      expect(crCheck.rows[0].status).toBe('failed');
      expect(crCheck.rows[0].failure_code).toBe('stale_base_conflict');

      // Verify assignment is transitioned out of running to review_required (valid manual revision exists)
      const asgAfter = await pool.query(
        `SELECT aa.office_state
         FROM agent_assignments aa
         JOIN agent_role_definitions rd ON rd.id = aa.role_definition_id
         WHERE aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
        [wsId, workOrderId],
      );
      expect(asgAfter.rows[0].office_state).toBe('review_required');

      // Verify duplicate assembly is idempotent
      const asmClient2 = await pool.connect();
      try {
        await asmClient2.query('BEGIN');
        const duplicateAsm = await assembleScriptPackageChangeRequestAtomic(asmClient2, {
          workspaceId: wsId,
          changeRequestId: crId,
        });
        expect(duplicateAsm).toBe(false);
        await asmClient2.query('COMMIT');
      } finally {
        asmClient2.release();
      }
    });
  });

  describe('2. Attempt Accounting & Reservation Release', () => {
    it('proves claimNextJob increments attempt once and transient settlement does not double-increment', async () => {
      const artState = await getArtifactState();

      // Create a change request targeting video 1
      const crClient = await pool.connect();
      let crId: string;
      try {
        await crClient.query('BEGIN');
        const crRes = await requestScriptChangesTransaction(crClient, {
          workspaceId: wsId,
          artifactId,
          actorUserId: userId,
          expectedVersion: artState.version,
          baseRevisionNumber: artState.currentRevisionNumber,
          baseContentHashHex: artState.contentHashHex,
          instructionText: 'Update video 1 attempt accounting test',
          selectedVideoNumbers: [1],
          targetVariantCount: 1,
          idempotency: makeTestIdemp('attempt-accounting-cr'),
        });
        crId = crRes.id;
        await crClient.query('COMMIT');
      } finally {
        crClient.release();
      }

      // Check initial policy reserved spend
      const polBefore = await pool.query(
        `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
        [wsId],
      );
      const initReserved = Number(polBefore.rows[0].reserved_spend_microunits);

      // Attempt 1: Claim
      const claimed1 = await jobAdapter.claimNextJob({
        workerId: 'worker-accounting',
        leaseDurationSeconds: 30,
      });
      expect(claimed1).not.toBeNull();
      expect(claimed1!.attempt).toBe(1); // claimNextJob increments attempt to 1

      const p1 = claimed1!.payloadJson as Record<string, unknown>;
      const reservedMicros = claimed1!.reservedSpendMicrounits;

      // Settle transient failure 1
      const cl1 = await pool.connect();
      try {
        await cl1.query('BEGIN');
        await settleScriptUnitAtomic(cl1, {
          workspaceId: wsId,
          productId: p1.productId as string,
          workOrderId: p1.workOrderId as string,
          workItemId: p1.workItemId as string,
          assignmentId: p1.assignmentId as string,
          jobId: claimed1!.id,
          jobVersion: claimed1!.version,
          operationId: p1.operationId as string,
          aiRunId: p1.aiRunId as string,
          workerId: 'worker-accounting',
          videoNumber: 1,
          changeRequestId: crId,
          reservedMicrounits: reservedMicros,
          outcome: {
            kind: 'transient_failure',
            errorCategory: 'provider_unavailable',
            errorMessage: 'Network glitch 1',
            nextAttemptAt: new Date(Date.now() - 1000), // Ready immediately for attempt 2
          },
        });
        await cl1.query('COMMIT');
      } finally {
        cl1.release();
      }

      // Check DB: attempt must STILL be 1 (NOT 2)!
      const check1 = await pool.query(`SELECT attempt, status FROM job_executions WHERE id = $1`, [
        claimed1!.id,
      ]);
      expect(check1.rows[0].status).toBe('retry_wait');
      expect(check1.rows[0].attempt).toBe(1); // Proves NO double increment!

      // Attempt 2: Claim
      const claimed2 = await jobAdapter.claimNextJob({
        workerId: 'worker-accounting',
        leaseDurationSeconds: 30,
      });
      expect(claimed2).not.toBeNull();
      expect(claimed2!.id).toBe(claimed1!.id);
      expect(claimed2!.attempt).toBe(2); // Exactly 2

      // Settle transient failure 2
      const cl2 = await pool.connect();
      try {
        await cl2.query('BEGIN');
        await settleScriptUnitAtomic(cl2, {
          workspaceId: wsId,
          productId: p1.productId as string,
          workOrderId: p1.workOrderId as string,
          workItemId: p1.workItemId as string,
          assignmentId: p1.assignmentId as string,
          jobId: claimed2!.id,
          jobVersion: claimed2!.version,
          operationId: p1.operationId as string,
          aiRunId: p1.aiRunId as string,
          workerId: 'worker-accounting',
          videoNumber: 1,
          changeRequestId: crId,
          reservedMicrounits: reservedMicros,
          outcome: {
            kind: 'transient_failure',
            errorCategory: 'provider_unavailable',
            errorMessage: 'Network glitch 2',
            nextAttemptAt: new Date(Date.now() - 1000), // Ready immediately for attempt 3
          },
        });
        await cl2.query('COMMIT');
      } finally {
        cl2.release();
      }

      // Check DB: attempt must STILL be 2 (NOT 3 or 4)!
      const check2 = await pool.query(`SELECT attempt, status FROM job_executions WHERE id = $1`, [
        claimed1!.id,
      ]);
      expect(check2.rows[0].status).toBe('retry_wait');
      expect(check2.rows[0].attempt).toBe(2);

      // Attempt 3: Claim
      const claimed3 = await jobAdapter.claimNextJob({
        workerId: 'worker-accounting',
        leaseDurationSeconds: 30,
      });
      expect(claimed3).not.toBeNull();
      expect(claimed3!.id).toBe(claimed1!.id);
      expect(claimed3!.attempt).toBe(3); // Exactly 3 (max_attempts = 3)

      // Terminal failure settlement: budget release must occur exactly once
      const cl3 = await pool.connect();
      try {
        await cl3.query('BEGIN');
        await settleScriptUnitAtomic(cl3, {
          workspaceId: wsId,
          productId: p1.productId as string,
          workOrderId: p1.workOrderId as string,
          workItemId: p1.workItemId as string,
          assignmentId: p1.assignmentId as string,
          jobId: claimed3!.id,
          jobVersion: claimed3!.version,
          operationId: p1.operationId as string,
          aiRunId: p1.aiRunId as string,
          workerId: 'worker-accounting',
          videoNumber: 1,
          changeRequestId: crId,
          reservedMicrounits: reservedMicros,
          outcome: {
            kind: 'terminal_failure',
            errorCategory: 'provider_unavailable',
            errorCode: 'ATTEMPTS_EXHAUSTED',
            errorMessage: 'All 3 provider attempts failed',
          },
        });
        await cl3.query('COMMIT');
      } finally {
        cl3.release();
      }

      // Verify terminal state in DB
      const check3 = await pool.query(
        `SELECT attempt, status, reserved_spend_microunits FROM job_executions WHERE id = $1`,
        [claimed1!.id],
      );
      expect(check3.rows[0].status).toBe('failed');
      expect(check3.rows[0].attempt).toBe(3); // Exactly 3 attempts, no extra counts
      expect(Number(check3.rows[0].reserved_spend_microunits)).toBe(0);

      // Verify reservation was released exactly once
      const polAfter = await pool.query(
        `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
        [wsId],
      );
      expect(Number(polAfter.rows[0].reserved_spend_microunits)).toBe(
        initReserved - reservedMicros,
      );

      // Verify change request marked failed with provider_failure
      const crFinal = await pool.query(
        `SELECT status, failure_code FROM artifact_change_requests WHERE id = $1`,
        [crId],
      );
      expect(crFinal.rows[0].status).toBe('failed');
      expect(crFinal.rows[0].failure_code).toBe('provider_failure');

      // Verify assignment transitioned out of running to failed
      const asgFinal = await pool.query(
        `SELECT aa.office_state
         FROM agent_assignments aa
         JOIN agent_role_definitions rd ON rd.id = aa.role_definition_id
         WHERE aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
        [wsId, workOrderId],
      );
      expect(asgFinal.rows[0].office_state).toBe('failed');
    });
  });
});
