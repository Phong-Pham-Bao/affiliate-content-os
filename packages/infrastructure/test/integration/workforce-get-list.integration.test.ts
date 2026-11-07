import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { parseWorkOrderId } from '@affiliate-content-os/domain';

describe('workforce-get-list.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    await seedWorkforceBaseData(pool);

    // Create 3 work orders in wsId
    for (let i = 1; i <= 3; i++) {
      const params = createTestKickoffParams({
        directiveText: `Work order directive ${i}`,
      });
      const res = await adapter.kickoffWorkOrderAtomic(params);
      createdOrderIds.push(res.workOrder.id);
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('getWorkOrderById returns full detail and enforces workspace isolation', async () => {
    const targetOrderId = parseWorkOrderId(createdOrderIds[0]!);

    // Query with correct workspace
    const detail = await adapter.getWorkOrderById(FIXTURE_IDS.wsId, targetOrderId);
    expect(detail).not.toBeNull();
    expect(detail!.workOrder.id).toBe(targetOrderId);
    expect(detail!.workItems).toHaveLength(5);
    expect(detail!.assignments).toHaveLength(6);
    expect(detail!.dependencies).toHaveLength(4);
    expect(detail!.contextPackage.analysisIds).toHaveLength(2);

    // Query with different workspace (ws2Id) returns null
    const crossWsDetail = await adapter.getWorkOrderById(FIXTURE_IDS.ws2Id, targetOrderId);
    expect(crossWsDetail).toBeNull();

    // Query non-existent ID returns null
    const missingDetail = await adapter.getWorkOrderById(
      FIXTURE_IDS.wsId,
      parseWorkOrderId('018f6c5b-21a4-789a-8def-ffffffffffff'),
    );
    expect(missingDetail).toBeNull();
  });

  it('listWorkOrders supports cursor pagination, limits, and workspace isolation', async () => {
    // List first 2 items
    const page1 = await adapter.listWorkOrders(FIXTURE_IDS.wsId, { limit: 2 });
    expect(page1).toHaveLength(2);

    const lastItem = page1[1]!;
    const cursor = {
      updatedAt: lastItem.updatedAt,
      id: lastItem.id,
    };

    // List remaining items with cursor
    const page2 = await adapter.listWorkOrders(FIXTURE_IDS.wsId, {
      limit: 2,
      cursor,
    });
    expect(page2).toHaveLength(1);

    // Ensure all 3 were returned in deterministic order without duplicates
    const allIds = [...page1.map((i) => i.id), ...page2.map((i) => i.id)];
    expect(new Set(allIds).size).toBe(3);

    // Listing for empty workspace ws2Id returns 0 items
    const ws2List = await adapter.listWorkOrders(FIXTURE_IDS.ws2Id, { limit: 10 });
    expect(ws2List).toHaveLength(0);
  });
});
