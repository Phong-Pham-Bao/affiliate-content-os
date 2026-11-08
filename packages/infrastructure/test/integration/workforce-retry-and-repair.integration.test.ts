import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { PostgresJobAdapter } from '../../src/jobs/postgres-job-adapter.js';
import { settleWorkforcePlanningJobAtomic } from '../../src/workforce/workforce-planning-settlement.js';

describe('workforce-retry-and-repair.integration (Items d & e)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, userId } = FIXTURE_IDS;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    jobAdapter = new PostgresJobAdapter(pool);
    await seedWorkforceBaseData(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('retry-created job has valid payload and can be claimed and settled (Item d)', async () => {
    const kickoff = await adapter.kickoffWorkOrderAtomic(createTestKickoffParams());
    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'w-fail',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();
    const pl = claimedJob!.payloadJson as {
      workspaceId: string;
      productId: string;
      workOrderId: string;
      workItemId: string;
      roleKey: string;
      taskKey: string;
      operationId: string;
      aiRunId: string;
      reservedMicrounits: number;
    };

    // Terminally fail this work item to enable retry
    const asRes0 = await pool.query(`SELECT id FROM agent_assignments WHERE work_item_id = $1`, [
      pl.workItemId,
    ]);
    const assignmentId0 = asRes0.rows[0].id as string;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await settleWorkforcePlanningJobAtomic(client, {
        workspaceId: pl.workspaceId,
        productId: pl.productId,
        workOrderId: pl.workOrderId,
        workItemId: pl.workItemId,
        assignmentId: assignmentId0,
        authorRoleKey: pl.roleKey,
        artifactType: 'product_campaign_plan',
        jobId: claimedJob!.id,
        jobVersion: claimedJob!.version,
        operationId: pl.operationId,
        aiRunId: pl.aiRunId,
        workerId: 'w-fail',
        reservedMicrounits: pl.reservedMicrounits,
        outcome: {
          kind: 'terminal_failure',
          errorCategory: 'internal_error',
          errorCode: 'SIM_FAIL',
          errorMessage: 'Simulated failure',
        },
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const retryRes = await adapter.retryWorkOrderPlanningAtomic({
      workspaceId: wsId,
      workOrderId: kickoff.workOrder.id,
      actorUserId: userId,
      totalEstimatedCostMicrounits: 50000,
      auditEvent: {
        id: '018f6c5b-21a4-789a-8def-400000000099' as never,
        workspaceId: wsId,
        actorUserId: userId,
        action: 'work_order.planning_retried',
        resourceType: 'work_order',
        resourceId: kickoff.workOrder.id,
        changesJson: { retriedBy: userId },
      },
      retryItems: [
        {
          workItemId: pl.workItemId as never,
          jobId: '018f6c5b-21a4-789a-8def-400000000000',
          outboxId: '018f6c5b-21a4-789a-8def-400000000003',
          taskKey: 'product_strategy',
          roleKey: 'product_strategist',
          operationId: '018f6c5b-21a4-789a-8def-400000000001',
          aiRunId: '018f6c5b-21a4-789a-8def-400000000002',
          promptTemplate: 'product_strategy_v1',
          reservedMicrounits: 50000,
        },
      ],
    });
    expect(retryRes.retriedItemIds).toHaveLength(1);

    // Verify retry job row in PostgreSQL: ai_run_id column is used and payload has contextPackageId
    const retryJobRow = await pool.query(
      `SELECT id, ai_run_id, payload_json, status FROM job_executions WHERE operation_id = $1`,
      ['018f6c5b-21a4-789a-8def-400000000001'],
    );
    expect(retryJobRow.rowCount).toBe(1);
    expect(retryJobRow.rows[0].ai_run_id).toBe('018f6c5b-21a4-789a-8def-400000000002');
    const retryPl = retryJobRow.rows[0].payload_json;
    expect(retryPl.contextPackageId).toBeDefined();

    // Push any remaining initial jobs into the future so the retry job is claimed next
    await pool.query(
      `UPDATE job_executions SET next_attempt_at = NOW() + INTERVAL '1 hour' WHERE id != $1 AND work_order_id = $2`,
      [retryJobRow.rows[0].id, kickoff.workOrder.id],
    );

    // Claim the retry job
    const claimedRetry = await jobAdapter.claimNextJob({
      workerId: 'w-retry',
      leaseDurationSeconds: 30,
    });
    expect(claimedRetry).not.toBeNull();
    expect(claimedRetry!.id).toBe(retryJobRow.rows[0].id);

    // Settle the retry job
    const asRes = await pool.query(`SELECT id FROM agent_assignments WHERE work_item_id = $1`, [
      retryPl.workItemId,
    ]);
    const settleClient = await pool.connect();
    try {
      await settleClient.query('BEGIN');
      await settleWorkforcePlanningJobAtomic(settleClient, {
        workspaceId: retryPl.workspaceId,
        productId: retryPl.productId,
        workOrderId: retryPl.workOrderId,
        workItemId: retryPl.workItemId,
        assignmentId: asRes.rows[0].id,
        authorRoleKey: retryPl.roleKey,
        artifactType: 'product_campaign_plan',
        jobId: claimedRetry!.id,
        jobVersion: claimedRetry!.version,
        operationId: retryPl.operationId,
        aiRunId: retryPl.aiRunId,
        workerId: 'w-retry',
        reservedMicrounits: retryPl.reservedMicrounits,
        outcome: {
          kind: 'success',
          contentJson: { summary: 'retry success' },
          contentHash: new Uint8Array(crypto.createHash('sha256').update('retry').digest()),
          schemaVersion: 1,
          promptTemplate: 'product_strategy_v1',
          promptVersion: '1.0.0',
          provider: 'google',
          model: 'gemini-3.8-flash',
          usage: {
            tokenInput: 100,
            tokenOutput: 50,
            costMicrounits: 40000,
            costCurrency: 'USD',
            latencyMs: 200,
          },
          evidenceReferences: [{ sourceKind: 'product_fact', sourceId: FIXTURE_IDS.factSetId }],
        },
      });
      await settleClient.query('COMMIT');
    } finally {
      settleClient.release();
    }

    const itemCheck = await pool.query(`SELECT status FROM work_items WHERE id = $1`, [
      retryPl.workItemId,
    ]);
    expect(itemCheck.rows[0].status).toBe('completed');
  });

  it('first invalid structured output repairs once and second invalid output terminalizes with one reservation release (Item e)', async () => {
    await pool.query(`DELETE FROM job_executions WHERE workspace_id = $1`, [wsId]);
    await adapter.kickoffWorkOrderAtomic(createTestKickoffParams());
    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'w-rep',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();
    const pl = claimedJob!.payloadJson as {
      workspaceId: string;
      productId: string;
      workOrderId: string;
      workItemId: string;
      roleKey: string;
      operationId: string;
      aiRunId: string;
      reservedMicrounits: number;
    };

    const asRes = await pool.query(`SELECT id FROM agent_assignments WHERE work_item_id = $1`, [
      pl.workItemId,
    ]);
    const assignmentId = asRes.rows[0].id as string;

    // First invalid output: settle with repair outcome
    const c1 = await pool.connect();
    try {
      await c1.query('BEGIN');
      await settleWorkforcePlanningJobAtomic(c1, {
        workspaceId: pl.workspaceId,
        productId: pl.productId,
        workOrderId: pl.workOrderId,
        workItemId: pl.workItemId,
        assignmentId,
        authorRoleKey: pl.roleKey,
        artifactType: 'product_campaign_plan',
        jobId: claimedJob!.id,
        jobVersion: claimedJob!.version,
        operationId: pl.operationId,
        aiRunId: pl.aiRunId,
        workerId: 'w-rep',
        reservedMicrounits: pl.reservedMicrounits,
        outcome: {
          kind: 'repair',
          errorCategory: 'invalid_output',
          errorMessage: 'Invalid output evidence',
          repairDelaySeconds: 1,
        },
      });
      await c1.query('COMMIT');
    } finally {
      c1.release();
    }

    const repairCheck = await pool.query(
      `SELECT status, repair_attempt, lease_owner FROM job_executions WHERE id = $1`,
      [claimedJob!.id],
    );
    expect(repairCheck.rows[0].status).toBe('retry_wait');
    expect(repairCheck.rows[0].repair_attempt).toBe(1);
    expect(repairCheck.rows[0].lease_owner).toBeNull();

    const runCheck = await pool.query(`SELECT is_repair FROM ai_runs WHERE id = $1`, [pl.aiRunId]);
    expect(runCheck.rows[0].is_repair).toBe(true);

    const pol1 = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    const reservedDuringRepair = Number(pol1.rows[0].reserved_spend_microunits);

    // Make job claimable for repair attempt
    await pool.query(
      `UPDATE job_executions SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [claimedJob!.id],
    );

    const claimedRepair = await jobAdapter.claimNextJob({
      workerId: 'w-rep',
      leaseDurationSeconds: 30,
    });
    expect(claimedRepair).not.toBeNull();
    expect(claimedRepair!.repairAttempt).toBe(1);

    // Second invalid output: terminal failure
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      await settleWorkforcePlanningJobAtomic(c2, {
        workspaceId: pl.workspaceId,
        productId: pl.productId,
        workOrderId: pl.workOrderId,
        workItemId: pl.workItemId,
        assignmentId,
        authorRoleKey: pl.roleKey,
        artifactType: 'product_campaign_plan',
        jobId: claimedRepair!.id,
        jobVersion: claimedRepair!.version,
        operationId: pl.operationId,
        aiRunId: pl.aiRunId,
        workerId: 'w-rep',
        reservedMicrounits: pl.reservedMicrounits,
        outcome: {
          kind: 'terminal_failure',
          errorCategory: 'invalid_output',
          errorCode: 'INVALID_OUTPUT_REPAIR_EXHAUSTED',
          errorMessage: 'Repair exhausted',
        },
      });
      await c2.query('COMMIT');
    } finally {
      c2.release();
    }

    const termJob = await pool.query(`SELECT status FROM job_executions WHERE id = $1`, [
      claimedRepair!.id,
    ]);
    expect(termJob.rows[0].status).toBe('failed');

    const pol2 = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(pol2.rows[0].reserved_spend_microunits)).toBe(
      reservedDuringRepair - pl.reservedMicrounits,
    );
  });
});
