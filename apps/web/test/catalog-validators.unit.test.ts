import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api-validators-common.js';
import {
  validateAffiliate,
  validateAffiliateListResponse,
} from '../src/lib/catalog-validators-affiliate.js';
import {
  validateFact,
  validateConfirmFactSetResponse,
  validateFactSet,
  validateFactSetDetailResponse,
  validateFactSetListResponse,
} from '../src/lib/catalog-validators-fact.js';
import {
  validateProduct,
  validateProductListResponse,
} from '../src/lib/catalog-validators-product.js';

describe('Catalog Web API Validators', () => {
  const validProduct = {
    id: '0192b012-3456-789a-8bcd-ef0123456701',
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
    name: 'Standing Desk',
    merchantName: 'DeskCorp',
    canonicalUrl: 'https://example.com/desk',
    category: 'furniture',
    description: 'High quality motorized desk',
    audienceNotes: 'Remote workers',
    allowedClaimsNotes: 'Dual motor',
    prohibitedClaimsNotes: null,
    status: 'draft' as const,
    currentFactSetId: null,
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
    version: 1,
  };

  const validFact = {
    id: '0192b012-3456-789a-8bcd-ef0123456703',
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
    productId: '0192b012-3456-789a-8bcd-ef0123456701',
    factSetId: '0192b012-3456-789a-8bcd-ef0123456704',
    factKey: 'motor_count',
    valueText: '2',
    sourceType: 'document' as const,
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed' as const,
    claimUsage: 'allowed' as const,
    createdAt: '2026-11-06T12:00:00Z',
  };

  const validFactSet = {
    id: '0192b012-3456-789a-8bcd-ef0123456704',
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
    productId: '0192b012-3456-789a-8bcd-ef0123456701',
    revisionNumber: 1,
    status: 'proposed' as const,
    summary: 'Specs',
    confirmedByUserId: null,
    confirmedAt: null,
    createdByUserId: '0192b012-3456-789a-8bcd-ef0123456705',
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
    version: 1,
  };

  const validAffiliate = {
    id: '0192b012-3456-789a-8bcd-ef0123456706',
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
    productId: '0192b012-3456-789a-8bcd-ef0123456701',
    label: 'Amazon Primary',
    url: 'https://amazon.com/dp/123',
    networkName: 'Amazon',
    status: 'active' as const,
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
    version: 1,
  };

  describe('validateProduct', () => {
    it('accepts valid product DTO and parses all fields correctly', () => {
      const validated = validateProduct(validProduct);
      expect(validated.name).toBe('Standing Desk');
      expect(validated.status).toBe('draft');
    });

    it('rejects unexpected additional properties (anti-leak protection)', () => {
      expect(() => validateProduct({ ...validProduct, secretAdminToken: 'leak' })).toThrow(
        ApiError,
      );
    });

    it('rejects invalid UUID format', () => {
      expect(() => validateProduct({ ...validProduct, id: 'not-a-uuid' })).toThrow(ApiError);
    });

    it('rejects invalid RFC3339 timestamp', () => {
      expect(() => validateProduct({ ...validProduct, createdAt: 'not-a-date' })).toThrow(ApiError);
    });

    it('rejects invalid product status enum', () => {
      expect(() => validateProduct({ ...validProduct, status: 'discontinued' })).toThrow(ApiError);
    });

    it('rejects coercible flags, malformed nullable fields, and values above B1 bounds', () => {
      expect(() => validateProduct({ ...validProduct, duplicateWarning: 'false' })).toThrow(
        ApiError,
      );
      expect(() => validateProduct({ ...validProduct, audienceNotes: {} })).toThrow(ApiError);
      expect(() => validateProduct({ ...validProduct, name: 'x'.repeat(257) })).toThrow(ApiError);
      expect(validateProduct({ ...validProduct, name: 'x'.repeat(256) }).name).toHaveLength(256);
    });
  });

  describe('validateProductListResponse', () => {
    it('accepts valid list response with items and page', () => {
      const res = validateProductListResponse({
        items: [validProduct],
        page: { nextCursor: null, hasMore: false },
      });
      expect(res.items).toHaveLength(1);
      expect(res.page.hasMore).toBe(false);
    });

    it('rejects malformed items array', () => {
      expect(() =>
        validateProductListResponse({
          items: [{ invalid: 'item' }],
          page: { nextCursor: null, hasMore: false },
        }),
      ).toThrow(ApiError);
    });

    it('rejects coercible and inconsistent pagination metadata', () => {
      expect(() =>
        validateProductListResponse({
          items: [],
          page: { nextCursor: null, hasMore: 'false' },
        }),
      ).toThrow(ApiError);
      expect(() =>
        validateProductListResponse({
          items: [],
          page: { nextCursor: 'next', hasMore: false },
        }),
      ).toThrow(ApiError);
    });
  });

  describe('validateFact and validateFactSet', () => {
    it('accepts valid fact and fact set DTOs', () => {
      const vFact = validateFact(validFact);
      const vFactSet = validateFactSet(validFactSet);
      expect(vFact.factKey).toBe('motor_count');
      expect(vFactSet.revisionNumber).toBe(1);
    });

    it('rejects fact with invalid confidence or claimUsage', () => {
      expect(() => validateFact({ ...validFact, confidence: 'guess' })).toThrow(ApiError);
      expect(() => validateFact({ ...validFact, claimUsage: 'mandatory' })).toThrow(ApiError);
    });

    it('validates complete fact set detail response with nested facts', () => {
      const res = validateFactSetDetailResponse({
        factSet: validFactSet,
        facts: [validFact],
      });
      expect(res.factSet.id).toBe(validFactSet.id);
      expect(res.facts).toHaveLength(1);
    });

    it('validates fact sets list response', () => {
      const listRes = validateFactSetListResponse({
        items: [validFactSet],
        page: { nextCursor: null, hasMore: false },
      });
      expect(listRes.items).toHaveLength(1);
    });

    it('rejects malformed fact bounds, state invariants, and coercible confirmation flags', () => {
      expect(() => validateFact({ ...validFact, factKey: 'Upper_Case' })).toThrow(ApiError);
      expect(() => validateFact({ ...validFact, valueText: 'x'.repeat(10001) })).toThrow(ApiError);
      expect(() =>
        validateFactSet({ ...validFactSet, status: 'confirmed', confirmedAt: null }),
      ).toThrow(ApiError);
      expect(() =>
        validateConfirmFactSetResponse({
          factSet: validFactSet,
          product: validProduct,
          alreadyConfirmed: 'false',
        }),
      ).toThrow(ApiError);
    });
  });

  describe('validateAffiliate', () => {
    it('accepts valid affiliate destination DTO', () => {
      const vAff = validateAffiliate(validAffiliate);
      expect(vAff.label).toBe('Amazon Primary');
      expect(vAff.status).toBe('active');
    });

    it('validates affiliate list response', () => {
      const res = validateAffiliateListResponse({
        items: [validAffiliate],
        page: { nextCursor: null, hasMore: false },
      });
      expect(res.items).toHaveLength(1);
    });

    it('rejects coercible affiliate fields and pagination metadata', () => {
      expect(() => validateAffiliate({ ...validAffiliate, alreadyArchived: 'false' })).toThrow(
        ApiError,
      );
      expect(() => validateAffiliate({ ...validAffiliate, networkName: {} })).toThrow(ApiError);
      expect(() =>
        validateAffiliateListResponse({
          items: [],
          page: { nextCursor: 123, hasMore: true },
        }),
      ).toThrow(ApiError);
    });
  });
});
