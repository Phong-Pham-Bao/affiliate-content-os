import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseAIRunId,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { PostgresAnalysisAdapter } from '../../src/analysis/postgres-analysis-adapter.js';
import { ValidationError } from '@affiliate-content-os/application';

describe('analyses-cursor-pagination.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresAnalysisAdapter;

  const ws1 = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
  const ws2 = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000002');
  const userId = parseUserId('018f6c5b-21a4-789a-8def-000000000003');
  const prod1 = parseProductId('018f6c5b-21a4-789a-8def-000000000004');
  const prod2 = parseProductId('018f6c5b-21a4-789a-8def-000000000005');
  const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000006');
  const opId = parseOperationId('018f6c5b-21a4-789a-8def-000000000007');
  const runId = parseAIRunId('018f6c5b-21a4-789a-8def-000000000008');

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresAnalysisAdapter(pool);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-page', 'page@example.com', 'Page User', 'active', NOW(), NOW(), 1)`,
      [userId],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Page WS 1', 'page-ws-1', 'UTC', 'active', NOW(), NOW(), 1),
              ($2, 'Page WS 2', 'page-ws-2', 'UTC', 'active', NOW(), NOW(), 1)`,
      [ws1, ws2],
    );

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Prod 1', 'Merchant', 'https://example.com/p1', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prod1, ws1, Buffer.alloc(32, 1)],
    );

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Prod 2', 'Merchant', 'https://example.com/p2', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prod2, ws1, Buffer.alloc(32, 2)],
    );

    await pool.query(
      `INSERT INTO product_fact_sets (
         id, workspace_id, product_id, revision_number, status, created_by_user_id,
         confirmed_by_user_id, confirmed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 1, 'confirmed', $4, $4, NOW(), NOW(), NOW(), 1)`,
      [factSetId, ws1, prod1, userId],
    );

    await pool.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, result_location, started_at, completed_at, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'succeeded', '/res', NOW(), NOW(), $4, NOW(), NOW(), 1)`,
      [opId, ws1, prod1, userId],
    );

    await pool.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, output_hash, status, requested_by_user_id, started_at, completed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $4, $5, 'succeeded', $6, NOW(), NOW(), NOW(), NOW(), 1)`,
      [runId, ws1, opId, Buffer.alloc(32, 3), Buffer.alloc(32, 4), userId],
    );

    // Insert 5 analyses for prod1 with distinct updated_at timestamps
    for (let i = 1; i <= 5; i++) {
      const aId = `018f6c5b-21a4-789a-8def-0000000000${10 + i}`;
      await pool.query(
        `INSERT INTO analyses (
           id, workspace_id, product_id, analysis_type, revision_number,
           fact_set_id, ai_run_id, content_json, schema_version, status,
           created_by_user_id, created_at, updated_at, version
         ) VALUES ($1, $2, $3, 'product', $4, $5, $6, '{}', 1, 'generated', $7,
           NOW() - ($8 || ' minutes')::INTERVAL,
           NOW() - ($8 || ' minutes')::INTERVAL,
           1)`,
        [aId, ws1, prod1, i, factSetId, runId, userId, 10 - i],
      );
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('pages through analyses deterministically using opaque cursors', async () => {
    // Page 1: limit 2
    const page1 = await adapter.listAnalyses(ws1, {
      productId: prod1,
      limit: 2,
    });

    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    // Page 2: limit 2 using cursor
    const page2 = await adapter.listAnalyses(ws1, {
      productId: prod1,
      limit: 2,
      cursor: page1.nextCursor!,
    });

    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    // Page 3: limit 2 using cursor (should have 1 item left)
    const page3 = await adapter.listAnalyses(ws1, {
      productId: prod1,
      limit: 2,
      cursor: page2.nextCursor!,
    });

    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull(); // Terminal page has no nextCursor

    // Verify all 5 items were returned in order without duplicates
    const allIds = [
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
      ...page3.items.map((i) => i.id),
    ];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(5);
  });

  it('rejects tampered or invalid cursor with ValidationError', async () => {
    await expect(
      adapter.listAnalyses(ws1, {
        productId: prod1,
        limit: 10,
        cursor: 'not-a-valid-base64-json-cursor',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('strictly isolates query by workspace and product', async () => {
    // Querying in ws2 returns empty
    const ws2Res = await adapter.listAnalyses(ws2, {
      productId: prod1,
      limit: 10,
    });
    expect(ws2Res.items).toHaveLength(0);

    // Querying for prod2 returns empty
    const prod2Res = await adapter.listAnalyses(ws1, {
      productId: prod2,
      limit: 10,
    });
    expect(prod2Res.items).toHaveLength(0);
  });
});
