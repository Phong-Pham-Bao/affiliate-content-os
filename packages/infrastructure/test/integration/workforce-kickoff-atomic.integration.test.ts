import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import {
  WorkforceAnalysisNotAcceptedError,
  WorkforceFactSetNotConfirmedError,
} from '@affiliate-content-os/application';
import {
  parseAnalysisId,
  parseProductFactSetId,
  parseProductId,
} from '@affiliate-content-os/domain';

describe('workforce-kickoff-atomic.integration', () => {
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

  it('atomically creates full creative_office_v1 graph with exact row counts and safe audit', async () => {
    const params = createTestKickoffParams();
    const result = await adapter.kickoffWorkOrderAtomic(params);

    expect(result.cached).toBe(false);
    expect(result.workOrder).toBeDefined();
    expect(result.workOrder.id).toBe(params.workOrder.id);
    expect(result.workOrder.status).toBe('preparing');

    // Query detail DTO via adapter
    const detail = await adapter.getWorkOrderById(
      params.workOrder.workspaceId,
      params.workOrder.id,
    );
    expect(detail).not.toBeNull();
    expect(detail!.workItems).toHaveLength(5);
    expect(detail!.assignments).toHaveLength(6);
    expect(detail!.dependencies).toHaveLength(4);
    expect(detail!.contextPackage.analysisIds).toHaveLength(2);

    // Verify row counts in real database
    const cpRes = await pool.query(`SELECT * FROM context_packages WHERE id = $1`, [
      params.contextPackage.id,
    ]);
    expect(cpRes.rows).toHaveLength(1);

    const cpaRes = await pool.query(
      `SELECT * FROM context_package_analyses WHERE context_package_id = $1`,
      [params.contextPackage.id],
    );
    expect(cpaRes.rows).toHaveLength(2);

    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(1);

    const wiRes = await pool.query(
      `SELECT * FROM work_items WHERE work_order_id = $1 ORDER BY created_at ASC`,
      [params.workOrder.id],
    );
    expect(wiRes.rows).toHaveLength(5);
    const readyItems = wiRes.rows.filter((w) => w.status === 'ready');
    const waitingItems = wiRes.rows.filter((w) => w.status === 'waiting_dependency');
    expect(readyItems).toHaveLength(3);
    expect(waitingItems).toHaveLength(2);

    const aaRes = await pool.query(
      `SELECT aa.*, rd.role_key FROM agent_assignments aa
       JOIN agent_role_definitions rd ON aa.role_definition_id = rd.id
       WHERE aa.work_order_id = $1 ORDER BY rd.role_key ASC`,
      [params.workOrder.id],
    );
    expect(aaRes.rows).toHaveLength(6);
    for (const a of aaRes.rows) {
      expect(a.office_state).toBe('preparing');
      if (a.role_key === 'chief_of_staff') {
        expect(a.work_item_id).toBeNull();
      } else {
        expect(a.work_item_id).not.toBeNull();
      }
    }

    const depRes = await pool.query(
      `SELECT * FROM work_item_dependencies WHERE work_order_id = $1`,
      [params.workOrder.id],
    );
    expect(depRes.rows).toHaveLength(4);

    const idempRes = await pool.query(
      `SELECT * FROM idempotency_keys WHERE workspace_id = $1 AND key_hash = $2`,
      [params.workOrder.workspaceId, Buffer.from(params.idempotency.keyHash)],
    );
    expect(idempRes.rows).toHaveLength(1);

    // Verify audit event
    const auditRes = await pool.query(`SELECT * FROM audit_events WHERE id = $1`, [
      params.auditEvent.id,
    ]);
    expect(auditRes.rows).toHaveLength(1);
    const audit = auditRes.rows[0];
    expect(audit.action).toBe(params.auditEvent.action);
    expect(audit.resource_type).toBe('work_order');
    expect(audit.resource_id).toBe(params.workOrder.id);
    const payload = audit.changes_json;
    expect(payload.workOrderId).toBe(params.workOrder.id);
    expect(payload.productId).toBe(params.workOrder.productId);
    expect(payload.missionType).toBe(params.workOrder.missionType);
    expect(payload.directiveText).toBeUndefined(); // Crucial: NO directive leakage
    expect(payload.directive_text).toBeUndefined();
  });

  it('fails and rolls back atomically if fact set is not confirmed', async () => {
    const unconfirmedProdId = '018f6c5b-21a4-789a-8def-200000000001';
    const fakeFactSetId = '018f6c5b-21a4-789a-8def-200000000002';

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'No FactSet Prod', 'Merchant', 'https://example.com/nofactset', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [unconfirmedProdId, FIXTURE_IDS.wsId, Buffer.alloc(32, 20)],
    );

    const params = createTestKickoffParams({
      prodId: parseProductId(unconfirmedProdId),
      factSetId: parseProductFactSetId(fakeFactSetId),
      sourceAnalyses: [],
    });

    await expect(adapter.kickoffWorkOrderAtomic(params)).rejects.toThrow(
      WorkforceFactSetNotConfirmedError,
    );

    // Verify complete rollback: no work order created
    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(0);

    const cpRes = await pool.query(`SELECT * FROM context_packages WHERE id = $1`, [
      params.contextPackage.id,
    ]);
    expect(cpRes.rows).toHaveLength(0);
  });

  it('fails and rolls back atomically if analysis is not accepted', async () => {
    const unacceptedAnalysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-999999999999');
    const params = createTestKickoffParams({
      sourceAnalyses: [{ id: unacceptedAnalysisId, version: 1 }],
    });

    await expect(adapter.kickoffWorkOrderAtomic(params)).rejects.toThrow(
      WorkforceAnalysisNotAcceptedError,
    );

    // Verify complete rollback
    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(0);
  });
});
