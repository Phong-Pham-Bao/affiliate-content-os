import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { seedWorkforceBaseData, FIXTURE_IDS } from './helpers/workforce-fixtures.js';
import { SEEDED_ROLE_DEFINITIONS } from '@affiliate-content-os/domain';

describe('workforce-schema-constraints.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    await seedWorkforceBaseData(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('verifies migration 0008 seeded exactly 6 active roles with deterministic UUIDs', async () => {
    const res = await pool.query(
      `SELECT id, role_key, display_name, department, role_version, is_active, allowed_artifact_types_json
       FROM agent_role_definitions
       ORDER BY role_key ASC`,
    );

    expect(res.rows).toHaveLength(6);
    const roleKeys = res.rows.map((r) => r.role_key);
    expect(roleKeys).toEqual([
      'audience_strategist',
      'chief_of_staff',
      'compliance_reviewer',
      'creative_director',
      'product_strategist',
      'scriptwriter',
    ]);

    for (const expected of SEEDED_ROLE_DEFINITIONS) {
      const match = res.rows.find((r) => r.id === expected.id);
      expect(match).toBeDefined();
      expect(match.role_key).toBe(expected.roleKey);
      expect(match.is_active).toBe(true);
      expect(match.department).toBe(expected.department);
      expect(match.role_version).toBe(expected.roleVersion);
    }
  });

  it('enforces immutability triggers on context_packages', async () => {
    const cpId = '018f6c5b-21a4-789a-8def-100000000001';
    await pool.query(
      `INSERT INTO context_packages (
         id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [
        cpId,
        FIXTURE_IDS.wsId,
        FIXTURE_IDS.prodId,
        FIXTURE_IDS.factSetId,
        Buffer.alloc(32, 7),
        FIXTURE_IDS.userId,
      ],
    );

    // Attempt UPDATE
    await expect(
      pool.query(`UPDATE context_packages SET product_id = $1 WHERE id = $2`, [
        FIXTURE_IDS.prodId,
        cpId,
      ]),
    ).rejects.toThrow(/context_packages rows are immutable/);

    // Attempt DELETE
    await expect(pool.query(`DELETE FROM context_packages WHERE id = $1`, [cpId])).rejects.toThrow(
      /context_packages rows are immutable/,
    );
  });

  it('enforces immutability triggers on context_package_analyses', async () => {
    const cpId = '018f6c5b-21a4-789a-8def-100000000002';
    await pool.query(
      `INSERT INTO context_packages (
         id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [
        cpId,
        FIXTURE_IDS.wsId,
        FIXTURE_IDS.prodId,
        FIXTURE_IDS.factSetId,
        Buffer.alloc(32, 8),
        FIXTURE_IDS.userId,
      ],
    );

    await pool.query(
      `INSERT INTO context_package_analyses (
         workspace_id, context_package_id, analysis_id, created_at
       ) VALUES ($1, $2, $3, NOW())`,
      [FIXTURE_IDS.wsId, cpId, FIXTURE_IDS.analysisId1],
    );

    // Attempt UPDATE
    await expect(
      pool.query(
        `UPDATE context_package_analyses SET analysis_id = $1 WHERE context_package_id = $2`,
        [FIXTURE_IDS.analysisId2, cpId],
      ),
    ).rejects.toThrow(/context_packages rows are immutable/);

    // Attempt DELETE
    await expect(
      pool.query(`DELETE FROM context_package_analyses WHERE context_package_id = $1`, [cpId]),
    ).rejects.toThrow(/context_packages rows are immutable/);
  });

  it('enforces directive constraints on work_orders', async () => {
    const cpId = '018f6c5b-21a4-789a-8def-100000000004';
    await pool.query(
      `INSERT INTO context_packages (
         id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [
        cpId,
        FIXTURE_IDS.wsId,
        FIXTURE_IDS.prodId,
        FIXTURE_IDS.factSetId,
        Buffer.alloc(32, 9),
        FIXTURE_IDS.userId,
      ],
    );

    // Whitespace directive
    await expect(
      pool.query(
        `INSERT INTO work_orders (
           id, workspace_id, product_id, context_package_id, mission_type, directive_text,
           graph_template, graph_version, status, created_by_user_id, created_at, updated_at
         ) VALUES ('018f6c5b-21a4-789a-8def-100000000005', $1, $2, $3, 'short_video_series', '   ', 'creative_office_v1', 1, 'preparing', $4, NOW(), NOW())`,
        [FIXTURE_IDS.wsId, FIXTURE_IDS.prodId, cpId, FIXTURE_IDS.userId],
      ),
    ).rejects.toThrow(/work_orders_directive_check/);

    // Directive with control character \x01
    await expect(
      pool.query(
        `INSERT INTO work_orders (
           id, workspace_id, product_id, context_package_id, mission_type, directive_text,
           graph_template, graph_version, status, created_by_user_id, created_at, updated_at
         ) VALUES ('018f6c5b-21a4-789a-8def-100000000006', $1, $2, $3, 'short_video_series', 'hello\x01world', 'creative_office_v1', 1, 'preparing', $4, NOW(), NOW())`,
        [FIXTURE_IDS.wsId, FIXTURE_IDS.prodId, cpId, FIXTURE_IDS.userId],
      ),
    ).rejects.toThrow(/work_orders_directive_check/);
  });

  it('enforces self-dependency and work item checks', async () => {
    const cpId = '018f6c5b-21a4-789a-8def-100000000007';
    await pool.query(
      `INSERT INTO context_packages (
         id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [
        cpId,
        FIXTURE_IDS.wsId,
        FIXTURE_IDS.prodId,
        FIXTURE_IDS.factSetId,
        Buffer.alloc(32, 10),
        FIXTURE_IDS.userId,
      ],
    );

    const woId = '018f6c5b-21a4-789a-8def-100000000008';
    await pool.query(
      `INSERT INTO work_orders (
         id, workspace_id, product_id, context_package_id, mission_type, directive_text,
         graph_template, graph_version, status, created_by_user_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'short_video_series', 'Valid directive', 'creative_office_v1', 1, 'preparing', $5, NOW(), NOW())`,
      [woId, FIXTURE_IDS.wsId, FIXTURE_IDS.prodId, cpId, FIXTURE_IDS.userId],
    );

    const wiId = '018f6c5b-21a4-789a-8def-100000000009';
    await pool.query(
      `INSERT INTO work_items (
         id, workspace_id, work_order_id, role_definition_id, task_key, expected_artifact_type,
         status, created_at, updated_at
       ) VALUES ($1, $2, $3, '018f0000-0000-7000-8000-000000000002', 'product_strategy', 'product_campaign_plan', 'ready', NOW(), NOW())`,
      [wiId, FIXTURE_IDS.wsId, woId],
    );

    // Self dependency attempt
    await expect(
      pool.query(
        `INSERT INTO work_item_dependencies (id, workspace_id, work_order_id, work_item_id, depends_on_work_item_id, created_at)
         VALUES ('018f6c5b-21a4-789a-8def-100000000010', $1, $2, $3, $3, NOW())`,
        [FIXTURE_IDS.wsId, woId, wiId],
      ),
    ).rejects.toThrow(/work_item_dependencies_no_self_dep/);
  });

  it('enforces chief of staff null work item check', async () => {
    const cpId = '018f6c5b-21a4-789a-8def-100000000011';
    await pool.query(
      `INSERT INTO context_packages (
         id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [
        cpId,
        FIXTURE_IDS.wsId,
        FIXTURE_IDS.prodId,
        FIXTURE_IDS.factSetId,
        Buffer.alloc(32, 11),
        FIXTURE_IDS.userId,
      ],
    );

    const woId = '018f6c5b-21a4-789a-8def-100000000012';
    await pool.query(
      `INSERT INTO work_orders (
         id, workspace_id, product_id, context_package_id, mission_type, directive_text,
         graph_template, graph_version, status, created_by_user_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'short_video_series', 'Valid directive', 'creative_office_v1', 1, 'preparing', $5, NOW(), NOW())`,
      [woId, FIXTURE_IDS.wsId, FIXTURE_IDS.prodId, cpId, FIXTURE_IDS.userId],
    );

    const wiId = '018f6c5b-21a4-789a-8def-100000000013';
    await pool.query(
      `INSERT INTO work_items (
         id, workspace_id, work_order_id, role_definition_id, task_key, expected_artifact_type,
         status, created_at, updated_at
       ) VALUES ($1, $2, $3, '018f0000-0000-7000-8000-000000000002', 'product_strategy', 'product_campaign_plan', 'ready', NOW(), NOW())`,
      [wiId, FIXTURE_IDS.wsId, woId],
    );

    // Chief of Staff role has id 018f0000-0000-7000-8000-000000000001. Assigning with non-null work_item_id must fail.
    await expect(
      pool.query(
        `INSERT INTO agent_assignments (
           id, workspace_id, work_order_id, role_definition_id, work_item_id, office_state, created_at, updated_at
         ) VALUES ('018f6c5b-21a4-789a-8def-100000000014', $1, $2, '018f0000-0000-7000-8000-000000000001', $3, 'preparing', NOW(), NOW())`,
        [FIXTURE_IDS.wsId, woId, wiId],
      ),
    ).rejects.toThrow(/Chief of Staff assignment must not have a work item/);
  });
});
