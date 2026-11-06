import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import {
  snapshotArchiveAffiliateDestinationCommand,
  snapshotArchiveProductCommand,
  snapshotConfirmFactSetCommand,
  snapshotCreateAffiliateDestinationCommand,
  snapshotCreateFactSetCommand,
  snapshotCreateProductCommand,
  snapshotGetFactSetCommand,
  snapshotGetProductCommand,
  snapshotListAffiliateDestinationsCommand,
  snapshotListFactSetsCommand,
  snapshotListProductsCommand,
  snapshotUpdateAffiliateDestinationCommand,
  snapshotUpdateProductCommand,
} from '../../src/catalog/command-snapshots.js';

describe('Exact Shapes and Hostile Coercion Defenses', () => {
  const validUuid = '018f6c5b-21a4-789a-8def-0123456789ab';
  const validHash = new Uint8Array(32).fill(0x5a);

  function createHostileCoercionObject() {
    const toPrimitive = vi.fn();
    const valueOf = vi.fn();
    const toString = vi.fn();
    const obj = {
      [Symbol.toPrimitive]: toPrimitive,
      valueOf,
      toString,
    };
    return { obj, toPrimitive, valueOf, toString };
  }

  describe('Exact Allowed Keys Enforcement on All Catalog Commands', () => {
    it('rejects unknown properties on CreateProductCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Product',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/p',
        category: 'Cat',
        description: 'Desc',
        unknownExtra: 'bad',
      };
      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotCreateProductCommand(cmd)).toThrow(/Unexpected property "unknownExtra"/);
    });

    it('rejects unknown properties on ListProductsCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        evilParam: 123,
      };
      expect(() => snapshotListProductsCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotListProductsCommand(cmd)).toThrow(/Unexpected property "evilParam"/);
    });

    it('rejects unknown properties on GetProductCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        inject: true,
      };
      expect(() => snapshotGetProductCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on UpdateProductCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        expectedVersion: 1,
        forbiddenField: 'malicious',
      };
      expect(() => snapshotUpdateProductCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on ArchiveProductCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        extraFlag: true,
      };
      expect(() => snapshotArchiveProductCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on CreateFactSetCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [],
        extraProp: 'no',
      };
      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on ListFactSetsCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        extraProp: 'no',
      };
      expect(() => snapshotListFactSetsCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on GetFactSetCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        factSetId: validUuid,
        extraProp: 'no',
      };
      expect(() => snapshotGetFactSetCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on ConfirmFactSetCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        factSetId: validUuid,
        extraProp: 'no',
      };
      expect(() => snapshotConfirmFactSetCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on CreateAffiliateDestinationCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        label: 'Affiliate',
        url: 'https://example.com/aff',
        trackingId: 'unsupported_tracking_id',
      };
      expect(() => snapshotCreateAffiliateDestinationCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotCreateAffiliateDestinationCommand(cmd)).toThrow(
        /Unexpected property "trackingId"/,
      );
    });

    it('rejects unknown properties on ListAffiliateDestinationsCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        extraProp: 'no',
      };
      expect(() => snapshotListAffiliateDestinationsCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on UpdateAffiliateDestinationCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        destinationId: validUuid,
        expectedVersion: 1,
        trackingId: 'bad',
      };
      expect(() => snapshotUpdateAffiliateDestinationCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects unknown properties on ArchiveAffiliateDestinationCommand', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        destinationId: validUuid,
        extraProp: 'no',
      };
      expect(() => snapshotArchiveAffiliateDestinationCommand(cmd)).toThrow(ValidationError);
    });
  });

  describe('Nested Object Exact Key Enforcement', () => {
    it('rejects unknown properties on fact items', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [
          {
            factKey: 'cpu.model',
            valueText: 'M3 Pro',
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
            injectedProp: 'malicious',
          },
        ],
      };
      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(/Unexpected property "injectedProp"/);
    });

    it('rejects unknown properties on auditContext', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        auditContext: {
          userAgentSummary: 'Valid Agent',
          unrecognizedKey: 'hacker',
        },
      };
      expect(() => snapshotArchiveProductCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotArchiveProductCommand(cmd)).toThrow(
        /Unexpected property "unrecognizedKey"/,
      );
    });

    it('rejects unknown properties on idempotency', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Product',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/p',
        category: 'Cat',
        description: 'Desc',
        idempotency: {
          keyHash: validHash,
          requestHash: validHash,
          key: 'disallowed_legacy_key',
        },
      };
      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotCreateProductCommand(cmd)).toThrow(/Unexpected property "key"/);
    });
  });

  describe('Hostile Coercion and Zero Hook Invocations', () => {
    it('rejects hostile coercion objects on fact item fields without calling hooks', () => {
      const hostile = createHostileCoercionObject();
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [
          {
            factKey: hostile.obj as unknown as string,
            valueText: 'Valid Value',
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      };

      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(ValidationError);
      expect(hostile.toPrimitive).toHaveBeenCalledTimes(0);
      expect(hostile.valueOf).toHaveBeenCalledTimes(0);
      expect(hostile.toString).toHaveBeenCalledTimes(0);
    });

    it('rejects hostile coercion on valueText without calling hooks', () => {
      const hostile = createHostileCoercionObject();
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [
          {
            factKey: 'screen.size',
            valueText: hostile.obj as unknown as string,
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      };

      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(ValidationError);
      expect(hostile.toPrimitive).toHaveBeenCalledTimes(0);
      expect(hostile.valueOf).toHaveBeenCalledTimes(0);
      expect(hostile.toString).toHaveBeenCalledTimes(0);
    });

    it('rejects Date and plain object on fact fields without hook calls', () => {
      const cmdWithDate = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [
          {
            factKey: 'time.test',
            valueText: new Date() as unknown as string,
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      };
      expect(() => snapshotCreateFactSetCommand(cmdWithDate)).toThrow(ValidationError);

      const cmdWithObj = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [
          {
            factKey: {} as unknown as string,
            valueText: 'Valid',
            sourceType: 'user',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      };
      expect(() => snapshotCreateFactSetCommand(cmdWithObj)).toThrow(ValidationError);
    });

    it('rejects hostile coercion object on product command fields without calling hooks', () => {
      const hostile = createHostileCoercionObject();
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: hostile.obj as unknown as string,
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/p',
        category: 'Cat',
        description: 'Desc',
      };

      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
      expect(hostile.toPrimitive).toHaveBeenCalledTimes(0);
      expect(hostile.valueOf).toHaveBeenCalledTimes(0);
      expect(hostile.toString).toHaveBeenCalledTimes(0);
    });
  });

  describe('CorrelationId Domain Error to Application ValidationError Conversion', () => {
    it('converts correlationId domain validation failure to ValidationError', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        auditContext: {
          correlationId: 'not-a-valid-uuid-v7',
        },
      };

      let caught: unknown;
      try {
        snapshotArchiveProductCommand(cmd);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect((caught as ValidationError).field).toBe('auditContext.correlationId');
    });
  });

  describe('Product Create Status Contract', () => {
    it('defaults status to draft when omitted', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Product',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/p',
        category: 'Cat',
        description: 'Desc',
      };
      const snap = snapshotCreateProductCommand(cmd);
      expect(snap.status).toBe('draft');
    });

    it('accepts explicit active status on create', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Product',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/p',
        category: 'Cat',
        description: 'Desc',
        status: 'active',
      };
      const snap = snapshotCreateProductCommand(cmd);
      expect(snap.status).toBe('active');
    });

    it('rejects archived status on create', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Product',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/p',
        category: 'Cat',
        description: 'Desc',
        status: 'archived',
      };
      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotCreateProductCommand(cmd)).toThrow(
        /Product status cannot be created as archived/,
      );
    });

    it('rejects invalid status on create', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Product',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/p',
        category: 'Cat',
        description: 'Desc',
        status: 'invalid_status',
      };
      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
    });
  });
});
