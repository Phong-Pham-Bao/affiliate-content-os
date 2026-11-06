import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProduct,
  DefaultIdGenerator,
  SystemClock,
  updateProduct,
  type WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import {
  parseMembershipId,
  parseIsoTimestamp,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import { createDatabase } from '../../src/database/index.js';
import { PostgresCatalogAdapter } from '../../src/catalog/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('catalog-duplicate-warning-concurrency.integration (HIGH 4)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let database: ReturnType<typeof createDatabase>;
  let adapter: PostgresCatalogAdapter;
  const clock = new SystemClock();
  const idGen = new DefaultIdGenerator();

  const wsId1 = '018f6c5b-21a4-789a-8def-000000000001';
  const wsId2 = '018f6c5b-21a4-789a-8def-000000000002';
  const ownerUser = '018f6c5b-21a4-789a-8def-000000000003';
  const editorUser = '018f6c5b-21a4-789a-8def-000000000004';

  const mockAuth: WorkspaceAuthorizationPort = {
    async findMembership(params: {
      readonly workspaceId: WorkspaceId;
      readonly userId: UserId;
    }): Promise<WorkspaceMembershipSnapshot | null> {
      if (params.workspaceId === wsId1 || params.workspaceId === wsId2) {
        return {
          id: parseMembershipId('018f6c5b-21a4-789a-8def-000000000010'),
          workspaceId: params.workspaceId,
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
      poolMax: 10,
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
       VALUES ($1, 'Workspace 1', 'ws-1', 'UTC', 'active', NOW(), NOW(), 1),
              ($2, 'Workspace 2', 'ws-2', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId1, wsId2],
    );
  });

  afterAll(async () => {
    await database?.close();
    await pool?.end();
    await context?.cleanup();
  });

  function makeIdempotencyInput(key = `idem-${Date.now()}-${Math.random()}`) {
    return {
      keyHash: crypto.createHash('sha256').update(key).digest(),
      requestHash: crypto.randomBytes(32),
    };
  }

  it('serializes concurrent creations with same canonical URL: exactly one duplicateWarning is false, the other is true, and both replay identically', async () => {
    const canonicalUrl = 'https://store.example/concurrent-duplicate-product';
    const idemA = makeIdempotencyInput('concurrent-key-A');
    const idemB = makeIdempotencyInput('concurrent-key-B');

    // Launch both creations concurrently
    const [resA, resB] = await Promise.all([
      createProduct(
        {
          workspaceId: wsId1,
          userId: editorUser,
          name: 'Concurrent Product A',
          merchantName: 'Store A',
          canonicalUrl,
          category: 'Electronics',
          description: 'Description A',
          idempotency: idemA,
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      ),
      createProduct(
        {
          workspaceId: wsId1,
          userId: editorUser,
          name: 'Concurrent Product B',
          merchantName: 'Store B',
          canonicalUrl,
          category: 'Electronics',
          description: 'Description B',
          idempotency: idemB,
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      ),
    ]);

    expect(resA.cached).toBe(false);
    expect(resB.cached).toBe(false);

    // Exactly one must be false (the serialized first) and the other true (the serialized second)
    const warnings = [resA.duplicateWarning, resB.duplicateWarning];
    expect(warnings).toContain(false);
    expect(warnings).toContain(true);

    const firstRes = resA.duplicateWarning === false ? resA : resB;
    const firstIdem = resA.duplicateWarning === false ? idemA : idemB;
    const secondRes = resA.duplicateWarning === true ? resA : resB;
    const secondIdem = resA.duplicateWarning === true ? idemA : idemB;

    // Verify stored response_json in idempotency_keys matches persisted duplicateWarning
    const firstIdemRow = await pool.query<{ response_json: { duplicateWarning: boolean } }>(
      'SELECT response_json FROM idempotency_keys WHERE workspace_id = $1 AND key_hash = $2',
      [wsId1, Buffer.from(firstIdem.keyHash)],
    );
    expect(firstIdemRow.rows[0]?.response_json?.duplicateWarning).toBe(false);

    const secondIdemRow = await pool.query<{ response_json: { duplicateWarning: boolean } }>(
      'SELECT response_json FROM idempotency_keys WHERE workspace_id = $1 AND key_hash = $2',
      [wsId1, Buffer.from(secondIdem.keyHash)],
    );
    expect(secondIdemRow.rows[0]?.response_json?.duplicateWarning).toBe(true);

    // Replay first creation using same idempotency key -> duplicateWarning MUST remain false
    const replayFirst = await createProduct(
      {
        workspaceId: wsId1,
        userId: editorUser,
        name: firstRes.product.name,
        merchantName: firstRes.product.merchantName,
        canonicalUrl,
        category: firstRes.product.category,
        description: firstRes.product.description,
        idempotency: firstIdem,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(replayFirst.cached).toBe(true);
    expect(replayFirst.duplicateWarning).toBe(false);
    expect(replayFirst.product.id).toBe(firstRes.product.id);

    // Replay second creation using same idempotency key -> duplicateWarning MUST remain true
    const replaySecond = await createProduct(
      {
        workspaceId: wsId1,
        userId: editorUser,
        name: secondRes.product.name,
        merchantName: secondRes.product.merchantName,
        canonicalUrl,
        category: secondRes.product.category,
        description: secondRes.product.description,
        idempotency: secondIdem,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(replaySecond.cached).toBe(true);
    expect(replaySecond.duplicateWarning).toBe(true);
    expect(replaySecond.product.id).toBe(secondRes.product.id);
  });

  it('preserves multi-tenant isolation: identical canonical URL in different workspace yields duplicateWarning: false', async () => {
    const canonicalUrl = 'https://store.example/concurrent-duplicate-product';
    const idemOtherWs = makeIdempotencyInput('other-ws-key');

    const resOtherWs = await createProduct(
      {
        workspaceId: wsId2,
        userId: editorUser,
        name: 'Product in Workspace 2',
        merchantName: 'Store',
        canonicalUrl,
        category: 'Electronics',
        description: 'Description WS2',
        idempotency: idemOtherWs,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // Workspace 2 has no other products with this URL, so duplicateWarning MUST be false
    expect(resOtherWs.duplicateWarning).toBe(false);
    expect(resOtherWs.cached).toBe(false);
  });

  it('update product serializes by URL and reports duplicateWarning: true when updating to an existing URL', async () => {
    // 1. Create unique product X
    const uniqueUrl = 'https://store.example/unique-product-x';
    const createX = await createProduct(
      {
        workspaceId: wsId1,
        userId: editorUser,
        name: 'Product X',
        merchantName: 'Store',
        canonicalUrl: uniqueUrl,
        category: 'Electronics',
        description: 'Description X',
        idempotency: makeIdempotencyInput('create-x'),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(createX.duplicateWarning).toBe(false);

    // 2. Update Product X to the duplicate URL used earlier
    const duplicateUrl = 'https://store.example/concurrent-duplicate-product';
    const updateResult = await updateProduct(
      {
        workspaceId: wsId1,
        userId: editorUser,
        productId: createX.product.id,
        expectedVersion: createX.product.version,
        name: 'Product X Updated',
        merchantName: 'Store',
        canonicalUrl: duplicateUrl,
        category: 'Electronics',
        description: 'Description X Updated',
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    expect(updateResult.duplicateWarning).toBe(true);
    expect(updateResult.product.version).toBe(createX.product.version + 1);
  });
});
