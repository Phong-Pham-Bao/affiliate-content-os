import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AIGatewayPort, AIAnalysisGatewayResult } from '@affiliate-content-os/application';
import type { ProductCampaignPlan } from '@affiliate-content-os/domain';
import { PostgresWorkforceAdapter } from '@affiliate-content-os/infrastructure/workforce';
import { PostgresJobAdapter } from '@affiliate-content-os/infrastructure/jobs';
import { processWorkforcePlanningJob } from '../../src/workforce-job-processor.js';
import {
  kickoffWorkerTestOrder,
  setupWorkforceWorkerDatabase,
  type WorkforceWorkerSeedContext,
} from './helpers/setup-workforce-worker-db.js';

describe('workforce-processor.integration (Production Worker Processor Path)', () => {
  let dbContext: WorkforceWorkerSeedContext;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  beforeAll(async () => {
    dbContext = await setupWorkforceWorkerDatabase();
    adapter = new PostgresWorkforceAdapter(dbContext.pool);
    jobAdapter = new PostgresJobAdapter(dbContext.pool);
  });

  afterAll(async () => {
    if (dbContext?.database) await dbContext.database.close();
    await dbContext?.context?.cleanup();
  });

  function createMockGateway(options?: { readonly invalidateEvidence?: boolean }): AIGatewayPort {
    const effectiveFactId = options?.invalidateEvidence
      ? '018f6c5b-21a4-789a-8def-999999999999'
      : dbContext.factId;

    return {
      executeProductAnalysis: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeNicheAnalysis: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeAudienceInsightBoard: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeVideoSeriesPlan: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeScriptVideo: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeProductCampaignPlan: async (): Promise<
        AIAnalysisGatewayResult<ProductCampaignPlan>
      > => ({
        success: true,
        content: {
          schemaVersion: 1,
          summary: 'Valid campaign plan',
          positioningStatement: 'Positioning',
          campaignGoals: ['Goal 1'],
          coreBenefits: [{ benefit: 'Lumbar support', evidenceRefs: [effectiveFactId] }],
          targetObjections: [
            { objection: 'Price', counterAngle: 'Warranty', evidenceRefs: [dbContext.analysisId] },
          ],
          complianceConstraints: ['Clear terms'],
          creativeHypotheses: [{ hypothesis: 'Target remote workers', rationale: 'Validated' }],
          evidenceReferences: [
            { sourceKind: 'product_fact', sourceId: effectiveFactId },
            { sourceKind: 'analysis', sourceId: dbContext.analysisId },
          ],
        },
        usage: {
          tokenInput: 500,
          tokenOutput: 300,
          costMicrounits: 45000,
          costCurrency: 'USD',
          latencyMs: 300,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_strategy_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      }),
    };
  }

  it('executes retry-created job through production workforce processor path (Item d)', async () => {
    const woId = await kickoffWorkerTestOrder(dbContext);

    await dbContext.pool.query(
      `UPDATE work_items SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW() WHERE work_order_id = $1`,
      [woId],
    );
    await dbContext.pool.query(
      `UPDATE job_executions SET next_attempt_at = NOW() + INTERVAL '1 hour' WHERE work_order_id = $1`,
      [woId],
    );
    await dbContext.pool.query(
      `UPDATE work_orders SET status = 'failed', completed_at = NOW(), failure_category = 'planning_failed' WHERE id = $1`,
      [woId],
    );

    const wiRes0 = await dbContext.pool.query(
      `SELECT id FROM work_items WHERE work_order_id = $1 AND task_key = 'product_strategy'`,
      [woId],
    );
    const failedWiId = wiRes0.rows[0].id;

    const retryRes = await adapter.retryWorkOrderPlanningAtomic({
      workspaceId: dbContext.wsId as never,
      workOrderId: woId as never,
      actorUserId: dbContext.userId as never,
      totalEstimatedCostMicrounits: 50000,
      auditEvent: {
        id: '018f6c5b-21a4-789a-8def-700000000099' as never,
        workspaceId: dbContext.wsId as never,
        actorUserId: dbContext.userId as never,
        action: 'work_order.planning_retried',
        resourceType: 'work_order',
        resourceId: woId as never,
        changesJson: { retriedBy: dbContext.userId },
      },
      retryItems: [
        {
          workItemId: failedWiId as never,
          jobId: '018f6c5b-21a4-789a-8def-700000000000',
          outboxId: '018f6c5b-21a4-789a-8def-700000000003',
          taskKey: 'product_strategy',
          roleKey: 'product_strategist',
          operationId: '018f6c5b-21a4-789a-8def-700000000001',
          aiRunId: '018f6c5b-21a4-789a-8def-700000000002',
          promptTemplate: 'product_strategy_v1',
          reservedMicrounits: 50000,
        },
      ],
    });
    expect(retryRes.retriedItemIds).toHaveLength(1);

    const claimedRetry = await jobAdapter.claimNextJob({
      workerId: 'worker-proc-d',
      leaseDurationSeconds: 30,
    });
    expect(claimedRetry).not.toBeNull();

    const gateway = createMockGateway();
    await processWorkforcePlanningJob(claimedRetry!, {
      workerId: 'worker-proc-d',
      gatewayPort: gateway,
      pool: dbContext.pool,
    });

    const arts = await dbContext.pool.query(
      `SELECT id, artifact_type FROM content_artifacts WHERE work_order_id = $1`,
      [woId],
    );
    expect(arts.rowCount).toBe(1);
    expect(arts.rows[0].artifact_type).toBe('product_campaign_plan');

    const wiRes = await dbContext.pool.query(`SELECT status FROM work_items WHERE id = $1`, [
      retryRes.retriedItemIds[0],
    ]);
    expect(wiRes.rows[0].status).toBe('completed');
  });

  it('first invalid structured output goes to repair and second invalid output terminalizes (Item e)', async () => {
    await dbContext.pool.query(`DELETE FROM job_executions WHERE workspace_id = $1`, [
      dbContext.wsId,
    ]);
    const woId = await kickoffWorkerTestOrder(dbContext);

    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'worker-proc-e',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();

    const badGateway = createMockGateway({ invalidateEvidence: true });

    // 1. First execution: fails validation and schedules repair
    await processWorkforcePlanningJob(claimedJob!, {
      workerId: 'worker-proc-e',
      gatewayPort: badGateway,
      pool: dbContext.pool,
    });

    const jobAfterRepair = await dbContext.pool.query(
      `SELECT status, repair_attempt, lease_owner FROM job_executions WHERE id = $1`,
      [claimedJob!.id],
    );
    expect(jobAfterRepair.rows[0].status).toBe('retry_wait');
    expect(jobAfterRepair.rows[0].repair_attempt).toBe(1);
    expect(jobAfterRepair.rows[0].lease_owner).toBeNull();

    await dbContext.pool.query(
      `UPDATE job_executions SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [claimedJob!.id],
    );

    const claimedRepair = await jobAdapter.claimNextJob({
      workerId: 'worker-proc-e',
      leaseDurationSeconds: 30,
    });
    expect(claimedRepair).not.toBeNull();
    expect(claimedRepair!.repairAttempt).toBe(1);

    // 2. Second execution: repair attempt exhausted, terminalizes with single reservation release
    await processWorkforcePlanningJob(claimedRepair!, {
      workerId: 'worker-proc-e',
      gatewayPort: badGateway,
      pool: dbContext.pool,
    });

    const termJob = await dbContext.pool.query(`SELECT status FROM job_executions WHERE id = $1`, [
      claimedRepair!.id,
    ]);
    expect(termJob.rows[0].status).toBe('failed');

    const termWi = await dbContext.pool.query(
      `SELECT status FROM work_items WHERE work_order_id = $1`,
      [woId],
    );
    expect(termWi.rows[0].status).toBe('failed');
  });
});
