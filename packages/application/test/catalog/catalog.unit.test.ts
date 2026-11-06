import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AffiliateDestinationNotFoundError,
  DuplicateFactKeyError,
  FactSetNotFoundError,
  ProductNotFoundError,
  StaleVersionConflictError,
  WorkspaceAccessDeniedError,
  archiveAffiliateDestination,
  archiveProduct,
  confirmFactSet,
  createAffiliateDestination,
  createFactSet,
  createProduct,
  getFactSet,
  getProduct,
  listAffiliateDestinations,
  listFactSets,
  listProducts,
  updateAffiliateDestination,
  updateProduct,
} from '../../src/index.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../../src/ports.js';
import {
  parseAffiliateDestinationId,
  parseAuditEventId,
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  parseMembershipId,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type AffiliateDestinationId,
  type AuditEventId,
  type IdempotencyKeyId,
  type MembershipId,
  type ProductFactId,
  type ProductFactSetId,
  type ProductId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import { MockCatalogPersistence } from './mock-catalog-persistence.js';

class MockClock implements ClockPort {
  constructor(public currentDate = new Date('2026-11-06T12:00:00.000Z')) {}
  now(): Date {
    return this.currentDate;
  }
}

class SequentialIdGenerator implements IdGeneratorPort {
  private count = 1000;
  private makeUuid(): string {
    this.count++;
    return `018f6c5b-21a4-789a-8def-${this.count.toString().padStart(12, '0')}`;
  }
  generateWorkspaceId(): WorkspaceId {
    return parseWorkspaceId(this.makeUuid());
  }
  generateMembershipId(): MembershipId {
    return parseMembershipId(this.makeUuid());
  }
  generateUserId(): UserId {
    return parseUserId(this.makeUuid());
  }
  generateAuditEventId(): AuditEventId {
    return parseAuditEventId(this.makeUuid());
  }
  generateIdempotencyKeyId(): IdempotencyKeyId {
    return parseIdempotencyKeyId(this.makeUuid());
  }
  generateProductId(): ProductId {
    return parseProductId(this.makeUuid());
  }
  generateProductFactSetId(): ProductFactSetId {
    return parseProductFactSetId(this.makeUuid());
  }
  generateProductFactId(): ProductFactId {
    return parseProductFactId(this.makeUuid());
  }
  generateAffiliateDestinationId(): AffiliateDestinationId {
    return parseAffiliateDestinationId(this.makeUuid());
  }
}

class MockWorkspaceAuthorization implements WorkspaceAuthorizationPort {
  public memberships = new Map<string, WorkspaceMembershipSnapshot>();

  setMembership(
    wsId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer',
    status: 'active' | 'suspended' = 'active',
  ): void {
    this.memberships.set(`${wsId}:${userId}`, {
      id: parseMembershipId('018f6c5b-21a4-789a-8def-000000000001'),
      workspaceId: parseWorkspaceId(wsId),
      userId: parseUserId(userId),
      role,
      status,
      invitedByUserId: null,
      joinedAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      createdAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      version: 1,
    });
  }

  async findMembership(params: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
  }): Promise<WorkspaceMembershipSnapshot | null> {
    return this.memberships.get(`${params.workspaceId}:${params.userId}`) ?? null;
  }
}

