import { describe, expect, it, vi } from 'vitest';
import { DatabaseError } from '../../src/database/errors.js';
import {
  validateAndMapAffiliateDestinationRow,
  validateAndMapProductFactRow,
  validateAndMapProductFactSetRow,
  validateAndMapProductRow,
} from '../../src/catalog/mappers.js';

describe('Catalog Row Mappers - Adversarial & Corrupt Row Safety', () => {
  const validUuid = '018f6c5b-21a4-789a-8def-0123456789ab';
  const validHash = Buffer.alloc(32, 0x5a);
  const validCreatedAt = new Date('2026-11-06T10:00:00.000Z');
  const validUpdatedAt = new Date('2026-11-06T11:00:00.000Z');

  function makeValidProductRow(): Record<string, unknown> {
    return {
      id: validUuid,
      workspace_id: validUuid,
      name: 'Mechanical Keyboard',
      merchant_name: 'Keychron',
      canonical_url: 'https://keychron.com/k2',
      canonical_url_hash: validHash,
      category: 'Electronics',
      description: 'Wireless mechanical keyboard',
      audience_notes: 'Gamers and typists',
      allowed_claims_notes: 'Hot-swappable',
      prohibited_claims_notes: 'No false water resistance',
      status: 'active',
      current_fact_set_id: null,
      created_at: validCreatedAt,
      updated_at: validUpdatedAt,
      version: 1,
    };
  }

  function makeValidFactSetRow(): Record<string, unknown> {
    return {
      id: validUuid,
      workspace_id: validUuid,
      product_id: validUuid,
      revision_number: 1,
      status: 'proposed',
      summary: 'Initial specs',
      created_by_user_id: validUuid,
      confirmed_by_user_id: null,
      confirmed_at: null,
      created_at: validCreatedAt,
      updated_at: validUpdatedAt,
      version: 1,
    };
  }

  function makeValidFactRow(): Record<string, unknown> {
    return {
      id: validUuid,
      workspace_id: validUuid,
      product_id: validUuid,
      fact_set_id: validUuid,
      fact_key: 'switch.type',
      value_text: 'Gateron G Pro Red',
      source_type: 'merchant_page',
      source_url: 'https://keychron.com/specs',
      source_excerpt: 'Pre-lubed switches',
      confidence: 'confirmed',
      claim_usage: 'allowed',
      created_at: validCreatedAt,
    };
  }

  function makeValidAffiliateRow(): Record<string, unknown> {
    return {
      id: validUuid,
      workspace_id: validUuid,
      product_id: validUuid,
      label: 'Keychron Official',
      url: 'https://partner.com/keychron?ref=123',
      network_name: 'Impact',
      status: 'active',
      created_at: validCreatedAt,
      updated_at: validUpdatedAt,
      version: 1,
    };
  }

  describe('Proxy and Prototype Rejection', () => {
    it('rejects row wrapped in a Proxy', () => {
      let trapRan = false;
      const proxyRow = new Proxy(makeValidProductRow(), {
        get(t, p) {
          trapRan = true;
          return Reflect.get(t, p);
        },
      });

      expect(() => validateAndMapProductRow(proxyRow)).toThrow(DatabaseError);
      expect(trapRan).toBe(false);
    });

    it('rejects row with getter property descriptors', () => {
      let getterRan = false;
      const row = makeValidProductRow();
      Object.defineProperty(row, 'name', {
        get() {
          getterRan = true;
          return 'Malicious Name';
        },
        enumerable: true,
        configurable: true,
      });

      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
      expect(getterRan).toBe(false);
    });

    it('rejects row with corrupted prototype', () => {
      const hostileProto = {
        hacked: true,
      };
      const row = Object.create(hostileProto);
      Object.assign(row, makeValidProductRow());

      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });
  });

  describe('Corrupt Field Validation & Timestamp Ordering Invariants', () => {
    it('rejects row when updated_at precedes created_at', () => {
      const row = makeValidProductRow();
      row.created_at = new Date('2026-11-06T12:00:00.000Z');
      row.updated_at = new Date('2026-11-06T10:00:00.000Z'); // precedes created_at

      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
      expect(() => validateAndMapProductRow(row)).toThrow(/precedes created_at/);
    });

    it('rejects product row with non-UUIDv7 id', () => {
      const row = makeValidProductRow();
      row.id = 'not-a-valid-uuidv7';

      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('rejects product row with invalid status enum', () => {
      const row = makeValidProductRow();
      row.status = 'deleted'; // Not in ('draft' | 'active' | 'archived')

      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('rejects canonical_url_hash that is not exactly 32 bytes', () => {
      const row = makeValidProductRow();
      row.canonical_url_hash = Buffer.alloc(16); // Only 16 bytes

      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('rejects fact-set when status is confirmed but confirmation user or date is null', () => {
      const row = makeValidFactSetRow();
      row.status = 'confirmed';
      row.confirmed_by_user_id = null;
      row.confirmed_at = null;

      expect(() => validateAndMapProductFactSetRow(row)).toThrow(DatabaseError);
    });

    it('rejects fact-set when status is proposed but confirmation fields are populated', () => {
      const row = makeValidFactSetRow();
      row.status = 'proposed';
      row.confirmed_by_user_id = validUuid;
      row.confirmed_at = validCreatedAt;

      expect(() => validateAndMapProductFactSetRow(row)).toThrow(DatabaseError);
    });

    it('rejects product fact with invalid fact_key format', () => {
      const row = makeValidFactRow();
      row.fact_key = 'INVALID KEY WITH SPACES';

      expect(() => validateAndMapProductFactRow(row)).toThrow(DatabaseError);
    });

    it('rejects product fact with invalid enum for sourceType', () => {
      const row = makeValidFactRow();
      row.source_type = 'attacker_untrusted_source';

      expect(() => validateAndMapProductFactRow(row)).toThrow(DatabaseError);
    });

    it('rejects affiliate destination with unsafe URL scheme', () => {
      const row = makeValidAffiliateRow();
      row.url = 'javascript:alert(1)';

      expect(() => validateAndMapAffiliateDestinationRow(row)).toThrow(DatabaseError);
    });

    it('clones bytes on canonical_url_hash so mutating row buffer does not corrupt snapshot', () => {
      const row = makeValidProductRow();
      const snapshot = validateAndMapProductRow(row);
      expect(snapshot.canonicalUrlHash[0]).toBe(0x5a);

      // Mutate original buffer
      validHash[0] = 0x00;

      expect(snapshot.canonicalUrlHash[0]).toBe(0x5a);
    });
  });

  describe('Version and Revision Mapping with Zero Coercion Hooks', () => {
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

    it('accepts safe integer numbers: 1, 42, and Number.MAX_SAFE_INTEGER', () => {
      const row = makeValidProductRow();
      row.version = 1;
      expect(validateAndMapProductRow(row).version).toBe(1);

      row.version = 42;
      expect(validateAndMapProductRow(row).version).toBe(42);

      row.version = Number.MAX_SAFE_INTEGER;
      expect(validateAndMapProductRow(row).version).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('accepts canonical unsigned decimal strings', () => {
      const row = makeValidProductRow();
      row.version = '1';
      expect(validateAndMapProductRow(row).version).toBe(1);

      row.version = '42';
      expect(validateAndMapProductRow(row).version).toBe(42);

      row.version = String(Number.MAX_SAFE_INTEGER);
      expect(validateAndMapProductRow(row).version).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects version > MAX_SAFE_INTEGER and non-canonical strings', () => {
      const row = makeValidProductRow();
      row.version = Number.MAX_SAFE_INTEGER + 1;
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);

      row.version = '0';
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);

      row.version = '-1';
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);

      row.version = '1.5';
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);

      row.version = '1abc';
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);

      row.version = '01';
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);

      row.version = ' 1 ';
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('rejects hostile coercion object on version with hook count zero', () => {
      const hostile = createHostileCoercionObject();
      const row = makeValidProductRow();
      row.version = hostile.obj;

      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
      expect(hostile.toPrimitive).toHaveBeenCalledTimes(0);
      expect(hostile.valueOf).toHaveBeenCalledTimes(0);
      expect(hostile.toString).toHaveBeenCalledTimes(0);
    });

    it('validates revision_number on fact sets with zero coercion hooks', () => {
      const row = makeValidFactSetRow();
      row.revision_number = Number.MAX_SAFE_INTEGER;
      expect(validateAndMapProductFactSetRow(row).revisionNumber).toBe(Number.MAX_SAFE_INTEGER);

      row.revision_number = String(Number.MAX_SAFE_INTEGER);
      expect(validateAndMapProductFactSetRow(row).revisionNumber).toBe(Number.MAX_SAFE_INTEGER);

      const hostile = createHostileCoercionObject();
      row.revision_number = hostile.obj;
      expect(() => validateAndMapProductFactSetRow(row)).toThrow(DatabaseError);
      expect(hostile.toPrimitive).toHaveBeenCalledTimes(0);
      expect(hostile.valueOf).toHaveBeenCalledTimes(0);
      expect(hostile.toString).toHaveBeenCalledTimes(0);
    });
  });

  describe('Defensive Mapper Length Bounds Parity with Domain and Schema', () => {
    it('enforces product name: 256 chars passes, 257 chars fails', () => {
      const row = makeValidProductRow();
      row.name = 'a'.repeat(256);
      expect(validateAndMapProductRow(row).name).toBe('a'.repeat(256));

      row.name = 'a'.repeat(257);
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('enforces merchant name: 256 chars passes, 257 chars fails', () => {
      const row = makeValidProductRow();
      row.merchant_name = 'm'.repeat(256);
      expect(validateAndMapProductRow(row).merchantName).toBe('m'.repeat(256));

      row.merchant_name = 'm'.repeat(257);
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('enforces product category: 128 chars passes, 129 chars fails', () => {
      const row = makeValidProductRow();
      row.category = 'c'.repeat(128);
      expect(validateAndMapProductRow(row).category).toBe('c'.repeat(128));

      row.category = 'c'.repeat(129);
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('enforces product description: 10000 chars passes, 10001 chars fails', () => {
      const row = makeValidProductRow();
      row.description = 'd'.repeat(10000);
      expect(validateAndMapProductRow(row).description).toBe('d'.repeat(10000));

      row.description = 'd'.repeat(10001);
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('enforces notes (audience, allowed, prohibited): 5000 chars passes, 5001 chars fails', () => {
      const row = makeValidProductRow();
      row.audience_notes = 'n'.repeat(5000);
      row.allowed_claims_notes = 'a'.repeat(5000);
      row.prohibited_claims_notes = 'p'.repeat(5000);
      const mapped = validateAndMapProductRow(row);
      expect(mapped.audienceNotes).toBe('n'.repeat(5000));
      expect(mapped.allowedClaimsNotes).toBe('a'.repeat(5000));
      expect(mapped.prohibitedClaimsNotes).toBe('p'.repeat(5000));

      row.audience_notes = 'n'.repeat(5001);
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });

    it('enforces fact-set summary: 2048 chars passes, 2049 chars fails', () => {
      const row = makeValidFactSetRow();
      row.summary = 's'.repeat(2048);
      expect(validateAndMapProductFactSetRow(row).summary).toBe('s'.repeat(2048));

      row.summary = 's'.repeat(2049);
      expect(() => validateAndMapProductFactSetRow(row)).toThrow(DatabaseError);
    });

    it('enforces fact key (128), value (10000), source excerpt (2048)', () => {
      const row = makeValidFactRow();
      const validKey128 = 'a'.repeat(128);
      row.fact_key = validKey128;
      row.value_text = 'v'.repeat(10000);
      row.source_excerpt = 'e'.repeat(2048);

      const mapped = validateAndMapProductFactRow(row);
      expect(mapped.factKey).toBe(validKey128);
      expect(mapped.valueText).toBe('v'.repeat(10000));
      expect(mapped.sourceExcerpt).toBe('e'.repeat(2048));

      row.value_text = 'v'.repeat(10001);
      expect(() => validateAndMapProductFactRow(row)).toThrow(DatabaseError);

      row.value_text = 'v'.repeat(10000);
      row.source_excerpt = 'e'.repeat(2049);
      expect(() => validateAndMapProductFactRow(row)).toThrow(DatabaseError);
    });

    it('enforces affiliate label (256) and network name (128)', () => {
      const row = makeValidAffiliateRow();
      row.label = 'l'.repeat(256);
      row.network_name = 'n'.repeat(128);

      const mapped = validateAndMapAffiliateDestinationRow(row);
      expect(mapped.label).toBe('l'.repeat(256));
      expect(mapped.networkName).toBe('n'.repeat(128));

      row.label = 'l'.repeat(257);
      expect(() => validateAndMapAffiliateDestinationRow(row)).toThrow(DatabaseError);

      row.label = 'l'.repeat(256);
      row.network_name = 'n'.repeat(129);
      expect(() => validateAndMapAffiliateDestinationRow(row)).toThrow(DatabaseError);
    });

    it('enforces URLs (2048 chars max)', () => {
      const row = makeValidProductRow();
      const base = 'https://example.com/';
      const validUrl2048 = base + 'x'.repeat(2048 - base.length);
      row.canonical_url = validUrl2048;
      expect(validateAndMapProductRow(row).canonicalUrl).toBe(validUrl2048);

      const invalidUrl2049 = base + 'x'.repeat(2049 - base.length);
      row.canonical_url = invalidUrl2049;
      expect(() => validateAndMapProductRow(row)).toThrow(DatabaseError);
    });
  });
});
