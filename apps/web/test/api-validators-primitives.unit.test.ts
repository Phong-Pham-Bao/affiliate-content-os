import { describe, expect, it } from 'vitest';
import {
  hasExactOwnKeys,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
  validateProblemDetails,
} from '../src/lib/api-validators-common.js';

describe('apps/web - api-validators-common primitives', () => {
  it('isPlainObject validates plain objects and null prototypes', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('str')).toBe(false);
    expect(isPlainObject(123)).toBe(false);
  });

  it('hasExactOwnKeys enforces exact own keys and rejects symbols or extra/missing keys', () => {
    expect(hasExactOwnKeys({ a: 1, b: 2 }, ['a', 'b'])).toBe(true);
    expect(hasExactOwnKeys({ a: 1 }, ['a', 'b'])).toBe(false);
    expect(hasExactOwnKeys({ a: 1, b: 2, c: 3 }, ['a', 'b'])).toBe(false);

    // Rejects symbol keys
    const symObj = { a: 1, b: 2, [Symbol('evil')]: 3 };
    expect(hasExactOwnKeys(symObj, ['a', 'b'])).toBe(false);
  });

  it('isValidUuidV7 validates canonical lowercase UUIDv7 and rejects uppercase or UUIDv4', () => {
    const validUuidV7 = '018f4a1b-9b2e-7111-8000-000000000001';
    expect(isValidUuidV7(validUuidV7)).toBe(true);

    // Uppercase or mixed-case UUIDv7 must be rejected
    expect(isValidUuidV7('018F4A1B-9B2E-7111-8000-000000000001')).toBe(false);
    expect(isValidUuidV7('018f4a1b-9b2e-7111-8000-00000000000A')).toBe(false);

    // UUIDv4 (version 4) must be rejected
    const uuidV4 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    expect(isValidUuidV7(uuidV4)).toBe(false);

    expect(isValidUuidV7('not-a-uuid')).toBe(false);
    expect(isValidUuidV7(12345)).toBe(false);
    expect(isValidUuidV7(null)).toBe(false);
  });

  it('isValidRfc3339DateTime requires valid ISO date-time and rejects calendar-invalid or normalized dates', () => {
    // Valid standard and fractional ISO date-times
    expect(isValidRfc3339DateTime('2026-11-06T12:00:00Z')).toBe(true);
    expect(isValidRfc3339DateTime('2026-11-06T12:00:00.123+05:30')).toBe(true);
    expect(isValidRfc3339DateTime('2026-11-06T00:00:00-08:00')).toBe(true);

    // Calendar-invalid dates normalized by Date.parse must be rejected
    expect(isValidRfc3339DateTime('2026-02-30T12:00:00Z')).toBe(false);
    expect(isValidRfc3339DateTime('2026-04-31T12:00:00Z')).toBe(false);
    expect(isValidRfc3339DateTime('2026-00-10T12:00:00Z')).toBe(false);
    expect(isValidRfc3339DateTime('2026-13-10T12:00:00Z')).toBe(false);
    expect(isValidRfc3339DateTime('2026-11-00T12:00:00Z')).toBe(false);

    // Leap-year tests
    expect(isValidRfc3339DateTime('2024-02-29T12:00:00Z')).toBe(true); // 2024 is leap year
    expect(isValidRfc3339DateTime('2000-02-29T12:00:00Z')).toBe(true); // 2000 is century leap year
    expect(isValidRfc3339DateTime('2026-02-29T12:00:00Z')).toBe(false); // 2026 is not leap year
    expect(isValidRfc3339DateTime('1900-02-29T12:00:00Z')).toBe(false); // 1900 is not leap year

    // Invalid local time components
    expect(isValidRfc3339DateTime('2026-11-06T24:00:00Z')).toBe(false);
    expect(isValidRfc3339DateTime('2026-11-06T12:60:00Z')).toBe(false);
    expect(isValidRfc3339DateTime('2026-11-06T12:00:60Z')).toBe(false);

    // Invalid offset components
    expect(isValidRfc3339DateTime('2026-11-06T12:00:00+25:00')).toBe(false);
    expect(isValidRfc3339DateTime('2026-11-06T12:00:00+05:60')).toBe(false);

    // Date-only format must be rejected
    expect(isValidRfc3339DateTime('2026-11-06')).toBe(false);
    // Missing timezone must be rejected
    expect(isValidRfc3339DateTime('2026-11-06T12:00:00')).toBe(false);
    expect(isValidRfc3339DateTime('invalid-date')).toBe(false);
    expect(isValidRfc3339DateTime(null)).toBe(false);
  });

  it('validateProblemDetails bounds errors array to 20 and rejects items with extra keys', () => {
    // Generate 25 error items, including some with extra keys and non-objects
    const rawErrors = Array.from({ length: 25 }, (_, i) => {
      if (i === 1) return { path: `field_${i}`, message: `msg_${i}`, extra: 'malicious' };
      if (i === 2) return null;
      return { path: `field_${i}`, message: `msg_${i}` };
    });

    const payload = {
      title: 'Validation Error',
      status: 400,
      errors: rawErrors,
    };

    const sanitized = validateProblemDetails(payload, 400);
    expect(sanitized.errors).toBeDefined();
    // Bounded to at most 20 processed items, and items with extra keys or null filtered out
    expect(sanitized.errors!.length).toBeLessThanOrEqual(20);
    // Item 1 (has extra key) and item 2 (null) must be excluded
    expect(sanitized.errors!.some((e) => e.path === 'field_1')).toBe(false);
    expect(sanitized.errors!.some((e) => e.path === 'field_2')).toBe(false);
    // Item 0 (exact keys) is kept
    expect(sanitized.errors![0]).toEqual({ path: 'field_0', message: 'msg_0' });
    // Items past index 19 were sliced out
    expect(sanitized.errors!.some((e) => e.path === 'field_24')).toBe(false);
  });

  it('validateProblemDetails handles non-objects and mutated prototypes safely', () => {
    const fromProto = validateProblemDetails(Object.create({ mutated: true }), 500);
    expect(fromProto.status).toBe(500);
    expect(fromProto.title).toBe('Request failed');

    const fromNull = validateProblemDetails(null, 503);
    expect(fromNull.status).toBe(503);
  });
});
