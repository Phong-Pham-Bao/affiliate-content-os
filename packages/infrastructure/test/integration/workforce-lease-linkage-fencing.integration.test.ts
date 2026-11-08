import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobLeaseExpiredError } from '@affiliate-content-os/application';
import { DatabaseError } from '../../src/database/errors.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { PostgresJobAdapter } from '../../src/jobs/postgres-job-adapter.js';
import { settleWorkforcePlanningJobAtomic } from '../../src/workforce/workforce-planning-settlement.js';

describe('workforce-lease-linkage-fencing.integration (Item b)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId } = FIXTURE_IDS;

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

  it('rejects expired lease, stale version, and worker mismatch with JobLeaseExpiredError', async () => {
    const kickoff = await adapter.kickoffWorkOrderAtomic(createTestKickoffParams());
    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'worker-fencing-test',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();
    const payload = claimedJob!.payloadJson as {
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
      payload.workItemId,
    ]);
    const assignmentId = asRes.rows[0].id as string;

    const dummySuccessOutcome = {
      kind: 'success' as const,
      contentJson: { summary: 'fencing test' },
      contentHash: new Uint8Array(crypto.createHash('sha256').update('test').digest()),
      schemaVersion: 1,
      promptTemplate: 'product_strategy_v1',
      promptVersion: '1.0.0',
      provider: 'google',
      model: 'gemini-3.8-flash',
      usage: {
        tokenInput: 100,
        tokenOutput: 50,
        costMicrounits: 30000,
        costCurrency: 'USD',
        latencyMs: 200,
      },
      evidenceReferences: [
        { sourceKind: 'product_fact' as const, sourceId: FIXTURE_IDS.factSetId },
      ],
    };

    const baseSettleParams = {
      workspaceId: payload.workspaceId,
      productId: payload.productId,
      workOrderId: payload.workOrderId,
      workItemId: payload.workItemId,
      assignmentId,
      authorRoleKey: payload.roleKey,
      artifactType: 'product_campaign_plan' as const,
      jobId: claimedJob!.id,
      jobVersion: claimedJob!.version,
      operationId: payload.operationId,
      aiRunId: payload.aiRunId,
      workerId: 'worker-fencing-test',
      reservedMicrounits: payload.reservedMicrounits,
      outcome: dummySuccessOutcome,
    };

    // Stale version check
    const client1 = await pool.connect();
    try {
      await client1.query('BEGIN');
      await expect(
        settleWorkforcePlanningJobAtomic(client1, { ...baseSettleParams, jobVersion: 9999 }),
      ).rejects.toThrow(JobLeaseExpiredError);
    } finally {
      await client1.query('ROLLBACK');
      client1.release();
    }

    // Mismatched worker ID
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      await expect(
        settleWorkforcePlanningJobAtomic(client2, {
          ...baseSettleParams,
          workerId: 'wrong-worker-id',
        }),
      ).rejects.toThrow(JobLeaseExpiredError);
    } finally {
      await client2.query('ROLLBACK');
      client2.release();
    }

    // Expired lease check (DB time >= lease_expires_at)
    await pool.query(
      `UPDATE job_executions SET lease_expires_at = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
      [claimedJob!.id],
    );

    const client3 = await pool.connect();
    try {
      await client3.query('BEGIN');
      await expect(settleWorkforcePlanningJobAtomic(client3, baseSettleParams)).rejects.toThrow(
        JobLeaseExpiredError,
      );
    } finally {
      await client3.query('ROLLBACK');
      client3.release();
    }

    // Verify zero artifacts created and spend untouched
    const artCount = await pool.query(
      `SELECT count(*) FROM content_artifacts WHERE work_order_id = $1`,
      [kickoff.workOrder.id],
    );
    expect(Number(artCount.rows[0].count)).toBe(0);

    const polCheck = await pool.query(
      `SELECT current_spend_microunits, reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(polCheck.rows[0].current_spend_microunits)).toBe(0);
    expect(Number(polCheck.rows[0].reserved_spend_microunits)).toBe(150000);
  });

  it('rejects mismatched structural linkage and excessive actual cost', async () => {
    await adapter.kickoffWorkOrderAtomic(createTestKickoffParams());
    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'worker-linkage-test',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();
    const payload = claimedJob!.payloadJson as {
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
      payload.workItemId,
    ]);
    const assignmentId = asRes.rows[0].id as string;

    const baseSettlement = {
      workspaceId: payload.workspaceId,
      productId: payload.productId,
      workOrderId: payload.workOrderId,
      workItemId: payload.workItemId,
      assignmentId,
      authorRoleKey: payload.roleKey,
      artifactType: 'product_campaign_plan' as const,
      jobId: claimedJob!.id,
      jobVersion: claimedJob!.version,
      operationId: payload.operationId,
      aiRunId: payload.aiRunId,
      workerId: 'worker-linkage-test',
      reservedMicrounits: payload.reservedMicrounits,
      outcome: {
        kind: 'success' as const,
        contentJson: { summary: 'test' },
        contentHash: new Uint8Array(crypto.createHash('sha256').update('test').digest()),
        schemaVersion: 1,
        promptTemplate: 'product_strategy_v1',
        promptVersion: '1.0.0',
        provider: 'google',
        model: 'gemini-3.8-flash',
        usage: {
          tokenInput: 100,
          tokenOutput: 50,
          costMicrounits: 30000,
          costCurrency: 'USD',
          latencyMs: 200,
        },
        evidenceReferences: [],
      },
    };

    // Mismatched operationId throws DatabaseError
    const c1 = await pool.connect();
    try {
      await c1.query('BEGIN');
      await expect(
        settleWorkforcePlanningJobAtomic(c1, {
          ...baseSettlement,
          operationId: '018f6c5b-21a4-789a-8def-999999999999',
        }),
      ).rejects.toThrow(DatabaseError);
    } finally {
      await c1.query('ROLLBACK');
      c1.release();
    }

    // Excessive actual cost (> reserved) throws DatabaseError
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      await expect(
        settleWorkforcePlanningJobAtomic(c2, {
          ...baseSettlement,
          outcome: {
            ...baseSettlement.outcome,
            usage: { ...baseSettlement.outcome.usage, costMicrounits: 100000 },
          },
        }),
      ).rejects.toThrow(/Invalid actual cost/);
    } finally {
      await c2.query('ROLLBACK');
      c2.release();
    }
  });
});
