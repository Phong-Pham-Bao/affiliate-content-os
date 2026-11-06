import pg from 'pg';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/database/index.js';
import { PostgresCatalogAdapter } from '../../src/catalog/index.js';
import {
  IdempotencyKeyReusedError,
  createAffiliateDestination,
  createFactSet,
  createProduct,
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

describe('catalog-idempotency.integration', () => {
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
       VALUES ($1, 'Idempotency WS', 'idempotency-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
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

  it('reconstructs duplicateWarning accurately on product same-key replay', async () => {
    const canonicalUrl = 'https://store.example/duplicated-item';

    // 1. Create first product with URL
    await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Original Product',
        merchantName: 'Store',
        canonicalUrl,
        category: 'Cat',
        description: 'First item',
        idempotency: makeIdempotencyInput(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // 2. Create second product with identical URL -> duplicateWarning: true
    const idemDuplicate = makeIdempotencyInput();
    const createdDuplicate = await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Duplicate Product',
        merchantName: 'Store',
        canonicalUrl,
        category: 'Cat',
        description: 'Second item',
        idempotency: idemDuplicate,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    expect(createdDuplicate.duplicateWarning).toBe(true);

    // Verify stored response_json in idempotency_keys has duplicateWarning: true
    const dbIdem = await pool.query<{ response_json: { duplicateWarning: boolean } }>(
      'SELECT response_json FROM idempotency_keys WHERE workspace_id = $1 AND key_hash = $2',
      [wsId, Buffer.from(idemDuplicate.keyHash)],
    );
    expect(dbIdem.rows[0]?.response_json?.duplicateWarning).toBe(true);

    // 3. Replay creation with identical idempotency input -> MUST return duplicateWarning: true
    const replayed = await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Duplicate Product',
        merchantName: 'Store',
        canonicalUrl,
        category: 'Cat',
        description: 'Second item',
        idempotency: idemDuplicate,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    expect(replayed.duplicateWarning).toBe(true);
    expect(replayed.product.id).toBe(createdDuplicate.product.id);
  });

  it('rejects product creation when same idempotency key is reused with different request payload', async () => {
    const idemKey = `idem-conflict-${Date.now()}`;
    const keyHash = crypto.createHash('sha256').update(idemKey).digest();

    await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Original Item',
        merchantName: 'Store',
        canonicalUrl: 'https://store.example/original',
        category: 'Cat',
        description: 'Original',
        idempotency: {
          keyHash,
          requestHash: crypto.createHash('sha256').update('payload-A').digest(),
        },
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // Reusing same key with different requestHash throws IdempotencyKeyReusedError
    await expect(
      createProduct(
        {
          workspaceId: wsId,
          userId: editorUser,
          name: 'Different Item',
          merchantName: 'Store',
          canonicalUrl: 'https://store.example/different',
          category: 'Cat',
          description: 'Different',
          idempotency: {
            keyHash,
            requestHash: crypto.createHash('sha256').update('payload-B').digest(),
          },
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      ),
    ).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it('supports server idempotency for createFactSet (replay and mismatch conflict)', async () => {
    const prod = await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'FactSet Idem Prod',
        merchantName: 'Store',
        canonicalUrl: 'https://store.example/factset-idem',
        category: 'Cat',
        description: 'Desc',
        idempotency: makeIdempotencyInput(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    const factSetIdem = makeIdempotencyInput('fs-key-1');

    const fs1 = await createFactSet(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        facts: [
          {
            factKey: 'weight',
            valueText: '500g',
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
        idempotency: factSetIdem,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // Replay with identical idempotency input
    const fsReplay = await createFactSet(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        facts: [
          {
            factKey: 'weight',
            valueText: '500g',
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
        idempotency: factSetIdem,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    expect(fsReplay.factSet.id).toBe(fs1.factSet.id);
    expect(fsReplay.facts.length).toBe(1);

    // Replay with different requestHash throws IdempotencyKeyReusedError
    await expect(
      createFactSet(
        {
          workspaceId: wsId,
          userId: editorUser,
          productId: prod.product.id,
          facts: [
            {
              factKey: 'weight',
              valueText: '999g',
              sourceType: 'user',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
          ],
          idempotency: {
            keyHash: factSetIdem.keyHash,
            requestHash: crypto.randomBytes(32),
          },
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      ),
    ).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it('supports server idempotency for createAffiliateDestination (replay and mismatch conflict)', async () => {
    const prod = await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Affiliate Idem Prod',
        merchantName: 'Store',
        canonicalUrl: 'https://store.example/affiliate-idem',
        category: 'Cat',
        description: 'Desc',
        idempotency: makeIdempotencyInput(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    const affiliateIdem = makeIdempotencyInput('aff-key-1');

    const dest1 = await createAffiliateDestination(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        label: 'My Link',
        url: 'https://shareasale.com/item',
        networkName: 'ShareASale',
        idempotency: affiliateIdem,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // Replay with same idempotency key
    const destReplay = await createAffiliateDestination(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        label: 'My Link',
        url: 'https://shareasale.com/item',
        networkName: 'ShareASale',
        idempotency: affiliateIdem,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    expect(destReplay.id).toBe(dest1.id);

    // Mismatch conflict
    await expect(
      createAffiliateDestination(
        {
          workspaceId: wsId,
          userId: editorUser,
          productId: prod.product.id,
          label: 'Different Label',
          url: 'https://shareasale.com/item-different',
          idempotency: {
            keyHash: affiliateIdem.keyHash,
            requestHash: crypto.randomBytes(32),
          },
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      ),
    ).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it('concurrent createFactSet transactions on the same product cleanly increment revisions monotonically', async () => {
    const prod = await createProduct(
      {
        workspaceId: wsId,
        userId: editorUser,
        name: 'Concurrent Rev Prod',
        merchantName: 'Store',
        canonicalUrl: 'https://store.example/concurrent-rev',
        category: 'Cat',
        description: 'Desc',
        idempotency: makeIdempotencyInput(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // Launch two concurrent createFactSet calls without awaiting between them
    const p1 = createFactSet(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        facts: [
          {
            factKey: 'fact.one',
            valueText: 'one',
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    const p2 = createFactSet(
      {
        workspaceId: wsId,
        userId: editorUser,
        productId: prod.product.id,
        facts: [
          {
            factKey: 'fact.two',
            valueText: 'two',
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    const [res1, res2] = await Promise.all([p1, p2]);
    const revisions = [res1.factSet.revisionNumber, res2.factSet.revisionNumber].sort(
      (a, b) => a - b,
    );

    expect(revisions).toEqual([1, 2]);
  });
});
