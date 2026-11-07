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
  StaleVersionConflictError,
  WorkforceAnalysisNotAcceptedError,
  WorkforceFactSetNotConfirmedError,
} from '@affiliate-content-os/application';
import {
  parseAnalysisId,
  parseProductFactSetId,
  parseProductId,
} from '@affiliate-content-os/domain';
import type { KickoffInsertStage } from '../../src/workforce/workforce-types.js';

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

  it('fails and rolls back atomically if product version changed (TOCTOU)', async () => {
    // Snapshot took productVersion: 99, but in DB it is 1
    const params = createTestKickoffParams({
      productVersion: 99,
    });

    await expect(adapter.kickoffWorkOrderAtomic(params)).rejects.toThrow(StaleVersionConflictError);

    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(0);
    const cpRes = await pool.query(`SELECT * FROM context_packages WHERE id = $1`, [
      params.contextPackage.id,
    ]);
    expect(cpRes.rows).toHaveLength(0);
  });

  it('fails and rolls back atomically if fact set version changed (TOCTOU)', async () => {
    // Snapshot took factSetVersion: 99, but in DB it is 1
    const params = createTestKickoffParams({
      factSetVersion: 99,
    });

    await expect(adapter.kickoffWorkOrderAtomic(params)).rejects.toThrow(StaleVersionConflictError);

    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(0);
  });

  it('fails and rolls back atomically if source analysis version changed (TOCTOU)', async () => {
    // Snapshot took analysis version: 99, but in DB it is 1
    const params = createTestKickoffParams({
      sourceAnalyses: [{ id: FIXTURE_IDS.analysisId1, version: 99 }],
    });

    await expect(adapter.kickoffWorkOrderAtomic(params)).rejects.toThrow(StaleVersionConflictError);

    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(0);
  });

  it('rejects cross-workspace analysis at transaction boundary and rolls back', async () => {
    // Insert an accepted analysis in another workspace (ws2Id)
    const otherWsAnalysisId = '018f6c5b-21a4-789a-8def-777777777777';
    await pool.query(
      `INSERT INTO analyses (
         id, workspace_id, product_id, analysis_type, revision_number,
         fact_set_id, ai_run_id, content_json, schema_version, status,
         reviewed_by_user_id, reviewed_at, review_reason, created_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product', 1, $4, $5, '{}', 1, 'accepted', $6, NOW(), 'Approved', $6, NOW(), NOW(), 1)`,
      [
        otherWsAnalysisId,
        FIXTURE_IDS.ws2Id,
        FIXTURE_IDS.prodId,
        FIXTURE_IDS.factSetId,
        FIXTURE_IDS.runId,
        FIXTURE_IDS.userId,
      ],
    );

    const params = createTestKickoffParams({
      sourceAnalyses: [{ id: parseAnalysisId(otherWsAnalysisId), version: 1 }],
    });

    await expect(adapter.kickoffWorkOrderAtomic(params)).rejects.toThrow(
      WorkforceAnalysisNotAcceptedError,
    );

    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(0);
  });

  it('rejects same-workspace, wrong-product analysis at transaction boundary and rolls back', async () => {
    // Insert another product in the same workspace (wsId)
    const otherProdId = '018f6c5b-21a4-789a-8def-300000000001';
    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Other Prod', 'Merchant', 'https://example.com/otherprod', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [otherProdId, FIXTURE_IDS.wsId, Buffer.alloc(32, 30)],
    );

    // Insert an accepted analysis belonging to otherProdId in the same workspace (wsId)
    const wrongProductAnalysisId = '018f6c5b-21a4-789a-8def-300000000002';
    await pool.query(
      `INSERT INTO analyses (
         id, workspace_id, product_id, analysis_type, revision_number,
         fact_set_id, ai_run_id, content_json, schema_version, status,
         reviewed_by_user_id, reviewed_at, review_reason, created_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product', 1, $4, $5, '{}', 1, 'accepted', $6, NOW(), 'Approved', $6, NOW(), NOW(), 1)`,
      [
        wrongProductAnalysisId,
        FIXTURE_IDS.wsId,
        otherProdId,
        FIXTURE_IDS.factSetId,
        FIXTURE_IDS.runId,
        FIXTURE_IDS.userId,
      ],
    );

    // Attempt to kickoff for prodId with an analysis belonging to otherProdId
    const params = createTestKickoffParams({
      sourceAnalyses: [{ id: parseAnalysisId(wrongProductAnalysisId), version: 1 }],
    });

    await expect(adapter.kickoffWorkOrderAtomic(params)).rejects.toThrow(
      WorkforceAnalysisNotAcceptedError,
    );

    const woRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [
      params.workOrder.id,
    ]);
    expect(woRes.rows).toHaveLength(0);

    const cpRes = await pool.query(`SELECT * FROM context_packages WHERE id = $1`, [
      params.contextPackage.id,
    ]);
    expect(cpRes.rows).toHaveLength(0);
  });

  it('fault injection at each insertion stage rolls back completely leaving zero residue', async () => {
    const stages: KickoffInsertStage[] = [
      'context_packages',
      'context_package_analyses',
      'work_orders',
      'work_items',
      'work_item_dependencies',
      'agent_assignments',
      'idempotency_keys',
      'audit_events',
    ];

    for (const failStage of stages) {
      const params = createTestKickoffParams();

      await expect(
        adapter.kickoffWorkOrderAtomic(params, {
          onAfterStage: async (stage) => {
            if (stage === failStage) {
              throw new Error(`Injected failure at stage: ${failStage}`);
            }
          },
        }),
      ).rejects.toThrow(`Injected failure at stage: ${failStage}`);

      // Verify zero rows in all 8 tables for this work order and context package
      const cpCheck = await pool.query(`SELECT id FROM context_packages WHERE id = $1`, [
        params.contextPackage.id,
      ]);
      expect(cpCheck.rows).toHaveLength(0);

      const cpaCheck = await pool.query(
        `SELECT analysis_id FROM context_package_analyses WHERE context_package_id = $1`,
        [params.contextPackage.id],
      );
      expect(cpaCheck.rows).toHaveLength(0);

      const woCheck = await pool.query(`SELECT id FROM work_orders WHERE id = $1`, [
        params.workOrder.id,
      ]);
      expect(woCheck.rows).toHaveLength(0);

      const wiCheck = await pool.query(`SELECT id FROM work_items WHERE work_order_id = $1`, [
        params.workOrder.id,
      ]);
      expect(wiCheck.rows).toHaveLength(0);

      const widCheck = await pool.query(
        `SELECT id FROM work_item_dependencies WHERE work_order_id = $1`,
        [params.workOrder.id],
      );
      expect(widCheck.rows).toHaveLength(0);

      const aaCheck = await pool.query(
        `SELECT id FROM agent_assignments WHERE work_order_id = $1`,
        [params.workOrder.id],
      );
      expect(aaCheck.rows).toHaveLength(0);

      const idempCheck = await pool.query(
        `SELECT id FROM idempotency_keys WHERE workspace_id = $1 AND key_hash = $2`,
        [params.workOrder.workspaceId, Buffer.from(params.idempotency.keyHash)],
      );
      expect(idempCheck.rows).toHaveLength(0);

      const auditCheck = await pool.query(`SELECT id FROM audit_events WHERE resource_id = $1`, [
        params.workOrder.id,
      ]);
      expect(auditCheck.rows).toHaveLength(0);
    }
  });
});
