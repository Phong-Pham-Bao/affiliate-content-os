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

describe('workforce-checkpoint-c-execution.integration (Execution, Capacity, Idempotency & Release)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, factSetId, analysisId1 } = FIXTURE_IDS;
  let factId: string;

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
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('automatically enqueues 5 script units after 3 planning items complete, enforces 3-concurrent gate, handles partial failure & retry, lease fencing, and idempotency', async () => {
    const params = createTestKickoffParams();
    await adapter.kickoffWorkOrderAtomic(params);

    const gateway = createFakeCheckpointCGateway(factId, analysisId1);

    // Process 3 planning jobs -> triggers automatic scriptwriting stage enqueue!
    await processThreePlanningJobs(pool, jobAdapter, gateway);

    // 1. Verify automatic 5-unit enqueue after planning
    const unitsRes = await pool.query(
      `SELECT * FROM script_generation_units WHERE work_order_id = $1 ORDER BY video_number ASC`,
      [params.workOrder.id],
    );
    expect(unitsRes.rows).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(unitsRes.rows[i].video_number).toBe(i + 1);
      expect(unitsRes.rows[i].status).toBe('queued');
    }

    // Verify 50,000 microunits reserved in AI policy (5 * 10,000)
    const policyRes = await pool.query(
      `SELECT reserved_spend_microunits, current_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    // 3 planning actual spend = 3 * 45,000 = 135,000; scriptwriting reserved = 50,000
    expect(Number(policyRes.rows[0].reserved_spend_microunits)).toBe(50000);
    expect(Number(policyRes.rows[0].current_spend_microunits)).toBe(135000);

    // Verify scriptwriting work item and assignment are running
    const woDetailBefore = await adapter.getWorkOrderById(wsId, params.workOrder.id);
    const swItem = woDetailBefore!.workItems.find((w) => w.taskKey === 'scriptwriting');
    expect(swItem!.status).toBe('running');
    const swAsg = woDetailBefore!.assignments.find((a) => a.roleKey === 'scriptwriter');
    expect(swAsg!.officeState).toBe('running');

    // 2. Capacity Gate: Maximum 3 concurrent live units
    const claimedJob1 = await jobAdapter.claimNextJob({
      workerId: 'worker-1',
      leaseDurationSeconds: 30,
    });
    const claimedJob2 = await jobAdapter.claimNextJob({
      workerId: 'worker-2',
      leaseDurationSeconds: 30,
    });
    const claimedJob3 = await jobAdapter.claimNextJob({
      workerId: 'worker-3',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob1).not.toBeNull();
    expect(claimedJob2).not.toBeNull();
    expect(claimedJob3).not.toBeNull();

    // 4th claim must return null because workspace has 3 running jobs!
    const claimedJob4 = await jobAdapter.claimNextJob({
      workerId: 'worker-4',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob4).toBeNull();

    // 3. Settle Unit 1 successfully
    const p1 = claimedJob1!.payloadJson as {
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
    const s1 = createFakeSingleVideoScript(1, factId);
    const h1 = new Uint8Array(
      crypto.createHash('sha256').update(JSON.stringify(s1), 'utf8').digest(),
    );

    const client1 = await pool.connect();
    try {
      await client1.query('BEGIN');
      await settleScriptUnitAtomic(client1, {
        workspaceId: p1.workspaceId,
        productId: p1.productId,
        workOrderId: p1.workOrderId,
        workItemId: p1.workItemId,
        assignmentId: p1.assignmentId,
        jobId: claimedJob1!.id,
        jobVersion: claimedJob1!.version,
        operationId: p1.operationId,
        aiRunId: p1.aiRunId,
        workerId: 'worker-1',
        videoNumber: 1,
        changeRequestId: null,
        reservedMicrounits: p1.reservedMicrounits,
        outcome: {
          kind: 'success',
          contentJson: s1,
          contentHash: h1,
          schemaVersion: 1,
          promptTemplate: 'script_video_v1',
          promptVersion: '1.0.0',
          provider: 'google',
          model: 'gemini-3.8-flash',
          usage: {
            tokenInput: 400,
            tokenOutput: 250,
            costMicrounits: 10000,
            costCurrency: 'USD',
            latencyMs: 300,
          },
          evidenceReferences: s1.video.evidenceReferences,
        },
      });
      await client1.query('COMMIT');
    } finally {
      client1.release();
    }

    // Now that Job 1 completed, 4th job can be claimed!
    const claimedJob4After = await jobAdapter.claimNextJob({
      workerId: 'worker-4',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob4After).not.toBeNull();

    // 4. Lease fencing test: attempt to settle claimedJob1 again with old version or expired lease
    const clientFence = await pool.connect();
    try {
      await clientFence.query('BEGIN');
      await expect(
        settleScriptUnitAtomic(clientFence, {
          workspaceId: p1.workspaceId,
          productId: p1.productId,
          workOrderId: p1.workOrderId,
          workItemId: p1.workItemId,
          assignmentId: p1.assignmentId,
          jobId: claimedJob1!.id,
          jobVersion: claimedJob1!.version, // Old version
          operationId: p1.operationId,
          aiRunId: p1.aiRunId,
          workerId: 'worker-1',
          videoNumber: 1,
          changeRequestId: null,
          reservedMicrounits: p1.reservedMicrounits,
          outcome: {
            kind: 'success',
            contentJson: s1,
            contentHash: h1,
            schemaVersion: 1,
            promptTemplate: 't',
            promptVersion: 'v',
            provider: 'p',
            model: 'm',
            usage: {
              tokenInput: 1,
              tokenOutput: 1,
              costMicrounits: 10000,
              costCurrency: 'USD',
              latencyMs: 1,
            },
            evidenceReferences: s1.video.evidenceReferences,
          },
        }),
      ).rejects.toThrow(/Lease fencing conflict/);
      await clientFence.query('ROLLBACK');
    } finally {
      clientFence.release();
    }

    // 5. Settle jobs 2, 3, 4 successfully
    for (const [claimed, vNum, workerId] of [
      [claimedJob2, 2, 'worker-2'],
      [claimedJob3, 3, 'worker-3'],
      [claimedJob4After, 4, 'worker-4'],
    ] as const) {
      const p = claimed!.payloadJson as typeof p1;
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
          jobId: claimed!.id,
          jobVersion: claimed!.version,
          operationId: p.operationId,
          aiRunId: p.aiRunId,
          workerId,
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

    // 6. Partial completion check: 4 units succeeded, 5th job claim and fail with transient error
    const claimedJob5 = await jobAdapter.claimNextJob({
      workerId: 'worker-5',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob5).not.toBeNull();
    const p5 = claimedJob5!.payloadJson as typeof p1;

    const cl5 = await pool.connect();
    try {
      await cl5.query('BEGIN');
      await settleScriptUnitAtomic(cl5, {
        workspaceId: p5.workspaceId,
        productId: p5.productId,
        workOrderId: p5.workOrderId,
        workItemId: p5.workItemId,
        assignmentId: p5.assignmentId,
        jobId: claimedJob5!.id,
        jobVersion: claimedJob5!.version,
        operationId: p5.operationId,
        aiRunId: p5.aiRunId,
        workerId: 'worker-5',
        videoNumber: 5,
        changeRequestId: null,
        reservedMicrounits: p5.reservedMicrounits,
        outcome: {
          kind: 'transient_failure',
          errorCategory: 'provider_timeout',
          errorMessage: 'Timeout on provider',
          nextAttemptAt: new Date(Date.now() - 1000), // Ready to retry immediately
        },
      });
      await cl5.query('COMMIT');
    } finally {
      cl5.release();
    }

    // Check partial state: exactly 4 succeeded, 1 retry_wait
    const partialUnits = await pool.query(
      `SELECT status, count(*) FROM script_generation_units WHERE work_order_id = $1 GROUP BY status`,
      [params.workOrder.id],
    );
    const statusMap = Object.fromEntries(partialUnits.rows.map((r) => [r.status, Number(r.count)]));
    expect(statusMap.succeeded).toBe(4);
    expect(statusMap.retry_wait).toBe(1);

    // Package is NOT assembled yet because 1 unit is still failing
    const artCountBefore = await pool.query(
      `SELECT count(*) FROM content_artifacts WHERE work_order_id = $1 AND artifact_type = 'script_package'`,
      [params.workOrder.id],
    );
    expect(Number(artCountBefore.rows[0].count)).toBe(0);

    // Compliance reviewer remains waiting_dependency
    const woDetailPartial = await adapter.getWorkOrderById(wsId, params.workOrder.id);
    const crPartial = woDetailPartial!.workItems.find((w) => w.taskKey === 'compliance_review');
    expect(crPartial!.status).toBe('waiting_dependency');

    // 7. Retry unit 5 and succeed
    const claimedJob5Retry = await jobAdapter.claimNextJob({
      workerId: 'worker-5',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob5Retry).not.toBeNull();
    const s5 = createFakeSingleVideoScript(5, factId);
    const h5 = new Uint8Array(
      crypto.createHash('sha256').update(JSON.stringify(s5), 'utf8').digest(),
    );

    const cl5Retry = await pool.connect();
    try {
      await cl5Retry.query('BEGIN');
      await settleScriptUnitAtomic(cl5Retry, {
        workspaceId: p5.workspaceId,
        productId: p5.productId,
        workOrderId: p5.workOrderId,
        workItemId: p5.workItemId,
        assignmentId: p5.assignmentId,
        jobId: claimedJob5Retry!.id,
        jobVersion: claimedJob5Retry!.version,
        operationId: p5.operationId,
        aiRunId: p5.aiRunId,
        workerId: 'worker-5',
        videoNumber: 5,
        changeRequestId: null,
        reservedMicrounits: p5.reservedMicrounits,
        outcome: {
          kind: 'success',
          contentJson: s5,
          contentHash: h5,
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
          evidenceReferences: s5.video.evidenceReferences,
        },
      });
      await cl5Retry.query('COMMIT');
    } finally {
      cl5Retry.release();
    }

    // 8. Package Assembly: All 5 succeeded, exactly one script_package artifact revision 1 is created!
    const artRes = await pool.query(
      `SELECT * FROM content_artifacts WHERE work_order_id = $1 AND artifact_type = 'script_package'`,
      [params.workOrder.id],
    );
    expect(artRes.rows).toHaveLength(1);
    const artifactId = artRes.rows[0].id;
    expect(artRes.rows[0].current_revision_number).toBe(1);

    const revRes = await pool.query(
      `SELECT * FROM content_artifact_revisions WHERE artifact_id = $1`,
      [artifactId],
    );
    expect(revRes.rows).toHaveLength(1);
    expect(revRes.rows[0].revision_number).toBe(1);

    // Lineage created
    const linRes = await pool.query(
      `SELECT * FROM content_artifact_lineage WHERE artifact_id = $1`,
      [artifactId],
    );
    expect(linRes.rows).toHaveLength(1);
    expect(linRes.rows[0].lineage_type).toBe('ai_generated');

    // 9. Work items and assignments state: Scriptwriter completed, Compliance reviewer is RELEASED to ready (not executed)
    const woDetailFinal = await adapter.getWorkOrderById(wsId, params.workOrder.id);
    const swFinal = woDetailFinal!.workItems.find((w) => w.taskKey === 'scriptwriting');
    expect(swFinal!.status).toBe('completed');
    const swAsgFinal = woDetailFinal!.assignments.find((a) => a.roleKey === 'scriptwriter');
    expect(swAsgFinal!.officeState).toBe('completed');

    const crFinal = woDetailFinal!.workItems.find((w) => w.taskKey === 'compliance_review');
    expect(crFinal!.status).toBe('ready'); // Unlocked and ready!
    const crAsgFinal = woDetailFinal!.assignments.find((a) => a.roleKey === 'compliance_reviewer');
    expect(crAsgFinal!.officeState).toBe('preparing');

    // Verify zero compliance jobs are queued or running
    const compJobs = await pool.query(
      `SELECT * FROM job_executions WHERE work_order_id = $1 AND job_type = 'compliance_review'`,
      [params.workOrder.id],
    );
    expect(compJobs.rows).toHaveLength(0);

    // 10. Assembly idempotency: calling assembleScriptPackageInitialAtomic again produces no new rows or charges
    const clIdempotent = await pool.connect();
    try {
      await clIdempotent.query('BEGIN');
      const reassembled = await (
        await import('../../src/workforce/workforce-script-assembly.js')
      ).assembleScriptPackageInitialAtomic(clIdempotent, {
        workspaceId: p1.workspaceId,
        productId: p1.productId,
        workOrderId: p1.workOrderId,
        workItemId: p1.workItemId,
        assignmentId: p1.assignmentId,
      });
      expect(reassembled).toBe(true);
      await clIdempotent.query('COMMIT');
    } finally {
      clIdempotent.release();
    }

    const revRes2 = await pool.query(
      `SELECT count(*) FROM content_artifact_revisions WHERE artifact_id = $1`,
      [artifactId],
    );
    expect(Number(revRes2.rows[0].count)).toBe(1);
  }, 60000);
});
