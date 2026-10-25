import { describe, expect, it } from 'vitest';
import {
  dateToIsoTimestamp,
  DomainValidationError,
  isValidIsoTimestamp,
  parseIsoTimestamp,
} from '../src/index.js';

describe('Domain Timestamp Parser and Canonical Formatting', () => {
  const validCanonical = '2026-10-25T12:00:00.000Z';

  it('accepts and parses canonical YYYY-MM-DDTHH:mm:ss.sssZ RFC 3339 UTC string', () => {
    expect(isValidIsoTimestamp(validCanonical)).toBe(true);
    const parsed = parseIsoTimestamp(validCanonical);
    expect(parsed).toBe(validCanonical);
    expect(typeof parsed).toBe('string');
  });

  it('converts valid Date object to canonical IsoTimestamp', () => {
    const date = new Date(validCanonical);
    const ts = dateToIsoTimestamp(date);
    expect(ts).toBe(validCanonical);
    expect(isValidIsoTimestamp(ts)).toBe(true);
  });

  it('rejects invalid Date object in dateToIsoTimestamp', () => {
    expect(() => dateToIsoTimestamp(new Date('invalid'))).toThrow(DomainValidationError);
    expect(() => dateToIsoTimestamp(null)).toThrow(DomainValidationError);
    expect(() => dateToIsoTimestamp(validCanonical)).toThrow(DomainValidationError);
  });

  it('verifies exact round-trip through new Date(value).toISOString()', () => {
    const parsed = parseIsoTimestamp(validCanonical);
    expect(new Date(parsed).toISOString()).toBe(parsed);
  });

  it.each([
    ['non-string number', 123456789],
    ['non-string null', null],
    ['non-string undefined', undefined],
    ['non-string object', {}],
    ['non-string Date', new Date(validCanonical)],
    ['missing milliseconds', '2026-10-25T12:00:00Z'],
    ['non-UTC offset +07:00', '2026-10-25T19:00:00.000+07:00'],
    ['non-UTC offset -05:00', '2026-10-25T07:00:00.000-05:00'],
    ['missing Z suffix', '2026-10-25T12:00:00.000'],
    ['date only', '2026-10-25'],
    ['spaces instead of T', '2026-10-25 12:00:00.000Z'],
    ['invalid calendar day Feb 30', '2026-02-30T12:00:00.000Z'],
    ['invalid month 13', '2026-13-25T12:00:00.000Z'],
    ['invalid hour 25', '2026-10-25T25:00:00.000Z'],
    ['invalid characters', '2026-10-25T12:00:00.000Z!'],
  ])('rejects non-canonical / invalid instant: %s', (_, value) => {
    expect(isValidIsoTimestamp(value)).toBe(false);
    expect(() => parseIsoTimestamp(value)).toThrow(DomainValidationError);
  });

  it('proves parsed timestamp is a primitive string and immutable', () => {
    const ts = parseIsoTimestamp(validCanonical);
    expect(typeof ts).toBe('string');
    // Attempting to invoke Date methods must fail since it is a string primitive
    expect((ts as unknown as { setTime?: unknown }).setTime).toBeUndefined();
    expect((ts as unknown as { setFullYear?: unknown }).setFullYear).toBeUndefined();
  });
});
