import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('intelligence-schema-constraints.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;

  const ws1 = '018f6c5b-21a4-789a-8def-000000000001';
  const ws2 = '018f6c5b-21a4-789a-8def-000000000002';
  const user1 = '018f6c5b-21a4-789a-8def-000000000003';
  const prod1 = '018f6c5b-21a4-789a-8def-000000000004';
  const factSet1 = '018f6c5b-21a4-789a-8def-000000000005';
  const op1 = '018f6c5b-21a4-789a-8def-000000000006';
  const run1 = '018f6c5b-21a4-789a-8def-000000000007';
  const analysis1 = '018f6c5b-21a4-789a-8def-000000000008';

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });

    // Seed users and workspaces
    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-intel', 'intel@example.com', 'Intel User', 'active', NOW(), NOW(), 1)`,
      [user1],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'WS 1', 'ws-1', 'UTC', 'active', NOW(), NOW(), 1),
              ($2, 'WS 2', 'ws-2', 'UTC', 'active', NOW(), NOW(), 1)`,
      [ws1, ws2],
    );

    // Seed product and confirmed fact set in WS 1
    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Prod 1', 'Merchant', 'https://example.com/p1', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prod1, ws1, Buffer.alloc(32, 1)],
    );
    await pool.query(
      `INSERT INTO product_fact_sets (
         id, workspace_id, product_id, revision_number, status, created_by_user_id,
         confirmed_by_user_id, confirmed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 1, 'confirmed', $4, $4, NOW(), NOW(), NOW(), 1)`,
      [factSet1, ws1, prod1, user1],
    );

    // Seed operation pointing to product with composite FK in WS 1
    await pool.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'queued', $4, NOW(), NOW(), 1)`,
      [op1, ws1, prod1, user1],
    );
    await pool.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, status, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $4, 'queued', $5, NOW(), NOW(), 1)`,
      [run1, ws1, op1, Buffer.alloc(32, 2), user1],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('enforces composite foreign key on operations: resource_id must belong to same workspace', async () => {
    const badOpId = '018f6c5b-21a4-789a-8def-000000000009';
    await expect(
      pool.query(
        `INSERT INTO operations (
           id, workspace_id, operation_type, resource_type, resource_id,
           status, requested_by_user_id, created_at, updated_at, version
         ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'queued', $4, NOW(), NOW(), 1)`,
        [badOpId, ws2, prod1, user1], // prod1 is in ws1, not ws2
      ),
    ).rejects.toThrow();
  });

  it('rejects cross-tenant foreign key: analysis in WS 2 referencing product in WS 1', async () => {
    const crossAnalysisId = '018f6c5b-21a4-789a-8def-000000000010';
    await expect(
      pool.query(
        `INSERT INTO analyses (
           id, workspace_id, product_id, analysis_type, revision_number,
           fact_set_id, ai_run_id, content_json, schema_version, status,
           created_by_user_id, created_at, updated_at, version
         ) VALUES ($1, $2, $3, 'product', 1, $4, $5, '{}', 1, 'generated', $6, NOW(), NOW(), 1)`,
        [crossAnalysisId, ws2, prod1, factSet1, run1, user1],
      ),
    ).rejects.toThrow();
  });

  it('rejects cross-product foreign key: analysis referencing fact set belonging to another product', async () => {
    const prod2 = '018f6c5b-21a4-789a-8def-000000000020';
    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Prod 2', 'Merchant', 'https://example.com/p2', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prod2, ws1, Buffer.alloc(32, 3)],
    );

    const badAnalysisId = '018f6c5b-21a4-789a-8def-000000000021';
    await expect(
      pool.query(
        `INSERT INTO analyses (
           id, workspace_id, product_id, analysis_type, revision_number,
           fact_set_id, ai_run_id, content_json, schema_version, status,
           created_by_user_id, created_at, updated_at, version
         ) VALUES ($1, $2, $3, 'product', 1, $4, $5, '{}', 1, 'generated', $6, NOW(), NOW(), 1)`,
        [badAnalysisId, ws1, prod2, factSet1, run1, user1], // factSet1 belongs to prod1, not prod2
      ),
    ).rejects.toThrow();
  });

  it('enforces typed foreign keys and checks on analysis_subjects', async () => {
    // Valid subject insertion
    await pool.query(
      `INSERT INTO analyses (
         id, workspace_id, product_id, analysis_type, revision_number,
         fact_set_id, ai_run_id, content_json, schema_version, status,
         created_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product', 1, $4, $5, '{"summary":"initial"}', 1, 'generated', $6, NOW(), NOW(), 1)`,
      [analysis1, ws1, prod1, factSet1, run1, user1],
    );

    await pool.query(
      `INSERT INTO analysis_subjects (
         workspace_id, analysis_id, subject_type, role, subject_product_id, created_at
       ) VALUES ($1, $2, 'product', 'primary_subject', $3, NOW())`,
      [ws1, analysis1, prod1],
    );

    // Cross-tenant subject attempt (subject in WS 2) must be blocked
    await expect(
      pool.query(
        `INSERT INTO analysis_subjects (
           workspace_id, analysis_id, subject_type, role, subject_product_id, created_at
         ) VALUES ($1, $2, 'product', 'grounding_source', $3, NOW())`,
        [ws2, analysis1, prod1],
      ),
    ).rejects.toThrow();

    // Mismatched subject type and non-null column check
    await expect(
      pool.query(
        `INSERT INTO analysis_subjects (
           workspace_id, analysis_id, subject_type, role, subject_analysis_id, created_at
         ) VALUES ($1, $2, 'product', 'grounding_source', $3, NOW())`,
        [ws1, analysis1, analysis1], // subject_type is 'product', but column provided is subject_analysis_id
      ),
    ).rejects.toThrow();
  });

  it('enforces content immutability trigger', async () => {
    // Attempting to modify content_json must be blocked by PostgreSQL trigger
    await expect(
      pool.query(`UPDATE analyses SET content_json = '{"summary":"mutated"}' WHERE id = $1`, [
        analysis1,
      ]),
    ).rejects.toThrow(/immutable/i);

    // Attempting to delete analysis must be blocked by trigger
    await expect(pool.query(`DELETE FROM analyses WHERE id = $1`, [analysis1])).rejects.toThrow(
      /cannot be deleted/i,
    );
  });

  it('allows transition from generated to accepted, but blocks rewriting accepted analysis or superseded status', async () => {
    // Valid review transition
    await pool.query(
      `UPDATE analyses
       SET status = 'accepted', reviewed_by_user_id = $1, reviewed_at = NOW(), version = version + 1
       WHERE id = $2`,
      [user1, analysis1],
    );

    // Once accepted, attempting to change status to rejected must be blocked
    await expect(
      pool.query(`UPDATE analyses SET status = 'rejected' WHERE id = $1`, [analysis1]),
    ).rejects.toThrow(/cannot be modified/i);

    // 'superseded' is completely removed and fails check constraint
    await expect(
      pool.query(`UPDATE analyses SET status = 'superseded' WHERE id = $1`, [analysis1]),
    ).rejects.toThrow();
  });

  it('enforces terminal consistency constraints on operations', async () => {
    const testOp = '018f6c5b-21a4-789a-8def-000000000033';
    // Succeeded without result_location or completed_at must fail
    await expect(
      pool.query(
        `INSERT INTO operations (
           id, workspace_id, operation_type, resource_type, resource_id,
           status, requested_by_user_id, created_at, updated_at, version
         ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'succeeded', $4, NOW(), NOW(), 1)`,
        [testOp, ws1, prod1, user1],
      ),
    ).rejects.toThrow();
  });

  it('enforces outbox_events workspace_id NOT NULL', async () => {
    const outboxId = '018f6c5b-21a4-789a-8def-000000000044';
    await expect(
      pool.query(
        `INSERT INTO outbox_events (
           id, workspace_id, event_type, aggregate_type, aggregate_id, occurred_at, available_at, created_at
         ) VALUES ($1, NULL, 'ai.enqueued', 'analysis', $2, NOW(), NOW(), NOW())`,
        [outboxId, op1],
      ),
    ).rejects.toThrow();
  });
});
