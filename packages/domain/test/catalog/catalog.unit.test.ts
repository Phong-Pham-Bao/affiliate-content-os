import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  canTransitionAffiliateStatus,
  canTransitionFactSetStatus,
  canTransitionProductStatus,
  computeCanonicalUrlHash,
  isAffiliateDestinationStatus,
  isFactClaimUsage,
  isFactConfidence,
  isFactSetStatus,
  isFactSourceType,
  isProductStatus,
  normalizeCanonicalProductUrl,
  parseAffiliateDestinationId,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  redactAffiliateUrl,
  validateAffiliateLabel,
  validateAffiliateNetworkName,
  validateAllowedClaimsNotes,
  validateAudienceNotes,
  validateCategory,
  validateDescription,
  validateFactKey,
  validateFactSetSummary,
  validateFactValue,
  validateMerchantName,
  validateProductName,
  validateProhibitedClaimsNotes,
  validateSafeHttpUrl,
  validateSourceExcerpt,
} from '../../src/index.js';

describe('Catalog Domain', () => {
  const validUuidV7 = '018f6c5b-21a4-789a-8def-123456789abc';

  describe('Branded IDs', () => {
    it('parses valid UUIDv7 IDs', () => {
      expect(parseProductId(validUuidV7)).toBe(validUuidV7);
      expect(parseProductFactSetId(validUuidV7)).toBe(validUuidV7);
      expect(parseProductFactId(validUuidV7)).toBe(validUuidV7);
      expect(parseAffiliateDestinationId(validUuidV7)).toBe(validUuidV7);
    });

    it('rejects invalid UUIDs or non-strings', () => {
      expect(() => parseProductId('invalid-uuid')).toThrow(DomainValidationError);
      expect(() => parseProductFactSetId(12345)).toThrow(DomainValidationError);
      expect(() => parseProductFactId(null)).toThrow(DomainValidationError);
      expect(() => parseAffiliateDestinationId(undefined)).toThrow(DomainValidationError);
    });
  });

  describe('Closed Enums', () => {
    it('validates product status', () => {
      expect(isProductStatus('draft')).toBe(true);
      expect(isProductStatus('active')).toBe(true);
      expect(isProductStatus('archived')).toBe(true);
      expect(isProductStatus('deleted')).toBe(false);
      expect(isProductStatus(null)).toBe(false);
    });

    it('validates fact set status', () => {
      expect(isFactSetStatus('proposed')).toBe(true);
      expect(isFactSetStatus('confirmed')).toBe(true);
      expect(isFactSetStatus('rejected')).toBe(false);
    });

    it('validates fact source types', () => {
      expect(isFactSourceType('user')).toBe(true);
      expect(isFactSourceType('merchant_page')).toBe(true);
      expect(isFactSourceType('document')).toBe(true);
      expect(isFactSourceType('other')).toBe(true);
      expect(isFactSourceType('web_scrape')).toBe(false);
    });

    it('validates fact confidences', () => {
      expect(isFactConfidence('confirmed')).toBe(true);
      expect(isFactConfidence('suggested')).toBe(true);
      expect(isFactConfidence('uncertain')).toBe(true);
      expect(isFactConfidence('verified')).toBe(false);
    });

    it('validates fact claim usages', () => {
      expect(isFactClaimUsage('allowed')).toBe(true);
      expect(isFactClaimUsage('context_only')).toBe(true);
      expect(isFactClaimUsage('prohibited')).toBe(true);
      expect(isFactClaimUsage('disallowed')).toBe(false);
    });

    it('validates affiliate destination status', () => {
      expect(isAffiliateDestinationStatus('active')).toBe(true);
      expect(isAffiliateDestinationStatus('archived')).toBe(true);
      expect(isAffiliateDestinationStatus('disabled')).toBe(false);
    });
  });

  describe('Transitions', () => {
    it('enforces product status transitions', () => {
      expect(canTransitionProductStatus('draft', 'active')).toBe(true);
      expect(canTransitionProductStatus('draft', 'archived')).toBe(true);
      expect(canTransitionProductStatus('draft', 'draft')).toBe(false);
      expect(canTransitionProductStatus('active', 'archived')).toBe(true);
      expect(canTransitionProductStatus('active', 'draft')).toBe(false);
      expect(canTransitionProductStatus('archived', 'archived')).toBe(true); // idempotent
      expect(canTransitionProductStatus('archived', 'active')).toBe(false);
    });

    it('enforces fact set status transitions', () => {
      expect(canTransitionFactSetStatus('proposed', 'confirmed')).toBe(true);
      expect(canTransitionFactSetStatus('proposed', 'proposed')).toBe(false);
      expect(canTransitionFactSetStatus('confirmed', 'confirmed')).toBe(true); // idempotent
      expect(canTransitionFactSetStatus('confirmed', 'proposed')).toBe(false); // immutable
    });

    it('enforces affiliate destination status transitions', () => {
      expect(canTransitionAffiliateStatus('active', 'archived')).toBe(true);
      expect(canTransitionAffiliateStatus('active', 'active')).toBe(false);
      expect(canTransitionAffiliateStatus('archived', 'archived')).toBe(true); // idempotent
      expect(canTransitionAffiliateStatus('archived', 'active')).toBe(false);
    });
  });

  describe('Safe HTTP(S) URL Validation & Normalization', () => {
    it('accepts valid absolute http and https URLs', () => {
      expect(validateSafeHttpUrl('https://example.com/products/123', 'url')).toBe(
        'https://example.com/products/123',
      );
      expect(validateSafeHttpUrl('http://shop.example.org?ref=abc', 'url')).toBe(
        'http://shop.example.org?ref=abc',
      );
    });

    it('rejects URLs with embedded credentials', () => {
      expect(() => validateSafeHttpUrl('https://user:pass@example.com/item', 'url')).toThrow(
        DomainValidationError,
      );
      expect(() => validateSafeHttpUrl('https://admin@example.com/item', 'url')).toThrow(
        DomainValidationError,
      );
    });

    it('rejects URLs with control characters', () => {
      expect(() => validateSafeHttpUrl('https://example.com/item\x00', 'url')).toThrow(
        DomainValidationError,
      );
      expect(() => validateSafeHttpUrl('https://example.com/item\r\n', 'url')).toThrow(
        DomainValidationError,
      );
    });

    it('rejects malformed percent-encodings and encoded controls', () => {
      expect(() => validateSafeHttpUrl('https://example.com/%ZZ', 'url')).toThrow(
        DomainValidationError,
      );
      expect(() => validateSafeHttpUrl('https://example.com/%1', 'url')).toThrow(
        DomainValidationError,
      );
      expect(() => validateSafeHttpUrl('https://example.com/%00null', 'url')).toThrow(
        DomainValidationError,
      );
      expect(() => validateSafeHttpUrl('https://example.com/%7Fdel', 'url')).toThrow(
        DomainValidationError,
      );
    });

    it('rejects non-http protocols', () => {
      expect(() => validateSafeHttpUrl('javascript:alert(1)', 'url')).toThrow(
        DomainValidationError,
      );
      expect(() => validateSafeHttpUrl('file:///etc/passwd', 'url')).toThrow(DomainValidationError);
      expect(() => validateSafeHttpUrl('ftp://example.com/file', 'url')).toThrow(
        DomainValidationError,
      );
    });

    it('normalizes canonical product URLs where unambiguous', () => {
      const normalized = normalizeCanonicalProductUrl('HTTPS://EXAMPLE.COM:443/items/abc#section');
      expect(normalized).toBe('https://example.com/items/abc');

      const rootNormalized = normalizeCanonicalProductUrl('http://Shop.COM:80/');
      expect(rootNormalized).toBe('http://shop.com');
    });

    it('computes 32-byte SHA-256 hash for canonical URLs', () => {
      const hash = computeCanonicalUrlHash('https://example.com/item');
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.byteLength).toBe(32);
    });

    it('redacts query and fragment from affiliate URLs', () => {
      const raw = 'https://partner.network.com/click?aff_id=123&token=secret#frag';
      const redacted = redactAffiliateUrl(raw);
      expect(redacted).not.toContain('123');
      expect(redacted).not.toContain('secret');
      expect(redacted).not.toContain('frag');
      expect(redacted).toBe('https://partner.network.com/click?redacted');
    });
  });

  describe('Bounded Field Validations', () => {
    it('validates product name, merchant name, category, and description', () => {
      expect(validateProductName('  Mechanical Keyboard  ')).toBe('Mechanical Keyboard');
      expect(validateMerchantName('Keychron')).toBe('Keychron');
      expect(validateCategory('Electronics')).toBe('Electronics');
      expect(validateDescription('High performance keyboard')).toBe('High performance keyboard');

      expect(() => validateProductName('')).toThrow(DomainValidationError);
      expect(() => validateProductName('a'.repeat(257))).toThrow(DomainValidationError);
      expect(() => validateMerchantName('   ')).toThrow(DomainValidationError);
      expect(() => validateCategory('')).toThrow(DomainValidationError);
      expect(() => validateDescription('')).toThrow(DomainValidationError);
      expect(() => validateDescription('a'.repeat(10001))).toThrow(DomainValidationError);
    });

    it('validates optional notes', () => {
      expect(validateAudienceNotes(undefined)).toBeNull();
      expect(validateAudienceNotes(null)).toBeNull();
      expect(validateAudienceNotes('   ')).toBeNull();
      expect(validateAudienceNotes('Gamers and coders')).toBe('Gamers and coders');
      expect(() => validateAudienceNotes('a'.repeat(5001))).toThrow(DomainValidationError);

      expect(validateAllowedClaimsNotes('Hot swappable')).toBe('Hot swappable');
      expect(validateProhibitedClaimsNotes('Waterproof')).toBe('Waterproof');
    });

    it('validates factKey and valueText', () => {
      expect(validateFactKey('battery_life')).toBe('battery_life');
      expect(validateFactKey('weight.grams')).toBe('weight.grams');
      expect(validateFactKey('screen-size')).toBe('screen-size');
      expect(() => validateFactKey('Battery Life')).toThrow(DomainValidationError);
      expect(() => validateFactKey('key--invalid')).toThrow(DomainValidationError);
      expect(() => validateFactKey('')).toThrow(DomainValidationError);

      expect(validateFactValue('4000 mAh')).toBe('4000 mAh');
      expect(() => validateFactValue('')).toThrow(DomainValidationError);
      expect(() => validateFactValue('a'.repeat(10001))).toThrow(DomainValidationError);

      expect(validateSourceExcerpt('Official specs page')).toBe('Official specs page');
      expect(validateFactSetSummary('Initial revision')).toBe('Initial revision');
    });

    it('validates affiliate label and network name', () => {
      expect(validateAffiliateLabel('Amazon Associate Link')).toBe('Amazon Associate Link');
      expect(validateAffiliateNetworkName('Amazon')).toBe('Amazon');
      expect(validateAffiliateNetworkName(null)).toBeNull();
      expect(() => validateAffiliateLabel('')).toThrow(DomainValidationError);
      expect(() => validateAffiliateLabel('a'.repeat(257))).toThrow(DomainValidationError);
      expect(() => validateAffiliateNetworkName('a'.repeat(129))).toThrow(DomainValidationError);
    });
  });

  describe('Adversarial / Hostile Input Rejection', () => {
    it('rejects proxies for fields and URLs', () => {
      const proxyString = new Proxy(new String('https://example.com'), {}) as unknown as string;
      expect(() => validateSafeHttpUrl(proxyString, 'url')).toThrow(DomainValidationError);
      expect(() => validateProductName(proxyString)).toThrow(DomainValidationError);
    });

    it('rejects coercion hooks', () => {
      const hostileObject = {
        valueOf() {
          return 'https://example.com';
        },
      };
      expect(() => validateProductName(hostileObject)).toThrow(DomainValidationError);
      expect(() => validateSafeHttpUrl(hostileObject, 'url')).toThrow(DomainValidationError);
    });
  });
});
