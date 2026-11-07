import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { identifyEligibleWorkItems } from '@affiliate-content-os/application';
import { parseWorkOrderId } from '@affiliate-content-os/domain';

describe('workforce-dependency-readiness.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    await seedWorkforceBaseData(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('proves dependency readiness transitions from DB state using identifyEligibleWorkItems', async () => {
    // 1. Kick off new work order
    const params = createTestKickoffParams();
    const kickoffRes = await adapter.kickoffWorkOrderAtomic(params);
    const orderId = parseWorkOrderId(kickoffRes.workOrder.id);

    // 2. Query initial ready items
    const readyItems = await adapter.findReadyWorkItems(FIXTURE_IDS.wsId, orderId);
    expect(readyItems).toHaveLength(3);
    const readyKeys = readyItems.map((i) => i.taskKey).sort();
    expect(readyKeys).toEqual(['audience_strategy', 'creative_direction', 'product_strategy']);

    // 3. Test initial readiness with domain logic over detail
    let detail = await adapter.getWorkOrderById(FIXTURE_IDS.wsId, orderId);
    expect(detail).not.toBeNull();

    let eligible = identifyEligibleWorkItems({
      workItems: detail!.workItems,
      dependencies: detail!.dependencies,
      completedWorkItemIds: new Set(),
    });
    // Neither scriptwriting nor compliance_review has prerequisites completed yet
    expect(eligible).toHaveLength(0);

    // 4. Simulate completion of the 3 planning pod work items in real DB
    await pool.query(
      `UPDATE work_items
       SET status = 'completed', started_at = NOW(), completed_at = NOW(), updated_at = NOW()
       WHERE work_order_id = $1 AND task_key IN ('product_strategy', 'audience_strategy', 'creative_direction')`,
      [orderId],
    );

    detail = await adapter.getWorkOrderById(FIXTURE_IDS.wsId, orderId);
    const completedPodIds = detail!.workItems
      .filter((w) => w.status === 'completed')
      .map((w) => w.id);

    eligible = identifyEligibleWorkItems({
      workItems: detail!.workItems,
      dependencies: detail!.dependencies,
      completedWorkItemIds: completedPodIds,
    });
    // Now scriptwriting's prerequisites are all completed, so it is eligible
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.taskKey).toBe('scriptwriting');

    // 5. Simulate transitioning scriptwriting to completed
    await pool.query(
      `UPDATE work_items
       SET status = 'completed', started_at = NOW(), completed_at = NOW(), updated_at = NOW()
       WHERE work_order_id = $1 AND task_key = 'scriptwriting'`,
      [orderId],
    );

    detail = await adapter.getWorkOrderById(FIXTURE_IDS.wsId, orderId);
    const allCompletedIds = detail!.workItems
      .filter((w) => w.status === 'completed')
      .map((w) => w.id);

    eligible = identifyEligibleWorkItems({
      workItems: detail!.workItems,
      dependencies: detail!.dependencies,
      completedWorkItemIds: allCompletedIds,
    });
    // Now compliance_review is eligible
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.taskKey).toBe('compliance_review');
  });
});
