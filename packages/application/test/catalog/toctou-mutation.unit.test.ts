import { describe, expect, it } from 'vitest';
import {
  createProduct,
  listAffiliateDestinations,
  listProducts,
  type CreateProductCommand,
  type ListAffiliateDestinationsCommand,
  type ListAffiliateDestinationsPersistenceParams,
  type ListProductsCommand,
  type ListProductsPersistenceParams,
} from '../../src/catalog/index.js';
import type { WorkspaceAuthorizationPort } from '../../src/ports.js';
import type {
  IsoTimestamp,
  MembershipId,
  ProductId,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import { MockCatalogPersistence } from './mock-catalog-persistence.js';

describe('Catalog TOCTOU Mutation-After-Call Tests', () => {
  const validWorkspaceId = '018f6c5b-21a4-789a-8def-012345678901' as WorkspaceId;
  const validUserId = '018f6c5b-21a4-789a-8def-012345678902' as UserId;
  const validProductId = '018f6c5b-21a4-789a-8def-012345678903' as ProductId;
  const validMembershipId = '018f6c5b-21a4-789a-8def-012345678999' as MembershipId;
  const validTimestamp = '2026-11-06T10:00:00.000Z' as IsoTimestamp;
  const validHash = new Uint8Array(32).fill(0x5a);

  const mockAuth: WorkspaceAuthorizationPort = {
    async findMembership() {
      return {
        id: validMembershipId,
        workspaceId: validWorkspaceId,
        userId: validUserId,
        role: 'owner',
        status: 'active',
        invitedByUserId: null,
        joinedAt: validTimestamp,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
        version: 1,
      };
    },
  };

  const mockClock = {
    now: () => new Date('2026-11-06T12:00:00.000Z'),
  };

  const mockIdGen = {
    generateWorkspaceId: () => validWorkspaceId,
    generateMembershipId: () => validMembershipId,
    generateUserId: () => validUserId,
  };

  it('listProducts ignores mutations to command object after call starts', async () => {
    const persistence = new MockCatalogPersistence();
    const cmd: ListProductsCommand & { status?: string; limit?: number } = {
      workspaceId: validWorkspaceId,
      userId: validUserId,
      status: 'draft',
      limit: 10,
    };

    let persistenceCalledWith: ListProductsPersistenceParams | undefined;
    const originalListProducts = persistence.listProducts.bind(persistence);
    persistence.listProducts = async (params) => {
      persistenceCalledWith = params;
      return originalListProducts(params);
    };

    const promise = listProducts(cmd, {
      catalogPersistence: persistence,
      workspaceAuthorization: mockAuth,
    });

    // Attacker mutates command immediately after calling use case
    cmd.status = 'active';
    cmd.limit = 99;

    await promise;

    expect(persistenceCalledWith).toBeDefined();
    expect(persistenceCalledWith?.status).toBe('draft');
    expect(persistenceCalledWith?.limit).toBe(10);
  });

  it('listAffiliateDestinations ignores mutations to command object after call starts', async () => {
    const persistence = new MockCatalogPersistence();
    // Seed product so findProductById succeeds
    await persistence.products.set(`${validWorkspaceId}:${validProductId}`, {
      id: validProductId,
      workspaceId: validWorkspaceId,
      name: 'Product',
      merchantName: 'Merchant',
      canonicalUrl: 'https://example.com/p',
      canonicalUrlHash: validHash,
      category: 'Cat',
      description: 'Desc',
      audienceNotes: null,
      allowedClaimsNotes: null,
      prohibitedClaimsNotes: null,
      status: 'active',
      currentFactSetId: null,
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
      version: 1,
    });

    const cmd: ListAffiliateDestinationsCommand & { status?: string; limit?: number } = {
      workspaceId: validWorkspaceId,
      userId: validUserId,
      productId: validProductId,
      status: 'active',
      limit: 15,
    };

    let persistenceCalledWith: ListAffiliateDestinationsPersistenceParams | undefined;
    const originalList = persistence.listAffiliateDestinations.bind(persistence);
    persistence.listAffiliateDestinations = async (params) => {
      persistenceCalledWith = params;
      return originalList(params);
    };

    const promise = listAffiliateDestinations(cmd, {
      catalogPersistence: persistence,
      workspaceAuthorization: mockAuth,
    });

    // Attacker mutates command
    cmd.status = 'archived';
    cmd.limit = 50;

    await promise;

    expect(persistenceCalledWith).toBeDefined();
    expect(persistenceCalledWith?.status).toBe('active');
    expect(persistenceCalledWith?.limit).toBe(15);
  });

  it('createProduct with explicit status: active creates active product and audits active status', async () => {
    const persistence = new MockCatalogPersistence();
    const cmd: CreateProductCommand = {
      workspaceId: validWorkspaceId,
      userId: validUserId,
      name: 'Active Product',
      merchantName: 'Merchant',
      canonicalUrl: 'https://example.com/active',
      category: 'Electronics',
      description: 'Active description',
      status: 'active',
      idempotency: {
        keyHash: validHash,
        requestHash: validHash,
      },
    };

    const result = await createProduct(cmd, {
      catalogPersistence: persistence,
      workspaceAuthorization: mockAuth,
      clock: mockClock,
      idGenerator: mockIdGen,
    });

    expect(result.product.status).toBe('active');
    expect(persistence.auditEvents.length).toBe(1);
    expect(persistence.auditEvents[0]?.changes['status']?.after).toBe('active');
  });
});
