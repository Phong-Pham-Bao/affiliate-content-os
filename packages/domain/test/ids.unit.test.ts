import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  isValidUuidV7,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
} from '../src/index.js';

describe('Domain Canonical UUIDv7 ID Validation', () => {
  const validV7Variants = [
    '018e3a2b-8a70-7111-8a3b-285b736b4902',
    '018e3a2b-8a70-7111-9a3b-285b736b4902',
    '018e3a2b-8a70-7111-aa3b-285b736b4902',
    '018e3a2b-8a70-7111-ba3b-285b736b4902',
    '0192b012-3456-789a-8bcd-ef0123456789',
  ];

  it.each(validV7Variants)('accepts canonical lowercase UUIDv7: %s', (id) => {
    expect(isValidUuidV7(id)).toBe(true);
    expect(parseUserId(id)).toBe(id);
    expect(parseWorkspaceId(id)).toBe(id);
    expect(parseMembershipId(id)).toBe(id);
  });

  const invalidCandidates: Array<[string, unknown]> = [
    ['uppercase hex characters', '018E3A2B-8A70-7111-9A3B-285B736B4902'],
    ['mixed-case characters', '018e3a2b-8a70-7111-9A3B-285b736b4902'],
    ['UUIDv4 (version digit 4)', '018e3a2b-8a70-4111-9a3b-285b736b4902'],
    ['UUIDv1 (version digit 1)', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
    ['invalid variant bit (c)', '018e3a2b-8a70-7111-ca3b-285b736b4902'],
    ['invalid variant bit (0)', '018e3a2b-8a70-7111-0a3b-285b736b4902'],
    ['whitespace padded', ' 018e3a2b-8a70-7111-9a3b-285b736b4902 '],
    ['missing hyphens', '018e3a2b8a7071119a3b285b736b4902'],
    ['too short', '018e3a2b-8a70-7111-9a3b-285b736b490'],
    ['too long', '018e3a2b-8a70-7111-9a3b-285b736b49020'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['number', 1234567],
    ['object', { id: '018e3a2b-8a70-7111-9a3b-285b736b4902' }],
    ['non-hex character g', '018e3a2b-8a70-7111-9a3b-285b736b490g'],
  ];

  it.each(invalidCandidates)('rejects non-canonical candidate: %s', (_, candidate) => {
    expect(isValidUuidV7(candidate)).toBe(false);

    expect(() => parseUserId(candidate)).toThrow(DomainValidationError);
    expect(() => parseWorkspaceId(candidate)).toThrow(DomainValidationError);
    expect(() => parseMembershipId(candidate)).toThrow(DomainValidationError);
  });
});
