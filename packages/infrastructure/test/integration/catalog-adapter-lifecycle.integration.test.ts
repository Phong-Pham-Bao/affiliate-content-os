import pg from 'pg';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/database/index.js';
import { PostgresCatalogAdapter } from '../../src/catalog/index.js';
import {
  IdempotencyKeyReusedError,
  ProductNotFoundError,
  StaleVersionConflictError,
  archiveAffiliateDestination,
  archiveProduct,
  confirmFactSet,
  createAffiliateDestination,
  createFactSet,
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
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

describe('catalog-adapter-lifecycle.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let database: ReturnType<typeof createDatabase>;
  let adapter: PostgresCatalogAdapter;
  const clock = new SystemClock();
  const idGen = new DefaultIdGenerator();

  const ws1 = '018f6c5b-21a4-789a-8def-111111111111';
  const ws2 = '018f6c5b-21a4-789a-8def-222222222222';
  const ownerUser = '018f6c5b-21a4-789a-8def-333333333333';
  const editorUser = '018f6c5b-21a4-789a-8def-444444444444';

  const mockAuth: WorkspaceAuthorizationPort = {
    async findMembership(params: {
      readonly workspaceId: WorkspaceId;
      readonly userId: UserId;
    }): Promise<WorkspaceMembershipSnapshot | null> {
      if (
        params.workspaceId === ws1 &&
        (params.userId === ownerUser || params.userId === editorUser)
      ) {
        return {
          id: parseMembershipId('018f6c5b-21a4-789a-8def-000000000001'),
          workspaceId: ws1 as WorkspaceId,
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
      if (params.workspaceId === ws2 && params.userId === ownerUser) {
        return {
          id: parseMembershipId('018f6c5b-21a4-789a-8def-000000000002'),
          workspaceId: ws2 as WorkspaceId,
          userId: ownerUser as UserId,
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
       VALUES ($1, 'Workspace One', 'ws-one', 'UTC', 'active', NOW(), NOW(), 1),
              ($2, 'Workspace Two', 'ws-two', 'UTC', 'active', NOW(), NOW(), 1)`,
      [ws1, ws2],
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

  it('creates product, records audit event and idempotency key, and supports idempotent replay', async () => {
    const idem = makeIdem();
    const cmd = {
      workspaceId: ws1,
      userId: editorUser,
      name: 'Sony WH-1000XM5',
      merchantName: 'Sony',
      canonicalUrl: 'https://sony.com/wh1000xm5',
      category: 'Headphones',
      description: 'Flagship ANC headphones',
      idempotency: idem,
    };

    const res1 = await createProduct(cmd, {
      catalogPersistence: adapter,
      workspaceAuthorization: mockAuth,
      clock,
      idGenerator: idGen,
    });
    expect(res1.cached).toBe(false);
    expect(res1.duplicateWarning).toBe(false);

    // Replay with identical payload returns cached result
    const res2 = await createProduct(cmd, {
      catalogPersistence: adapter,
      workspaceAuthorization: mockAuth,
      clock,
      idGenerator: idGen,
    });
    expect(res2.cached).toBe(true);
    expect(res2.product.id).toBe(res1.product.id);

    // Replay with different request hash throws IdempotencyKeyReusedError
    await expect(
      createProduct(
        {
          ...cmd,
          name: 'Different Name',
          idempotency: { keyHash: idem.keyHash, requestHash: crypto.randomBytes(32) },
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

  it('detects duplicate canonical URL warning in same workspace without silent merge', async () => {
    const res1 = await createProduct(
      {
        workspaceId: ws1,
        userId: editorUser,
        name: 'Product Primary',
        merchantName: 'Shop',
        canonicalUrl: 'https://example.com/unique-url',
        category: 'Tech',
        description: 'First entry',
        idempotency: makeIdem(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(res1.duplicateWarning).toBe(false);

    const res2 = await createProduct(
      {
        workspaceId: ws1,
        userId: editorUser,
        name: 'Product Secondary',
        merchantName: 'Shop',
        canonicalUrl: 'https://example.com/unique-url', // same URL
        category: 'Tech',
        description: 'Second entry',
        idempotency: makeIdem(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(res2.duplicateWarning).toBe(true);
    expect(res2.product.id).not.toBe(res1.product.id);
  });

  it('enforces optimistic concurrency and archive idempotency on products', async () => {
    const prod = await createProduct(
      {
        workspaceId: ws1,
        userId: editorUser,
        name: 'Standing Desk',
        merchantName: 'Uplift',
        canonicalUrl: 'https://uplift.com/desk',
        category: 'Desks',
        description: 'Motorized desk',
        idempotency: makeIdem(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // Stale update fails with 409
    await expect(
      updateProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          expectedVersion: 99,
          name: 'New Desk Name',
        },
        {
          catalogPersistence: adapter,
          workspaceAuthorization: mockAuth,
          clock,
          idGenerator: idGen,
        },
      ),
    ).rejects.toThrow(StaleVersionConflictError);

    const updated = await updateProduct(
      {
        workspaceId: ws1,
        userId: editorUser,
        productId: prod.product.id,
        expectedVersion: 1,
        name: 'Uplift V2 Standing Desk',
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(updated.product.name).toBe('Uplift V2 Standing Desk');
    expect(updated.product.version).toBe(2);

    // Archive
    const arc1 = await archiveProduct(
      { workspaceId: ws1, userId: editorUser, productId: prod.product.id },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(arc1.alreadyArchived).toBe(false);
    expect(arc1.product.status).toBe('archived');

    const arc2 = await archiveProduct(
      { workspaceId: ws1, userId: editorUser, productId: prod.product.id },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(arc2.alreadyArchived).toBe(true);
  });

  it('manages fact sets: sequential revisions and atomic confirmation', async () => {
    const prod = await createProduct(
      {
        workspaceId: ws1,
        userId: editorUser,
        name: 'Espresso Grinder',
        merchantName: 'Niche',
        canonicalUrl: 'https://niche.com/zero',
        category: 'Coffee',
        description: 'Zero retention grinder',
        idempotency: makeIdem(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    // Create Revision 1
    const fs1 = await createFactSet(
      {
        workspaceId: ws1,
        userId: editorUser,
        productId: prod.product.id,
        facts: [
          {
            factKey: 'burr.size',
            valueText: '63mm conical',
            sourceType: 'merchant_page',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(fs1.factSet.revisionNumber).toBe(1);

    // Create Revision 2
    const fs2 = await createFactSet(
      {
        workspaceId: ws1,
        userId: editorUser,
        productId: prod.product.id,
        facts: [
          {
            factKey: 'burr.size',
            valueText: '63mm hardened steel conical',
            sourceType: 'document',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(fs2.factSet.revisionNumber).toBe(2);

    // Confirm Revision 2
    const confRes = await confirmFactSet(
      {
        workspaceId: ws1,
        userId: editorUser,
        productId: prod.product.id,
        factSetId: fs2.factSet.id,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(confRes.alreadyConfirmed).toBe(false);
    expect(confRes.factSet.status).toBe('confirmed');
    expect(confRes.product.currentFactSetId).toBe(fs2.factSet.id);

    // Verify product in database points to confirmed fact set
    const pCheck = await getProduct(
      { workspaceId: ws1, userId: editorUser, productId: prod.product.id },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(pCheck.currentFactSetId).toBe(fs2.factSet.id);
  });

  it('manages affiliate destinations and redacts query parameters in audit events', async () => {
    const prod = await createProduct(
      {
        workspaceId: ws1,
        userId: editorUser,
        name: 'Action Camera',
        merchantName: 'GoPro',
        canonicalUrl: 'https://gopro.com/hero12',
        category: 'Cameras',
        description: 'Waterproof camera',
        idempotency: makeIdem(),
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );

    const sensitiveAffiliateUrl = 'https://cj.com/click?aff_id=99999&auth_token=supersecret#frag';
    const dest = await createAffiliateDestination(
      {
        workspaceId: ws1,
        userId: editorUser,
        productId: prod.product.id,
        label: 'GoPro Affiliate',
        url: sensitiveAffiliateUrl,
        networkName: 'CJ',
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(dest.url).toBe(sensitiveAffiliateUrl);

    // Verify audit events do not contain secrets
    const auditRes = await pool.query(
      `SELECT changes_json FROM audit_events WHERE workspace_id = $1 AND resource_id = $2`,
      [ws1, dest.id],
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
    const changes = JSON.stringify(auditRes.rows[0].changes_json);
    expect(changes).not.toContain('99999');
    expect(changes).not.toContain('supersecret');
    expect(changes).not.toContain('frag');

    // Archive affiliate destination
    const arcRes = await archiveAffiliateDestination(
      {
        workspaceId: ws1,
        userId: editorUser,
        productId: prod.product.id,
        destinationId: dest.id,
      },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth, clock, idGenerator: idGen },
    );
    expect(arcRes.destination.status).toBe('archived');
  });

  it('enforces tenant isolation across all catalog queries', async () => {
    // ws1 has products, ws2 has no products yet
    const ws1List = await listProducts(
      { workspaceId: ws1, userId: ownerUser },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(ws1List.items.length).toBeGreaterThan(0);

    const ws2List = await listProducts(
      { workspaceId: ws2, userId: ownerUser },
      { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
    );
    expect(ws2List.items.length).toBe(0);

    // Attempting to read ws1 product through ws2 route throws ProductNotFoundError
    await expect(
      getProduct(
        { workspaceId: ws2, userId: ownerUser, productId: ws1List.items[0]!.id },
        { catalogPersistence: adapter, workspaceAuthorization: mockAuth },
      ),
    ).rejects.toThrow(ProductNotFoundError);
  });
});
