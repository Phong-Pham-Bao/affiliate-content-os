import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import {
  snapshotCreateProductCommand,
  snapshotUpdateProductCommand,
  snapshotCreateFactSetCommand,
  snapshotCreateAffiliateDestinationCommand,
  snapshotListProductsCommand,
} from '../../src/catalog/command-snapshots.js';

describe('Catalog Command Snapshots - Hostile Boundaries & TOCTOU', () => {
  const validUuid = '018f6c5b-21a4-789a-8def-0123456789ab';

  describe('Root Command Proxy and Prototype Defenses', () => {
    it('rejects a command wrapped in a Proxy', () => {
      let trapExecuted = false;
      const target = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Safe Name',
        merchantName: 'Safe Merchant',
        canonicalUrl: 'https://example.com/item',
        category: 'Electronics',
        description: 'Safe Desc',
      };
      const proxyCmd = new Proxy(target, {
        get(t, prop) {
          trapExecuted = true;
          return Reflect.get(t, prop);
        },
      });

      expect(() => snapshotCreateProductCommand(proxyCmd)).toThrow(ValidationError);
      expect(trapExecuted).toBe(false);
    });

    it('rejects a command with a custom or proxy prototype', () => {
      const hostileProto = new Proxy(
        {},
        {
          get() {
            throw new Error('Hostile prototype trap');
          },
        },
      );
      const cmd = Object.create(hostileProto);
      cmd.workspaceId = validUuid;
      cmd.userId = validUuid;
      cmd.name = 'Test';

      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
    });

    it('rejects a command with getter accessors on own properties', () => {
      let getterRan = false;
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Normal',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/test',
        category: 'Cat',
        get description() {
          getterRan = true;
          return 'Hostile Description';
        },
      };

      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
      expect(getterRan).toBe(false);
    });

    it('rejects a command with Symbol keys', () => {
      const sym = Symbol('hostile');
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Normal',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/test',
        category: 'Cat',
        description: 'Desc',
        [sym]: 'surprise',
      };

      expect(() => snapshotCreateProductCommand(cmd)).toThrow(ValidationError);
    });
  });

  describe('Nested Facts Array Defensive Snapshotting', () => {
    it('rejects fact item that is a Proxy', () => {
      let factTrapRan = false;
      const hostileFact = new Proxy(
        {
          factKey: 'cpu.speed',
          valueText: '3.5 GHz',
          sourceType: 'user',
          confidence: 'confirmed',
          claimUsage: 'allowed',
        },
        {
          get(t, p) {
            factTrapRan = true;
            return Reflect.get(t, p);
          },
        },
      );

      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [hostileFact],
      };

      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(ValidationError);
      expect(factTrapRan).toBe(false);
    });

    it('rejects fact item with getter property', () => {
      let getterRan = false;
      const hostileFact = {
        factKey: 'ram.size',
        get valueText() {
          getterRan = true;
          return '16GB';
        },
        sourceType: 'user',
        confidence: 'confirmed',
        claimUsage: 'allowed',
      };

      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [hostileFact],
      };

      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(ValidationError);
      expect(getterRan).toBe(false);
    });

    it('rejects sparse facts array or facts array with non-index properties', () => {
      const factsArray = [
        {
          factKey: 'key.one',
          valueText: 'val',
          sourceType: 'user',
          confidence: 'confirmed',
          claimUsage: 'allowed',
        },
      ];
      // Attach extra property
      (factsArray as unknown as Record<string, unknown>)['extraProperty'] = 'malicious';

      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: factsArray,
      };

      expect(() => snapshotCreateFactSetCommand(cmd)).toThrow(ValidationError);
    });
  });

  describe('TOCTOU Safety & Cloned Immutability', () => {
    it('mutating command object after snapshotting does not affect snapshotted values', () => {
      const mutableCmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Original Name',
        merchantName: 'Original Merchant',
        canonicalUrl: 'https://example.com/safe',
        category: 'Gadgets',
        description: 'Original Description',
      };

      const snap = snapshotCreateProductCommand(mutableCmd);
      expect(snap.name).toBe('Original Name');

      // Attacker mutates original command after call starts
      mutableCmd.name = 'Pawned Name';
      mutableCmd.description = 'Hacked Description';

      expect(snap.name).toBe('Original Name');
      expect(snap.description).toBe('Original Description');
    });

    it('mutating Uint8Array keyHash or requestHash after snapshotting does not mutate snapshot', () => {
      const rawKeyHash = new Uint8Array(32).fill(0xaa);
      const rawRequestHash = new Uint8Array(32).fill(0xbb);

      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        name: 'Prod',
        merchantName: 'Merch',
        canonicalUrl: 'https://example.com/prod',
        category: 'Cat',
        description: 'Desc',
        idempotency: {
          keyHash: rawKeyHash,
          requestHash: rawRequestHash,
        },
      };

      const snap = snapshotCreateProductCommand(cmd);
      expect(snap.idempotency).toBeDefined();
      if (!snap.idempotency) throw new Error('Expected idempotency');

      // Attacker modifies underlying typed array buffer
      rawKeyHash[0] = 0x00;
      rawRequestHash[0] = 0x00;

      expect(snap.idempotency.keyHash[0]).toBe(0xaa);
      expect(snap.idempotency.requestHash[0]).toBe(0xbb);
    });

    it('snapshotted command and facts arrays are deeply frozen', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        facts: [
          {
            factKey: 'display.type',
            valueText: 'OLED',
            sourceType: 'document',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      };

      const snap = snapshotCreateFactSetCommand(cmd);
      expect(Object.isFrozen(snap)).toBe(true);
      expect(Object.isFrozen(snap.facts)).toBe(true);
      const firstFact = snap.facts[0];
      expect(firstFact).toBeDefined();
      if (!firstFact) throw new Error('Expected fact');
      expect(Object.isFrozen(firstFact)).toBe(true);

      expect(() => {
        (firstFact as unknown as Record<string, unknown>)['valueText'] = 'Hacked';
      }).toThrow();
    });
  });

  describe('Audit Context Hostile Value Sanitization', () => {
    it('forces ipHash to null and sanitizes/bounds user-agent', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        label: 'Affiliate',
        url: 'https://partner.com/link',
        auditContext: {
          ipHash: 'attacker_supplied_fake_ip_hash',
          userAgentSummary: 'Mozilla/5.0 \x00\x1F Evil\x7F Injection ' + 'A'.repeat(300),
          correlationId: validUuid,
        },
      };

      const snap = snapshotCreateAffiliateDestinationCommand(cmd);
      expect(snap.auditContext).toBeDefined();
      if (!snap.auditContext) throw new Error('Expected auditContext');

      // ipHash must be forced to null
      expect(snap.auditContext.ipHash).toBeNull();

      // userAgentSummary must be stripped of control chars and bounded to 128 chars
      expect(snap.auditContext.userAgentSummary).not.toContain('\x00');
      expect(snap.auditContext.userAgentSummary).not.toContain('\x1F');
      expect(snap.auditContext.userAgentSummary!.length).toBeLessThanOrEqual(128);
    });
  });

  describe('MEDIUM-2: updateProduct archive prohibition', () => {
    it('rejects status: archived in updateProduct command', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        expectedVersion: 1,
        status: 'archived',
      };

      expect(() => snapshotUpdateProductCommand(cmd)).toThrow(ValidationError);
      expect(() => snapshotUpdateProductCommand(cmd)).toThrow(
        /Product status cannot be updated to archived via updateProduct/,
      );
    });

    it('allows valid draft -> active transition in updateProduct command', () => {
      const cmd = {
        workspaceId: validUuid,
        userId: validUuid,
        productId: validUuid,
        expectedVersion: 1,
        status: 'active',
      };

      const snap = snapshotUpdateProductCommand(cmd);
      expect(snap.status).toBe('active');
    });
  });

  describe('Pagination Cursor Snapshotting', () => {
    it('uses default limit 20 and accepts valid limits 1 to 100', () => {
      const defaultSnap = snapshotListProductsCommand({
        workspaceId: validUuid,
        userId: validUuid,
      });
      expect(defaultSnap.limit).toBe(20);

      const minSnap = snapshotListProductsCommand({
        workspaceId: validUuid,
        userId: validUuid,
        limit: 1,
      });
      expect(minSnap.limit).toBe(1);

      const maxSnap = snapshotListProductsCommand({
        workspaceId: validUuid,
        userId: validUuid,
        limit: 100,
      });
      expect(maxSnap.limit).toBe(100);
    });

    it('rejects invalid limits without clamping: 0, >100, non-integer, negative', () => {
      expect(() =>
        snapshotListProductsCommand({
          workspaceId: validUuid,
          userId: validUuid,
          limit: 0,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        snapshotListProductsCommand({
          workspaceId: validUuid,
          userId: validUuid,
          limit: 101,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        snapshotListProductsCommand({
          workspaceId: validUuid,
          userId: validUuid,
          limit: 9999,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        snapshotListProductsCommand({
          workspaceId: validUuid,
          userId: validUuid,
          limit: -5,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        snapshotListProductsCommand({
          workspaceId: validUuid,
          userId: validUuid,
          limit: 1.5,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        snapshotListProductsCommand({
          workspaceId: validUuid,
          userId: validUuid,
          limit: '20' as unknown as number,
        }),
      ).toThrow(ValidationError);
    });
  });
});
