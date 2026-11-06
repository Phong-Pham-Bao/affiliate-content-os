import pg from 'pg';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/database/index.js';
import { PostgresCatalogAdapter } from '../../src/catalog/index.js';
import {
  createAffiliateDestination,
  createFactSet,
  createProduct,
  listAffiliateDestinations,
  listFactSets,
  listProducts,
  DefaultIdGenerator,
  SystemClock,
  type WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('catalog-pagination.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let database: ReturnType<typeof createDatabase>;
  let adapter: PostgresCatalogAdapter;
  const clock = new SystemClock();
  const idGen = new DefaultIdGenerator();

  const wsId = '018f6c5b-21a4-789a-8def-000000000001';
  const ownerUser = '018f6c5b-21a4-789a-8def-000000000002';
  const editorUser = '018f6c5b-21a4-789a-8def-000000000003';

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
          role: params.userId === ownerUser ? 'owner' : 'editor',
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
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 15000,
      sslMode: 'disable',
    });
    adapter = new PostgresCatalogAdapter(database);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-owner', 'owner@example.com', 'Owner', 'active', NOW(), NOW(), 1),
              ($2, 'google', 'sub-editor', 'editor@example.com', 'Editor', 'active', NOW(), NOW(), 1)`,
      [ownerUser, editorUser],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Pagination WS', 'pagination-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
    );
  });

  afterAll(async () => {
    await database?.close();
    await pool?.end();
    await context?.cleanup();
  });

  function makeIdem() {
    return {
      keyHash: crypto.randomBytes(32),
      requestHash: crypto.randomBytes(32),
    };
  }

  it('paginates products using bounded cursor pagination', async () => {
    const createdIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const p = await createProduct(
        {
          workspaceId: wsId,
          userId: editorUser,
          name: `Product Page ${i}`,
          merchantName: 'Store',
          canonicalUrl: `https://example.com/page-item-${i}`,
          category: 'Misc',
          description: `Desc ${i}`,
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      );
      createdIds.push(p.product.id);
      // Small pause to guarantee distinct updated_at timestamps
      await new Promise((r) => setTimeout(r, 10));
    }

    // Page 1: limit 2
    const page1 = await listProducts(
      { workspaceId: wsId, userId: editorUser, limit: 2 },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.nextCursor).not.toBeNull();

    // Page 2: limit 2 with cursor
    const page2 = await listProducts(
      { workspaceId: wsId, userId: editorUser, limit: 2, cursor: page1.nextCursor! },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(page2.items.length).toBe(2);
    expect(page2.nextCursor).toBeDefined();
    expect(page2.nextCursor).not.toBeNull();

    // Page 3: limit 2 with cursor -> last 1 item, nextCursor is null
    const page3 = await listProducts(
      { workspaceId: wsId, userId: editorUser, limit: 2, cursor: page2.nextCursor! },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(page3.items.length).toBe(1);
    expect(page3.nextCursor).toBeNull();

    // Verify all 5 products retrieved across pages without duplicates
    const allIds = [
      ...page1.items.map((x) => x.id),
      ...page2.items.map((x) => x.id),
      ...page3.items.map((x) => x.id),
    ];
    expect(new Set(allIds).size).toBe(5);
  });

  it('paginates fact sets ordered by revision_number DESC', async () => {
    const prod = await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Fact Pagination Prod',
        merchantName: 'Store',
        canonicalUrl: 'https://example.com/fact-pagination',
        category: 'Misc',
        description: 'Desc',
        idempotency: makeIdem(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    for (let i = 1; i <= 3; i++) {
      await createFactSet(
        {
          workspaceId: wsId,
          userId: editorUser,
          productId: prod.product.id,
          facts: [
            {
              factKey: `key.${i}`,
              valueText: `val ${i}`,
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
    }

    // Page 1: limit 2
    const fsPage1 = await listFactSets(
      { workspaceId: wsId, userId: editorUser, productId: prod.product.id, limit: 2 },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(fsPage1.items.length).toBe(2);
    expect(fsPage1.items[0]?.revisionNumber).toBe(3);
    expect(fsPage1.items[1]?.revisionNumber).toBe(2);
    expect(fsPage1.nextCursor).not.toBeNull();

    // Page 2: with cursor
    const fsPage2 = await listFactSets(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        limit: 2,
        cursor: fsPage1.nextCursor!,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(fsPage2.items.length).toBe(1);
    expect(fsPage2.items[0]?.revisionNumber).toBe(1);
    expect(fsPage2.nextCursor).toBeNull();
  });

  it('paginates affiliate destinations with bounded cursor', async () => {
    const prod = await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Affiliate Pagination Prod',
        merchantName: 'Store',
        canonicalUrl: 'https://example.com/affiliate-pagination',
        category: 'Misc',
        description: 'Desc',
        idempotency: makeIdem(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    for (let i = 1; i <= 3; i++) {
      await createAffiliateDestination(
        {
          workspaceId: wsId,
          userId: editorUser,
          productId: prod.product.id,
          label: `Affiliate Link ${i}`,
          url: `https://partner.com/link-${i}`,
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      );
      await new Promise((r) => setTimeout(r, 10));
    }

    // Page 1: limit 2
    const affPage1 = await listAffiliateDestinations(
      { workspaceId: wsId, userId: editorUser, productId: prod.product.id, limit: 2 },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(affPage1.items.length).toBe(2);
    expect(affPage1.nextCursor).not.toBeNull();

    // Page 2: with cursor
    const affPage2 = await listAffiliateDestinations(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        limit: 2,
        cursor: affPage1.nextCursor!,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(affPage2.items.length).toBe(1);
    expect(affPage2.nextCursor).toBeNull();
  });
});
