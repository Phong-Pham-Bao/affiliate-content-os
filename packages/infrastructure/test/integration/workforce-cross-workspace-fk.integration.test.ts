import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';

describe('workforce-cross-workspace-fk.integration (Item c)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;

  const { wsId, ws2Id, factSetId } = FIXTURE_IDS;

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

  it('enforces composite foreign key rejection on cross-workspace artifact_evidence_refs', async () => {
    const artId = '018f6c5b-21a4-789a-8def-300000000001';
    const revId = '018f6c5b-21a4-789a-8def-300000000002';
    const kickoff = await adapter.kickoffWorkOrderAtomic(createTestKickoffParams());

    const wiRes = await pool.query(
      `SELECT id FROM work_items WHERE work_order_id = $1 AND task_key = 'product_strategy'`,
      [kickoff.workOrder.id],
    );
    const wiId = wiRes.rows[0].id;

    const asgRes = await pool.query(
      `SELECT id FROM agent_assignments WHERE work_order_id = $1 AND work_item_id = $2`,
      [kickoff.workOrder.id, wiId],
    );
    const asgId = asgRes.rows[0].id;

    // 1. Create content artifact and revision in WS1
    await pool.query(
      `INSERT INTO content_artifacts (
         id, workspace_id, product_id, work_order_id, work_item_id, assignment_id,
         author_role_key, artifact_type, lifecycle_status, current_revision_number,
         created_at, updated_at, version
       ) VALUES ($1, $2, $3, $4, $5, $6, 'product_strategist', 'product_campaign_plan', 'draft', 1, NOW(), NOW(), 1)`,
      [artId, wsId, kickoff.workOrder.productId, kickoff.workOrder.id, wiId, asgId],
    );

    await pool.query(
      `INSERT INTO content_artifact_revisions (
         id, workspace_id, artifact_id, revision_number, content_json, content_hash,
         schema_version, prompt_template, prompt_version, provider, model,
         token_input, token_output, cost_microunits, cost_currency, latency_ms,
         author_role_key, created_at
       ) VALUES (
         $1, $2, $3, 1, '{}', $4, 1, 'tmpl', '1.0', 'google', 'gemini-3.8-flash',
         10, 10, 1000, 'USD', 100, 'product_strategist', NOW()
       )`,
      [revId, wsId, artId, Buffer.alloc(32, 1)],
    );

    // 2. Cross-workspace insert: workspace_id is ws2Id (WS2) referencing WS1's artifact & rev
    await expect(
      pool.query(
        `INSERT INTO artifact_evidence_refs (
           id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
         ) VALUES ('018f6c5b-21a4-789a-8def-300000000003', $1, $2, 1, 'product_fact', $3, NOW())`,
        [ws2Id, artId, factSetId],
      ),
    ).rejects.toThrow(/artifact_evidence_refs_rev_fk/);

    // 3. Same-workspace insert succeeds cleanly
    const validInsert = await pool.query(
      `INSERT INTO artifact_evidence_refs (
         id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
       ) VALUES ('018f6c5b-21a4-789a-8def-300000000004', $1, $2, 1, 'product_fact', $3, NOW())`,
      [wsId, artId, factSetId],
    );
    expect(validInsert.rowCount).toBe(1);
  });
});
