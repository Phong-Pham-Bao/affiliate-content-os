import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/database/index.js';
import { PostgresCatalogAdapter } from '../../src/catalog/index.js';
import {
  createFactSet,
  DefaultIdGenerator,
  SystemClock,
  type WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type AuditEventSnapshot,
  type ProductFactSetSnapshot,
  type ProductFactSnapshot,
  type ProductId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('catalog-fact-set-revision-concurrency.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let database: ReturnType<typeof createDatabase>;
  let adapter: PostgresCatalogAdapter;
  const clock = new SystemClock();
  const idGen = new DefaultIdGenerator();

  const wsId = '018f6c5b-21a4-789a-8def-000000000001';
  const userId = '018f6c5b-21a4-789a-8def-000000000002';
  const prodId = '018f6c5b-21a4-789a-8def-000000000003';

  const mockAuth: WorkspaceAuthorizationPort = {
    async findMembership(params: {
      readonly workspaceId: WorkspaceId;
      readonly userId: UserId;
    }): Promise<WorkspaceMembershipSnapshot | null> {
      if (params.workspaceId === wsId) {
        return {
          id: parseMembershipId('018f6c5b-21a4-789a-8def-000000000010'),
          workspaceId: wsId as WorkspaceId,
          userId: params.userId,
          role: 'owner',
          status: 'active',
          invitedByUserId: null,
          joinedAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
          createdAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
          updatedAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
          version: 1,
        };
      }
      return null;
    },
  };

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 15,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 15000,
      sslMode: 'disable',
    });
    adapter = new PostgresCatalogAdapter(database);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-rev', 'rev@example.com', 'Rev User', 'active', NOW(), NOW(), 1)`,
      [userId],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Revision WS', 'revision-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
    );

    await pool.query(
      `INSERT INTO products (
        id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
        category, description, status, current_fact_set_id, created_at, updated_at, version
      ) VALUES ($1, $2, 'Revision Product', 'Merchant', 'https://example.com/rev', $3, 'Cat', 'Desc', 'draft', null, NOW(), NOW(), 1)`,
      [prodId, wsId, Buffer.alloc(32, 1)],
    );
  });

  afterAll(async () => {
    await database?.close();
    await pool?.end();
    await context?.cleanup();
  });

  it('sequential revisions beyond 100: creates 105 revisions with exact audit matches and no gaps', async () => {
    const totalRevisions = 105;
    for (let i = 1; i <= totalRevisions; i++) {
      const result = await createFactSet(
        {
          workspaceId: wsId,
          userId,
          productId: prodId,
          summary: `Summary for rev ${i}`,
          facts: [
            {
              factKey: `key.${i}`,
              valueText: `Value ${i}`,
              sourceType: 'user',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
          ],
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      );

      expect(result.factSet.revisionNumber).toBe(i);
    }

    // Verify database has all 105 sequential revisions
    const fsRows = await pool.query<{ revision_number: number; id: string }>(
      'SELECT id, revision_number FROM product_fact_sets WHERE product_id = $1 ORDER BY revision_number ASC',
      [prodId],
    );
    expect(fsRows.rowCount).toBe(totalRevisions);
    for (let i = 0; i < totalRevisions; i++) {
      expect(fsRows.rows[i]?.revision_number).toBe(i + 1);
    }

    // Verify audit_events table contains exact revision_number for each fact set
    const auditRows = await pool.query<{
      resource_id: string;
      changes_json: { revision_number: { after: string } };
    }>(
      `SELECT resource_id, changes_json FROM audit_events
       WHERE workspace_id = $1 AND action = 'catalog.fact_set_created'
       ORDER BY (changes_json->'revision_number'->>'after')::int ASC`,
      [wsId],
    );
    expect(auditRows.rowCount).toBe(totalRevisions);
    for (let i = 0; i < totalRevisions; i++) {
      const expectedRev = String(i + 1);
      expect(auditRows.rows[i]?.changes_json.revision_number.after).toBe(expectedRev);
      expect(auditRows.rows[i]?.resource_id).toBe(fsRows.rows[i]?.id);
    }
  });

  it('concurrent creation serializes on product, allocating strictly unique revisions and matching audit records', async () => {
    const concurrency = 10;
    const promises = Array.from({ length: concurrency }, (_, idx) =>
      createFactSet(
        {
          workspaceId: wsId,
          userId,
          productId: prodId,
          summary: `Concurrent rev ${idx}`,
          facts: [
            {
              factKey: `concurrent.key.${idx}`,
              valueText: `Concurrent value ${idx}`,
              sourceType: 'user',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
          ],
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      ),
    );

    const results = await Promise.all(promises);
    expect(results.length).toBe(concurrency);

    const revisions = results.map((r) => r.factSet.revisionNumber).sort((a, b) => a - b);
    // Previously we created 105 revisions, so these 10 must be 106..115
    expect(revisions).toEqual([106, 107, 108, 109, 110, 111, 112, 113, 114, 115]);

    // Verify audit events for these 10 revisions
    for (const res of results) {
      const auditCheck = await pool.query<{ changes_json: { revision_number: { after: string } } }>(
        `SELECT changes_json FROM audit_events WHERE resource_id = $1 AND action = 'catalog.fact_set_created'`,
        [res.factSet.id],
      );
      expect(auditCheck.rowCount).toBe(1);
      expect(auditCheck.rows[0]?.changes_json.revision_number.after).toBe(
        String(res.factSet.revisionNumber),
      );
    }
  });

  it('rollback atomicity: failed creation leaves zero fact sets and zero audit events', async () => {
    const preFsCount = await pool.query(
      'SELECT count(*)::int AS cnt FROM product_fact_sets WHERE product_id = $1',
      [prodId],
    );
    const preAuditCount = await pool.query(
      'SELECT count(*)::int AS cnt FROM audit_events WHERE workspace_id = $1',
      [wsId],
    );

    // Attempt creation with a fact that violates database schema constraint (e.g. invalid fact_key for postgres constraint)
    // Note: domain validator checks regex, so let's call adapter.createFactSet directly with a fact violating DB constraint
    const invalidFact = {
      id: idGen.generateProductFactId(),
      factSetId: idGen.generateProductFactSetId(),
      productId: prodId as ProductId,
      workspaceId: wsId as WorkspaceId,
      factKey: 'INVALID FACT KEY WITH SPACES',
      valueText: 'Some value',
      sourceType: 'user' as const,
      sourceUrl: null,
      sourceExcerpt: null,
      confidence: 'confirmed' as const,
      claimUsage: 'allowed' as const,
      createdAt: parseIsoTimestamp(new Date().toISOString()),
      updatedAt: parseIsoTimestamp(new Date().toISOString()),
      version: 1,
    } as unknown as ProductFactSnapshot;

    const factSetInput: Omit<ProductFactSetSnapshot, 'revisionNumber'> = {
      id: invalidFact.factSetId,
      workspaceId: wsId as WorkspaceId,
      productId: prodId as ProductId,
      status: 'proposed' as const,
      summary: null,
      createdByUserId: userId as UserId,
      confirmedByUserId: null,
      confirmedAt: null,
      createdAt: parseIsoTimestamp(new Date().toISOString()),
      updatedAt: parseIsoTimestamp(new Date().toISOString()),
      version: 1,
    };

    const mockAudit: AuditEventSnapshot = {
      id: idGen.generateAuditEventId(),
      workspaceId: wsId as WorkspaceId,
      actorType: 'user' as const,
      actorUserId: userId as UserId,
      action: 'catalog.fact_set_created',
      resourceType: 'product_fact_set',
      resourceId: factSetInput.id,
      result: 'succeeded' as const,
      reasonCode: null,
      changes: {
        revision_number: { before: null, after: 'pending' },
      },
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
      occurredAt: parseIsoTimestamp(new Date().toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    };

    await expect(
      adapter.createFactSet({
        factSet: factSetInput,
        facts: [invalidFact],
        auditEvent: mockAudit,
      }),
    ).rejects.toThrow();

    const postFsCount = await pool.query(
      'SELECT count(*)::int AS cnt FROM product_fact_sets WHERE product_id = $1',
      [prodId],
    );
    const postAuditCount = await pool.query(
      'SELECT count(*)::int AS cnt FROM audit_events WHERE workspace_id = $1',
      [wsId],
    );

    expect(postFsCount.rows[0]?.cnt).toBe(preFsCount.rows[0]?.cnt);
    expect(postAuditCount.rows[0]?.cnt).toBe(preAuditCount.rows[0]?.cnt);
  });
});
