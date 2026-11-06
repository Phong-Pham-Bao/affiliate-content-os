import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('catalog-schema-constraints.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;

  const ws1 = '018f6c5b-21a4-789a-8def-111111111111';
  const ws2 = '018f6c5b-21a4-789a-8def-222222222222';
  const user1 = '018f6c5b-21a4-789a-8def-333333333333';
  const prod1 = '018f6c5b-21a4-789a-8def-444444444444';
  const prod2 = '018f6c5b-21a4-789a-8def-555555555555';
  const factSet1 = '018f6c5b-21a4-789a-8def-666666666666';
  const fact1 = '018f6c5b-21a4-789a-8def-777777777777';
  const affiliate1 = '018f6c5b-21a4-789a-8def-888888888888';

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });

    // Seed test user and workspaces
    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-test-1', 'user@example.com', 'Test User', 'active', NOW(), NOW(), 1)`,
      [user1],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Workspace One', 'ws-one', 'UTC', 'active', NOW(), NOW(), 1),
              ($2, 'Workspace Two', 'ws-two', 'UTC', 'active', NOW(), NOW(), 1)`,
      [ws1, ws2],
    );

    // Seed product in ws1 and product in ws2
    const dummyHash = Buffer.alloc(32, 1);
    await pool.query(
      `INSERT INTO products (id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash, category, description, status, created_at, updated_at, version)
       VALUES ($1, $2, 'Prod WS1', 'Merchant 1', 'https://example.com/p1', $3, 'Tech', 'Desc 1', 'draft', NOW(), NOW(), 1),
              ($4, $5, 'Prod WS2', 'Merchant 2', 'https://example.com/p2', $3, 'Tech', 'Desc 2', 'draft', NOW(), NOW(), 1)`,
      [prod1, ws1, dummyHash, prod2, ws2],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await context?.cleanup();
  });

  describe('Composite Tenant-Safe Foreign Keys', () => {
    it('rejects product_fact_sets with mismatched workspace_id and product_id', async () => {
      // prod1 belongs to ws1, but we attempt to insert fact set referencing ws2
      await expect(
        pool.query(
          `INSERT INTO product_fact_sets (id, workspace_id, product_id, revision_number, status, created_by_user_id, created_at, updated_at, version)
           VALUES ($1, $2, $3, 1, 'proposed', $4, NOW(), NOW(), 1)`,
          ['018f6c5b-21a4-789a-8def-999999999991', ws2, prod1, user1],
        ),
      ).rejects.toThrow(/product_fact_sets_workspace_product_fk/);
    });

    it('rejects product_facts with mismatched workspace, product, or fact_set', async () => {
      // First insert valid proposed fact set in ws1
      await pool.query(
        `INSERT INTO product_fact_sets (id, workspace_id, product_id, revision_number, status, created_by_user_id, created_at, updated_at, version)
         VALUES ($1, $2, $3, 1, 'proposed', $4, NOW(), NOW(), 1)`,
        [factSet1, ws1, prod1, user1],
      );

      // Attempt to insert fact referencing ws2 but factSet1 (which belongs to ws1)
      await expect(
        pool.query(
          `INSERT INTO product_facts (id, workspace_id, product_id, fact_set_id, fact_key, value_text, source_type, confidence, claim_usage, created_at)
           VALUES ($1, $2, $3, $4, 'key.one', 'Val', 'user', 'confirmed', 'allowed', NOW())`,
          [fact1, ws2, prod1, factSet1],
        ),
      ).rejects.toThrow(/product_facts_workspace_product_fact_set_fk/);
    });

    it('rejects affiliate_destinations with mismatched workspace and product', async () => {
      // prod1 belongs to ws1, attempt to link affiliate destination to ws2
      await expect(
        pool.query(
          `INSERT INTO affiliate_destinations (id, workspace_id, product_id, label, url, status, created_at, updated_at, version)
           VALUES ($1, $2, $3, 'Link', 'https://network.com/click', 'active', NOW(), NOW(), 1)`,
          [affiliate1, ws2, prod1],
        ),
      ).rejects.toThrow(/affiliate_destinations_workspace_product_fk/);
    });

    it('rejects setting products.current_fact_set_id to an unconfirmed or mismatched fact set', async () => {
      // factSet1 is currently 'proposed', so setting current_fact_set_id to it must fail via check_product_current_fact_set trigger!
      await expect(
        pool.query(`UPDATE products SET current_fact_set_id = $1 WHERE id = $2`, [factSet1, prod1]),
      ).rejects.toThrow(/current_fact_set_id must reference a confirmed fact set/);
    });
  });

  describe('PostgreSQL-Enforced Confirmed Fact Immutability', () => {
    it('prevents mutation or deletion of confirmed fact sets and their facts', async () => {
      // Insert a fact into the proposed factSet1
      await pool.query(
        `INSERT INTO product_facts (id, workspace_id, product_id, fact_set_id, fact_key, value_text, source_type, confidence, claim_usage, created_at)
         VALUES ($1, $2, $3, $4, 'battery.life', '10 hours', 'merchant_page', 'confirmed', 'allowed', NOW())`,
        [fact1, ws1, prod1, factSet1],
      );

      // Confirm factSet1
      await pool.query(
        `UPDATE product_fact_sets
         SET status = 'confirmed', confirmed_by_user_id = $1, confirmed_at = NOW()
         WHERE id = $2`,
        [user1, factSet1],
      );

      // 1. UPDATE on confirmed fact set must be rejected
      await expect(
        pool.query(`UPDATE product_fact_sets SET summary = 'Modified summary' WHERE id = $1`, [
          factSet1,
        ]),
      ).rejects.toThrow(/confirmed product fact sets are immutable/);

      // 2. DELETE on confirmed fact set must be rejected
      await expect(
        pool.query(`DELETE FROM product_fact_sets WHERE id = $1`, [factSet1]),
      ).rejects.toThrow(/confirmed product fact sets cannot be deleted/);

      // 3. INSERT of a new fact into confirmed fact set must be rejected
      await expect(
        pool.query(
          `INSERT INTO product_facts (id, workspace_id, product_id, fact_set_id, fact_key, value_text, source_type, confidence, claim_usage, created_at)
           VALUES ($1, $2, $3, $4, 'new.key', 'New Val', 'user', 'suggested', 'context_only', NOW())`,
          ['018f6c5b-21a4-789a-8def-999999999999', ws1, prod1, factSet1],
        ),
      ).rejects.toThrow(/facts in a confirmed fact set cannot be inserted, updated, or deleted/);

      // 4. UPDATE of existing fact in confirmed fact set must be rejected
      await expect(
        pool.query(`UPDATE product_facts SET value_text = 'Changed' WHERE id = $1`, [fact1]),
      ).rejects.toThrow(/facts in a confirmed fact set cannot be inserted, updated, or deleted/);

      // 5. DELETE of existing fact in confirmed fact set must be rejected
      await expect(pool.query(`DELETE FROM product_facts WHERE id = $1`, [fact1])).rejects.toThrow(
        /facts in a confirmed fact set cannot be inserted, updated, or deleted/,
      );
    });
  });

  describe('Uniqueness and Invariant Constraints', () => {
    it('enforces unique revision_number per product', async () => {
      // Revision 1 already exists on prod1
      await expect(
        pool.query(
          `INSERT INTO product_fact_sets (id, workspace_id, product_id, revision_number, status, created_by_user_id, created_at, updated_at, version)
           VALUES ($1, $2, $3, 1, 'proposed', $4, NOW(), NOW(), 1)`,
          ['018f6c5b-21a4-789a-8def-121212121212', ws1, prod1, user1],
        ),
      ).rejects.toThrow(/product_fact_sets_product_revision_unique/);
    });

    it('enforces unique fact_key per fact_set', async () => {
      // Create a new proposed revision 2 on prod1
      const fsRev2 = '018f6c5b-21a4-789a-8def-232323232323';
      await pool.query(
        `INSERT INTO product_fact_sets (id, workspace_id, product_id, revision_number, status, created_by_user_id, created_at, updated_at, version)
         VALUES ($1, $2, $3, 2, 'proposed', $4, NOW(), NOW(), 1)`,
        [fsRev2, ws1, prod1, user1],
      );

      await pool.query(
        `INSERT INTO product_facts (id, workspace_id, product_id, fact_set_id, fact_key, value_text, source_type, confidence, claim_usage, created_at)
         VALUES ($1, $2, $3, $4, 'weight.grams', '250', 'user', 'confirmed', 'allowed', NOW())`,
        ['018f6c5b-21a4-789a-8def-343434343434', ws1, prod1, fsRev2],
      );

      // Inserting same fact_key into same fact_set must violate unique constraint
      await expect(
        pool.query(
          `INSERT INTO product_facts (id, workspace_id, product_id, fact_set_id, fact_key, value_text, source_type, confidence, claim_usage, created_at)
           VALUES ($1, $2, $3, $4, 'weight.grams', '300', 'user', 'suggested', 'allowed', NOW())`,
          ['018f6c5b-21a4-789a-8def-454545454545', ws1, prod1, fsRev2],
        ),
      ).rejects.toThrow(/product_facts_fact_set_key_unique/);
    });
  });
});
