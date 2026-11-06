import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@affiliate-content-os/infrastructure/database';
import { PostgresCatalogAdapter } from '@affiliate-content-os/infrastructure/catalog';
import {
  DefaultIdGenerator,
  SystemClock,
  type WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type ProductFactSetId,
  type ProductId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import { createApp } from '../../src/app.js';
import { COOKIE_SESSION } from '../../src/auth/constants.js';
import { createMockAuthDeps } from '../helpers/auth-test-fakes.js';
import { setupIntegrationDatabase, type TestDatabaseContext } from './setup-integration-db.js';

interface ProductDbRow {
  readonly status: string;
  readonly name: string;
  readonly current_fact_set_id: string | null;
  readonly version: string;
}

describe('Catalog Routes Postgres Integration', () => {
  let context: TestDatabaseContext;
  let database: ReturnType<typeof createDatabase>;
  let adapter: PostgresCatalogAdapter;
  let app: ReturnType<typeof createApp>;

  const validSessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';

  const testWorkspaceId = '0192b012-3456-789a-8bcd-ef0123456702' as WorkspaceId;
  const ownerUserId = '0192b012-3456-789a-8bcd-ef0123456701' as UserId;

  beforeAll(async () => {
    context = await setupIntegrationDatabase();
    database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 15000,
      sslMode: 'disable',
    });
    adapter = new PostgresCatalogAdapter(database);

    await database.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-1', 'owner@example.com', 'Owner User', 'active', NOW(), NOW(), 1)`,
      [ownerUserId],
    );

    await database.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Integration Workspace', 'integ-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [testWorkspaceId],
    );

    await database.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at, version)
       VALUES ($1, $2, $3, 'owner', 'active', NOW(), NOW(), NOW(), 1)`,
      ['0192b012-3456-789a-8bcd-ef0123456711', testWorkspaceId, ownerUserId],
    );

    const auth = createMockAuthDeps();
    auth.sessionStore.findCandidateSessions = async () => [
      {
        id: '0192b012-3456-789a-8bcd-ef0123456720',
        userId: ownerUserId,
        currentTokenHash: new Uint8Array(32).fill(7),
        previousTokenHash: null,
        previousTokenValidUntil: null,
        createdAt: '2026-11-02T12:00:00.000Z',
        lastSeenAt: '2026-11-02T12:00:00.000Z',
        idleExpiresAt: '2026-11-02T12:30:00.000Z',
        absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
        rotatedAt: '2026-11-02T12:00:00.000Z',
        revokedAt: null,
        revocationReason: null,
        version: 1,
      },
    ];

    const ownerUserRecord = Object.freeze({
      id: ownerUserId,
      identityProvider: 'google',
      identitySubject: 'sub-1',
      email: 'owner@example.com',
      displayName: 'Owner User',
      status: 'active' as const,
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      version: 1,
    });
    auth.sessionStore.findUserById = async () => ownerUserRecord;
    auth.userDirectory.findUserById = async () => ownerUserRecord;

    const workspaceAuthorization: WorkspaceAuthorizationPort = {
      async findMembership(params: {
        readonly workspaceId: WorkspaceId;
        readonly userId: UserId;
      }): Promise<WorkspaceMembershipSnapshot | null> {
        if (params.workspaceId === testWorkspaceId && params.userId === ownerUserId) {
          return {
            id: parseMembershipId('0192b012-3456-789a-8bcd-ef0123456711'),
            workspaceId: testWorkspaceId,
            userId: ownerUserId,
            role: 'owner',
            status: 'active',
            invitedByUserId: null,
            joinedAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            updatedAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            version: 1,
          };
        }
        return null;
      },
    };

    app = createApp({
      auth,
      catalog: {
        auth,
        catalogPersistence: adapter,
        workspaceAuthorization,
        clock: new SystemClock(),
        idGenerator: new DefaultIdGenerator(),
      },
    });
  });

  afterAll(async () => {
    await database?.close();
    await context?.cleanup();
  });

  it('runs complete catalog lifecycle and verifies PostgreSQL persistence and audit', async () => {
    // 1. Create product
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${testWorkspaceId}/products`,
      cookies: { [COOKIE_SESSION]: validSessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456791',
      },
      payload: {
        name: 'Postgres Tested Product',
        merchantName: 'DB Merchant',
        canonicalUrl: 'https://example.com/db-product-1',
        category: 'gadgets',
        description: 'Product tested against real PostgreSQL container',
        audienceNotes: 'Developers',
        allowedClaimsNotes: 'Fast',
        prohibitedClaimsNotes: 'Magic',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdProduct = createRes.json();
    const productId = createdProduct.id as ProductId;
    expect(createdProduct.version).toBe(1);

    // Verify row in Postgres
    const pRow = await database.query<ProductDbRow>('SELECT * FROM products WHERE id = $1', [
      productId,
    ]);
    expect(pRow.rowCount).toBe(1);
    expect(pRow.rows[0]?.status).toBe('draft');
    expect(pRow.rows[0]?.name).toBe('Postgres Tested Product');

    // 1a. Replay POST with the same Idempotency-Key and a semantically equivalent normalized payload
    const replayRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${testWorkspaceId}/products`,
      cookies: { [COOKIE_SESSION]: validSessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456791',
      },
      payload: {
        name: '  Postgres Tested Product  ',
        merchantName: '  DB Merchant  ',
        canonicalUrl: '  https://EXAMPLE.COM:443/db-product-1#spec  ',
        category: '  gadgets  ',
        description: '  Product tested against real PostgreSQL container  ',
        audienceNotes: '  Developers  ',
        allowedClaimsNotes: '  Fast  ',
        prohibitedClaimsNotes: '  Magic  ',
      },
    });
    expect(replayRes.statusCode).toBe(201);
    expect(replayRes.json().id).toBe(productId);

    // 1b. Send same key with materially different normalized name, expect 409 IDEMPOTENCY_KEY_REUSED
    const conflictRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${testWorkspaceId}/products`,
      cookies: { [COOKIE_SESSION]: validSessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456791',
      },
      payload: {
        name: 'Materially Different Postgres Product',
        merchantName: 'DB Merchant',
        canonicalUrl: 'https://example.com/db-product-1',
        category: 'gadgets',
        description: 'Product tested against real PostgreSQL container',
        audienceNotes: 'Developers',
        allowedClaimsNotes: 'Fast',
        prohibitedClaimsNotes: 'Magic',
      },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().code).toBe('IDEMPOTENCY_KEY_REUSED');

    // 1c. Safe scalar queries asserting single product and single catalog.product_created audit event
    const productCountResult = await database.query<{ readonly count: string }>(
      'SELECT count(*)::text AS count FROM products WHERE id = $1 AND workspace_id = $2 AND canonical_url = $3',
      [productId, testWorkspaceId, 'https://example.com/db-product-1'],
    );
    expect(productCountResult.rows[0]?.count).toBe('1');
    expect(Number(productCountResult.rows[0]?.count)).toBe(1);

    const canonicalCountResult = await database.query<{ readonly count: string }>(
      'SELECT count(*)::text AS count FROM products WHERE workspace_id = $1 AND canonical_url = $2',
      [testWorkspaceId, 'https://example.com/db-product-1'],
    );
    expect(canonicalCountResult.rows[0]?.count).toBe('1');
    expect(Number(canonicalCountResult.rows[0]?.count)).toBe(1);

    const auditCountResult = await database.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM audit_events WHERE workspace_id = $1 AND resource_id = $2 AND action = 'catalog.product_created'`,
      [testWorkspaceId, productId],
    );
    expect(auditCountResult.rows[0]?.count).toBe('1');
    expect(Number(auditCountResult.rows[0]?.count)).toBe(1);

    // 2. Propose fact set
    const factSetRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${testWorkspaceId}/products/${productId}/fact-sets`,
      cookies: { [COOKIE_SESSION]: validSessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456792',
      },
      payload: {
        summary: 'Hardware specifications',
        facts: [
          {
            factKey: 'weight_grams',
            valueText: '250',
            sourceType: 'document',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
          {
            factKey: 'water_resistance',
            valueText: 'IP68',
            sourceType: 'merchant_page',
            confidence: 'suggested',
            claimUsage: 'context_only',
          },
        ],
      },
    });
    expect(factSetRes.statusCode).toBe(201);
    const factSetId = factSetRes.json().factSet.id as ProductFactSetId;

    // Verify facts in Postgres
    const factsRows = await database.query('SELECT * FROM product_facts WHERE fact_set_id = $1', [
      factSetId,
    ]);
    expect(factsRows.rowCount).toBe(2);

    // 3. Confirm fact set
    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${testWorkspaceId}/products/${productId}/fact-sets/${factSetId}/confirm`,
      cookies: { [COOKIE_SESSION]: validSessionCookie },
      headers: { origin: validOrigin },
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json().alreadyConfirmed).toBe(false);

    // Verify currentFactSetId linked on product in Postgres
    const updatedProductRow = await database.query<ProductDbRow>(
      'SELECT current_fact_set_id, version FROM products WHERE id = $1',
      [productId],
    );
    expect(updatedProductRow.rows[0]?.current_fact_set_id).toBe(factSetId);
    expect(Number(updatedProductRow.rows[0]?.version)).toBe(2);

    // 4. Create affiliate destination
    const affRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${testWorkspaceId}/products/${productId}/affiliate-destinations`,
      cookies: { [COOKIE_SESSION]: validSessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456793',
      },
      payload: {
        label: 'Direct Affiliate Link',
        url: 'https://affiliate.example.com/item?ref=123',
        networkName: 'Custom Network',
      },
    });
    expect(affRes.statusCode).toBe(201);
    const destId = affRes.json().id;

    // 5. Update affiliate with If-Match versioning
    const updateAffRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${testWorkspaceId}/products/${productId}/affiliate-destinations/${destId}`,
      cookies: { [COOKIE_SESSION]: validSessionCookie },
      headers: { origin: validOrigin, 'if-match': '"1"' },
      payload: {
        label: 'Updated Direct Affiliate Link',
        url: 'https://affiliate.example.com/item?ref=456',
        networkName: 'Custom Network',
      },
    });
    expect(updateAffRes.statusCode).toBe(200);
    expect(updateAffRes.json().version).toBe(2);

    // 6. Verify audit events recorded in Postgres
    const auditRows = await database.query(
      'SELECT action, resource_type FROM audit_events WHERE workspace_id = $1',
      [testWorkspaceId],
    );
    expect(auditRows.rowCount).toBeGreaterThanOrEqual(4);
  });
});