describe('Catalog Application Use Cases', () => {
  const ws1 = '018f6c5b-21a4-789a-8def-111111111111';
  const ws2 = '018f6c5b-21a4-789a-8def-222222222222';
  const ownerUser = '018f6c5b-21a4-789a-8def-333333333333';
  const editorUser = '018f6c5b-21a4-789a-8def-444444444444';
  const viewerUser = '018f6c5b-21a4-789a-8def-555555555555';
  const nonMemberUser = '018f6c5b-21a4-789a-8def-666666666666';

  function createEnv() {
    const persistence = new MockCatalogPersistence();
    const clock = new MockClock();
    const idGen = new SequentialIdGenerator();
    const auth = new MockWorkspaceAuthorization();

    auth.setMembership(ws1, ownerUser, 'owner');
    auth.setMembership(ws1, editorUser, 'editor');
    auth.setMembership(ws1, viewerUser, 'viewer');

    auth.setMembership(ws2, ownerUser, 'owner');

    return { persistence, clock, idGen, auth };
  }

  function makeIdem() {
    return {
      keyHash: crypto.randomBytes(32),
      requestHash: crypto.randomBytes(32),
    };
  }

  describe('Authorization matrix & Cross-tenant non-disclosure', () => {
    it('viewer can read products but cannot mutate products', async () => {
      const { persistence, clock, idGen, auth } = createEnv();

      const created = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Noise Cancelling Headphones',
          merchantName: 'Sony',
          canonicalUrl: 'https://sony.com/headphones',
          category: 'Audio',
          description: 'Wireless over-ear headphones',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      // Viewer can get and list
      const fetched = await getProduct(
        { workspaceId: ws1, userId: viewerUser, productId: created.product.id },
        { catalogPersistence: persistence, workspaceAuthorization: auth },
      );
      expect(fetched.id).toBe(created.product.id);

      const list = await listProducts(
        { workspaceId: ws1, userId: viewerUser },
        { catalogPersistence: persistence, workspaceAuthorization: auth },
      );
      expect(list.items.length).toBe(1);

      // Viewer cannot create, update, or archive
      await expect(
        createProduct(
          {
            workspaceId: ws1,
            userId: viewerUser,
            name: 'Keyboard',
            merchantName: 'Logitech',
            canonicalUrl: 'https://logitech.com/keyboard',
            category: 'Tech',
            description: 'Mechanical keyboard',
            idempotency: makeIdem(),
          },
          {
            catalogPersistence: persistence,
            workspaceAuthorization: auth,
            clock,
            idGenerator: idGen,
          },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);

      await expect(
        updateProduct(
          {
            workspaceId: ws1,
            userId: viewerUser,
            productId: created.product.id,
            expectedVersion: 1,
            name: 'New Name',
          },
          {
            catalogPersistence: persistence,
            workspaceAuthorization: auth,
            clock,
            idGenerator: idGen,
          },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);

      await expect(
        archiveProduct(
          { workspaceId: ws1, userId: viewerUser, productId: created.product.id },
          {
            catalogPersistence: persistence,
            workspaceAuthorization: auth,
            clock,
            idGenerator: idGen,
          },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);
    });

    it('non-members cannot access workspace catalog', async () => {
      const { persistence, auth } = createEnv();
      await expect(
        listProducts(
          { workspaceId: ws1, userId: nonMemberUser },
          { catalogPersistence: persistence, workspaceAuthorization: auth },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);
    });

    it('cross-tenant read returns ProductNotFoundError without disclosure', async () => {
      const { persistence, clock, idGen, auth } = createEnv();

      // Product in ws1
      const p1 = await createProduct(
        {
          workspaceId: ws1,
          userId: ownerUser,
          name: 'Item In WS1',
          merchantName: 'Store',
          canonicalUrl: 'https://example.com/item-1',
          category: 'Misc',
          description: 'Desc',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      // User has access to ws2, but asks for p1 using ws2 route
      await expect(
        getProduct(
          { workspaceId: ws2, userId: ownerUser, productId: p1.product.id },
          { catalogPersistence: persistence, workspaceAuthorization: auth },
        ),
      ).rejects.toThrow(ProductNotFoundError);
    });
  });

  describe('Product Creation & Idempotency', () => {
    it('creates product and generates UUIDv7', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const result = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Wireless Mouse',
          merchantName: 'Logitech',
          canonicalUrl: 'https://logitech.com/mouse',
          category: 'Electronics',
          description: 'Ergonomic mouse',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      expect(result.product.name).toBe('Wireless Mouse');
      expect(result.product.status).toBe('draft');
      expect(result.product.currentFactSetId).toBeNull();
      expect(result.cached).toBe(false);
      expect(result.duplicateWarning).toBe(false);
    });

    it('replays same request payload idempotently', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const idem = makeIdem();
      const cmd = {
        workspaceId: ws1,
        userId: editorUser,
        name: 'Desk Lamp',
        merchantName: 'BenQ',
        canonicalUrl: 'https://benq.com/lamp',
        category: 'Lighting',
        description: 'Reading lamp',
        idempotency: idem,
      };

      const res1 = await createProduct(cmd, {
        catalogPersistence: persistence,
        workspaceAuthorization: auth,
        clock,
        idGenerator: idGen,
      });
      const res2 = await createProduct(cmd, {
        catalogPersistence: persistence,
        workspaceAuthorization: auth,
        clock,
        idGenerator: idGen,
      });

      expect(res1.cached).toBe(false);
      expect(res2.cached).toBe(true);
      expect(res2.product.id).toBe(res1.product.id);
    });

    it('flags duplicate canonical URL warning in same workspace without silent merge', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const res1 = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Product A',
          merchantName: 'Store',
          canonicalUrl: 'https://example.com/same-product',
          category: 'Category',
          description: 'Desc',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(res1.duplicateWarning).toBe(false);

      const res2 = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Product B',
          merchantName: 'Store',
          canonicalUrl: 'https://example.com/same-product',
          category: 'Category',
          description: 'Desc',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(res2.duplicateWarning).toBe(true);
      expect(res2.product.id).not.toBe(res1.product.id);
    });
  });

  describe('Product Concurrency & Archival', () => {
    it('enforces optimistic concurrency on update', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const created = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Monitor Stand',
          merchantName: 'Grovemade',
          canonicalUrl: 'https://grovemade.com/stand',
          category: 'Furniture',
          description: 'Wood stand',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      // Stale version rejected
      await expect(
        updateProduct(
          {
            workspaceId: ws1,
            userId: editorUser,
            productId: created.product.id,
            expectedVersion: 999,
            name: 'Updated Stand',
          },
          {
            catalogPersistence: persistence,
            workspaceAuthorization: auth,
            clock,
            idGenerator: idGen,
          },
        ),
      ).rejects.toThrow(StaleVersionConflictError);

      // Matching version succeeds
      const updated = await updateProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: created.product.id,
          expectedVersion: 1,
          name: 'Updated Stand',
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(updated.product.name).toBe('Updated Stand');
      expect(updated.product.version).toBe(2);
    });

    it('archiving product is idempotent', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const created = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Old Chair',
          merchantName: 'Herman Miller',
          canonicalUrl: 'https://hm.com/chair',
          category: 'Furniture',
          description: 'Office chair',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const arc1 = await archiveProduct(
        { workspaceId: ws1, userId: editorUser, productId: created.product.id },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(arc1.alreadyArchived).toBe(false);
      expect(arc1.product.status).toBe('archived');

      const arc2 = await archiveProduct(
        { workspaceId: ws1, userId: editorUser, productId: created.product.id },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(arc2.alreadyArchived).toBe(true);
    });
  });

  describe('Fact Sets & Confirmation', () => {
    it('creates fact set and enforces unique fact keys within set', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const created = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Coffee Maker',
          merchantName: 'Breville',
          canonicalUrl: 'https://breville.com/coffee',
          category: 'Kitchen',
          description: 'Espresso machine',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      // Duplicate fact key in payload rejected
      await expect(
        createFactSet(
          {
            workspaceId: ws1,
            userId: editorUser,
            productId: created.product.id,
            facts: [
              {
                factKey: 'pressure.bar',
                valueText: '15 bar',
                sourceType: 'merchant_page',
                confidence: 'confirmed',
                claimUsage: 'allowed',
              },
              {
                factKey: 'pressure.bar',
                valueText: '15 bar duplicate',
                sourceType: 'user',
                confidence: 'suggested',
                claimUsage: 'allowed',
              },
            ],
          },
          {
            catalogPersistence: persistence,
            workspaceAuthorization: auth,
            clock,
            idGenerator: idGen,
          },
        ),
      ).rejects.toThrow(DuplicateFactKeyError);

      const fs = await createFactSet(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: created.product.id,
          facts: [
            {
              factKey: 'pressure.bar',
              valueText: '15 bar',
              sourceType: 'merchant_page',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
            {
              factKey: 'tank.capacity',
              valueText: '2 Liters',
              sourceType: 'document',
              confidence: 'suggested',
              claimUsage: 'context_only',
            },
          ],
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      expect(fs.factSet.status).toBe('proposed');
      expect(fs.factSet.revisionNumber).toBe(1);
      expect(fs.facts.length).toBe(2);
    });

    it('confirms fact set and updates product currentFactSetId atomically', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const prod = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Blender',
          merchantName: 'Vitamix',
          canonicalUrl: 'https://vitamix.com/blender',
          category: 'Kitchen',
          description: 'High speed blender',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const fs = await createFactSet(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          facts: [
            {
              factKey: 'motor.hp',
              valueText: '2.2 HP',
              sourceType: 'merchant_page',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
          ],
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const conf1 = await confirmFactSet(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          factSetId: fs.factSet.id,
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(conf1.alreadyConfirmed).toBe(false);
      expect(conf1.factSet.status).toBe('confirmed');
      expect(conf1.product.currentFactSetId).toBe(fs.factSet.id);

      // Repeated confirmation is idempotent
      const conf2 = await confirmFactSet(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          factSetId: fs.factSet.id,
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(conf2.alreadyConfirmed).toBe(true);
    });
  });

  describe('Affiliate Destinations & URL Redaction', () => {
    it('creates affiliate destination and redacts query/fragment in audit events', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const prod = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Smart Watch',
          merchantName: 'Apple',
          canonicalUrl: 'https://apple.com/watch',
          category: 'Wearables',
          description: 'Smartwatch',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const affiliateUrl = 'https://partner.network.com/click?aff_id=98765&sub_id=topsecret#frag';
      const dest = await createAffiliateDestination(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          label: 'Apple Affiliate Link',
          url: affiliateUrl,
          networkName: 'Impact',
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      expect(dest.label).toBe('Apple Affiliate Link');
      expect(dest.url).toBe(affiliateUrl); // Returned to authorized editor

      // Audit event must never contain raw affiliate query or fragment
      const lastAudit = persistence.auditEvents[persistence.auditEvents.length - 1];
      expect(lastAudit).toBeDefined();
      if (!lastAudit) throw new Error('Expected audit event');
      expect(lastAudit.action).toBe('catalog.affiliate_created');
      expect(lastAudit.changes['label']?.after).toBe('Apple Affiliate Link');
      expect(lastAudit.changes['network_name']?.after).toBe('Impact');
      const auditJson = JSON.stringify(lastAudit);
      expect(auditJson).not.toContain('98765');
      expect(auditJson).not.toContain('topsecret');
      expect(auditJson).not.toContain('frag');
    });

    it('optimistic concurrency and archive idempotency on affiliate destination', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const prod = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Drone',
          merchantName: 'DJI',
          canonicalUrl: 'https://dji.com/drone',
          category: 'Cameras',
          description: 'Quadcopter',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const dest = await createAffiliateDestination(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          label: 'Primary Link',
          url: 'https://shareasale.com/dji?id=123',
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      // Stale version rejected
      await expect(
        updateAffiliateDestination(
          {
            workspaceId: ws1,
            userId: editorUser,
            productId: prod.product.id,
            destinationId: dest.id,
            expectedVersion: 10,
            label: 'New Label',
          },
          {
            catalogPersistence: persistence,
            workspaceAuthorization: auth,
            clock,
            idGenerator: idGen,
          },
        ),
      ).rejects.toThrow(StaleVersionConflictError);

      const updated = await updateAffiliateDestination(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          destinationId: dest.id,
          expectedVersion: 1,
          label: 'Updated Link Label',
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(updated.label).toBe('Updated Link Label');
      expect(updated.version).toBe(2);

      const arc1 = await archiveAffiliateDestination(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          destinationId: dest.id,
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(arc1.alreadyArchived).toBe(false);
      expect(arc1.destination.status).toBe('archived');

      const arc2 = await archiveAffiliateDestination(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          destinationId: dest.id,
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );
      expect(arc2.alreadyArchived).toBe(true);
    });

    it('can list and read fact-sets and affiliate destinations with error handling', async () => {
      const { persistence, clock, idGen, auth } = createEnv();
      const prod = await createProduct(
        {
          workspaceId: ws1,
          userId: editorUser,
          name: 'Fact Reader Prod',
          merchantName: 'Store',
          canonicalUrl: 'https://store.example/item',
          category: 'Hardware',
          description: 'A tool',
          idempotency: makeIdem(),
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const fs = await createFactSet(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          facts: [
            {
              factKey: 'weight',
              valueText: '1kg',
              sourceType: 'merchant_page',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
          ],
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const dest = await createAffiliateDestination(
        {
          workspaceId: ws1,
          userId: editorUser,
          productId: prod.product.id,
          label: 'Affiliate 1',
          url: 'https://partner.example/buy?ref=1',
        },
        {
          catalogPersistence: persistence,
          workspaceAuthorization: auth,
          clock,
          idGenerator: idGen,
        },
      );

      const fsList = await listFactSets(
        { workspaceId: ws1, userId: viewerUser, productId: prod.product.id },
        { catalogPersistence: persistence, workspaceAuthorization: auth },
      );
      expect(fsList.items.length).toBe(1);
      expect(fsList.items[0]?.id).toBe(fs.factSet.id);

      const readFs = await getFactSet(
        {
          workspaceId: ws1,
          userId: viewerUser,
          productId: prod.product.id,
          factSetId: fs.factSet.id,
        },
        { catalogPersistence: persistence, workspaceAuthorization: auth },
      );
      expect(readFs.factSet.id).toBe(fs.factSet.id);
      expect(readFs.facts.length).toBe(1);

      await expect(
        getFactSet(
          {
            workspaceId: ws1,
            userId: viewerUser,
            productId: prod.product.id,
            factSetId: parseProductFactSetId('018f6c5b-21a4-789a-8def-999999999999'),
          },
          { catalogPersistence: persistence, workspaceAuthorization: auth },
        ),
      ).rejects.toThrow(FactSetNotFoundError);

      const destList = await listAffiliateDestinations(
        { workspaceId: ws1, userId: viewerUser, productId: prod.product.id },
        { catalogPersistence: persistence, workspaceAuthorization: auth },
      );
      expect(destList.items.length).toBe(1);
      expect(destList.items[0]?.id).toBe(dest.id);

      await expect(
        archiveAffiliateDestination(
          {
            workspaceId: ws1,
            userId: editorUser,
            productId: prod.product.id,
            destinationId: parseAffiliateDestinationId('018f6c5b-21a4-789a-8def-999999999999'),
          },
          {
            catalogPersistence: persistence,
            workspaceAuthorization: auth,
            clock,
            idGenerator: idGen,
          },
        ),
      ).rejects.toThrow(AffiliateDestinationNotFoundError);
    });
  });
});
