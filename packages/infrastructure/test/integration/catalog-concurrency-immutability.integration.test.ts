import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('catalog-concurrency-immutability.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;

  const wsId = '018f6c5b-21a4-789a-8def-000000000001';
  const userId = '018f6c5b-21a4-789a-8def-000000000002';
  const prodId = '018f6c5b-21a4-789a-8def-000000000003';
  const factSetId = '018f6c5b-21a4-789a-8def-000000000004';
  const existingFactId = '018f6c5b-21a4-789a-8def-000000000005';
  const concurrentFactId = '018f6c5b-21a4-789a-8def-000000000006';

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });

    // Seed user, workspace, product, and proposed fact set with 1 existing fact
    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-immut', 'immut@example.com', 'Immut User', 'active', NOW(), NOW(), 1)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Immutability WS', 'immut-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
    );
    await pool.query(
      `INSERT INTO products (
        id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
        category, description, status, current_fact_set_id, created_at, updated_at, version
      ) VALUES ($1, $2, 'Lock Prod', 'Merchant', 'https://example.com/lock', $3, 'Cat', 'Desc', 'draft', null, NOW(), NOW(), 1)`,
      [prodId, wsId, Buffer.alloc(32, 1)],
    );
    await pool.query(
      `INSERT INTO product_fact_sets (
        id, workspace_id, product_id, revision_number, status, created_by_user_id, created_at, updated_at, version
      ) VALUES ($1, $2, $3, 1, 'proposed', $4, NOW(), NOW(), 1)`,
      [factSetId, wsId, prodId, userId],
    );
    await pool.query(
      `INSERT INTO product_facts (
        id, workspace_id, product_id, fact_set_id, fact_key, value_text, source_type, confidence, claim_usage, created_at
      ) VALUES ($1, $2, $3, $4, 'existing.key', 'initial value', 'user', 'confirmed', 'allowed', NOW())`,
      [existingFactId, wsId, prodId, factSetId],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('two-connection race: concurrent fact INSERT blocks on in-flight confirmation and aborts when confirmation commits', async () => {
    const client1 = await pool.connect(); // Confirmation transaction
    const client2 = await pool.connect(); // Concurrent mutation transaction

    try {
      // Step 1: Client 1 begins confirmation transaction and updates fact set status to 'confirmed'
      await client1.query('BEGIN');
      await client1.query(
        `UPDATE product_fact_sets
         SET status = 'confirmed', confirmed_by_user_id = $1, confirmed_at = NOW(), version = version + 1
         WHERE id = $2 AND status = 'proposed'`,
        [userId, factSetId],
      );

      // Step 2: Client 2 initiates fact INSERT. Because enforce_product_fact_immutability executes
      // SELECT status FROM product_fact_sets WHERE ... FOR SHARE, client 2 blocks waiting for client 1!
      let client2Finished = false;
      let client2Error: Error | null = null;

      const client2Promise = (async () => {
        try {
          await client2.query(
            `INSERT INTO product_facts (
              id, workspace_id, product_id, fact_set_id, fact_key, value_text, source_type, confidence, claim_usage, created_at
            ) VALUES ($1, $2, $3, $4, 'concurrent.key', 'late value', 'user', 'confirmed', 'allowed', NOW())`,
            [concurrentFactId, wsId, prodId, factSetId],
          );
          client2Finished = true;
        } catch (err) {
          client2Error = err instanceof Error ? err : new Error(String(err));
        }
      })();

      // Verify client 2 is currently blocked and has NOT finished while client 1 holds lock
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(client2Finished).toBe(false);
      expect(client2Error).toBeNull();

      // Step 3: Client 1 commits confirmation
      await client1.query('COMMIT');

      // Step 4: Client 2 unblocks, acquires KEY SHARE lock, sees committed status = 'confirmed', and rejects!
      await client2Promise;

      const observedError = client2Error as Error | null;
      expect(client2Finished).toBe(false);
      expect(observedError).toBeDefined();
      expect(observedError?.message).toMatch(
        /facts in a confirmed fact set cannot be inserted, updated, or deleted/,
      );

      // Verify in database that concurrent fact was NOT inserted
      const factCheck = await pool.query('SELECT id FROM product_facts WHERE id = $1', [
        concurrentFactId,
      ]);
      expect(factCheck.rowCount).toBe(0);
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('rejects fact UPDATE and DELETE on confirmed fact set', async () => {
    // Attempt to update existing fact on confirmed fact set
    await expect(
      pool.query(`UPDATE product_facts SET value_text = 'tampered' WHERE id = $1`, [
        existingFactId,
      ]),
    ).rejects.toThrow(/facts in a confirmed fact set cannot be inserted, updated, or deleted/);

    // Attempt to delete existing fact on confirmed fact set
    await expect(
      pool.query(`DELETE FROM product_facts WHERE id = $1`, [existingFactId]),
    ).rejects.toThrow(/facts in a confirmed fact set cannot be inserted, updated, or deleted/);
  });
});
