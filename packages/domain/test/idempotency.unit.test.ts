import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  isIdempotencyKeyId,
  parseIdempotencyKeyId,
  validateIdempotencyKey,
} from '../src/index.js';

describe('domain - idempotency', () => {
  it('validates a valid idempotency key', () => {
    expect(validateIdempotencyKey('key-123')).toBe('key-123');
    expect(validateIdempotencyKey('a'.repeat(128))).toBe('a'.repeat(128));
    expect(validateIdempotencyKey('0192b012-3456-789a-8bcd-ef0123456701')).toBe(
      '0192b012-3456-789a-8bcd-ef0123456701',
    );
  });

  it('rejects invalid idempotency keys', () => {
    expect(() => validateIdempotencyKey(null)).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey('')).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey('   ')).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey('key with spaces')).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey(' key')).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey('key ')).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey('a'.repeat(129))).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey('key\n')).toThrow(DomainValidationError);
    expect(() => validateIdempotencyKey('key\t')).toThrow(DomainValidationError);
  });

  it('validates and parses idempotency key UUIDv7 IDs', () => {
    const validUuid = '0192b012-3456-789a-8bcd-ef0123456701';
    expect(isIdempotencyKeyId(validUuid)).toBe(true);
    expect(parseIdempotencyKeyId(validUuid)).toBe(validUuid);

    expect(isIdempotencyKeyId('not-a-uuid')).toBe(false);
    expect(() => parseIdempotencyKeyId('not-a-uuid')).toThrow(DomainValidationError);
  });
});
