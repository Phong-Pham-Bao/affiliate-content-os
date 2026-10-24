import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  isMembershipStatus,
  isUserStatus,
  isWorkspaceRole,
  isWorkspaceStatus,
  isValidIanaTimezone,
  MEMBERSHIP_STATUSES,
  normalizeAndValidateSlug,
  normalizeOptionalText,
  normalizeSlug,
  USER_STATUSES,
  validateIanaTimezone,
  validateSlug,
  validateWorkspaceName,
  WORKSPACE_ROLES,
  WORKSPACE_STATUSES,
} from '../src/index.js';

describe('Domain Validation Rules', () => {
  describe('Workspace Name Validation', () => {
    it('accepts valid name and trims whitespace', () => {
      expect(validateWorkspaceName('Acme Corp')).toBe('Acme Corp');
      expect(validateWorkspaceName('  Acme Marketing  ')).toBe('Acme Marketing');
    });

    it('rejects empty or whitespace-only name', () => {
      expect(() => validateWorkspaceName('')).toThrow(DomainValidationError);
      expect(() => validateWorkspaceName('   \t\n  ')).toThrow(DomainValidationError);
    });

    it('rejects non-string name', () => {
      expect(() => validateWorkspaceName(null)).toThrow(DomainValidationError);
      expect(() => validateWorkspaceName(123)).toThrow(DomainValidationError);
      expect(() => validateWorkspaceName({})).toThrow(DomainValidationError);
    });
  });

  describe('Slug Normalization and Validation', () => {
    it('normalizes uppercase letters and surrounding whitespace', () => {
      expect(normalizeSlug('  Acme-Brand-01  ')).toBe('acme-brand-01');
      expect(normalizeAndValidateSlug('  Acme-Brand-01  ')).toBe('acme-brand-01');
    });

    it('accepts canonical lowercase alphanumeric slugs with single hyphens', () => {
      const valid = ['acme', 'acme-corp', 'brand-1-marketing', '123', 'a-b-c-d'];
      for (const slug of valid) {
        expect(validateSlug(slug)).toBe(slug);
        expect(normalizeAndValidateSlug(slug)).toBe(slug);
      }
    });

    const invalidSlugs: Array<[string, string]> = [
      ['repeated hyphens', 'acme--corp'],
      ['triple hyphens', 'acme---corp'],
      ['leading hyphen', '-acme'],
      ['trailing hyphen', 'acme-'],
      ['punctuation underscore', 'acme_corp'],
      ['punctuation period', 'acme.corp'],
      ['punctuation exclamation', 'acme!corp'],
      ['punctuation space in middle', 'acme corp'],
      ['Unicode Cyrillic homoglyph (а)', '\u0430cme-corp'],
      ['Unicode accented characters (é)', 'acmé-corp'],
      ['empty string', ''],
      ['whitespace only', '   '],
    ];

    it.each(invalidSlugs)('rejects %s: %s', (_, candidate) => {
      expect(() => validateSlug(candidate)).toThrow(DomainValidationError);
      expect(() => normalizeAndValidateSlug(candidate)).toThrow(DomainValidationError);
    });

    it('rejects non-string slug values', () => {
      expect(() => normalizeSlug(null)).toThrow(DomainValidationError);
      expect(() => validateSlug(12345)).toThrow(DomainValidationError);
    });
  });

  describe('IANA Timezone Validation', () => {
    const validTimezones = [
      'UTC',
      'Etc/UTC',
      'Asia/Ho_Chi_Minh',
      'America/New_York',
      'Europe/London',
      'Asia/Tokyo',
      'Australia/Sydney',
    ];

    it.each(validTimezones)('accepts canonical IANA timezone: %s', (tz) => {
      expect(isValidIanaTimezone(tz)).toBe(true);
      expect(validateIanaTimezone(tz)).toBe(tz);
    });

    it('trims whitespace around valid timezone', () => {
      expect(validateIanaTimezone('  Asia/Ho_Chi_Minh  ')).toBe('Asia/Ho_Chi_Minh');
      expect(isValidIanaTimezone('  Asia/Ho_Chi_Minh  ')).toBe(true);
    });

    const invalidTimezones: Array<[string, unknown]> = [
      ['3-letter abbreviation EST', 'EST'],
      ['3-letter abbreviation PST', 'PST'],
      ['3-letter abbreviation CST', 'CST'],
      ['Windows name Eastern Standard Time', 'Eastern Standard Time'],
      ['Windows name Pacific Standard Time', 'Pacific Standard Time'],
      ['Windows name SE Asia Standard Time', 'SE Asia Standard Time'],
      ['unknown path Zone/Unknown', 'Zone/Unknown'],
      ['completely fake string', 'NotATimezone'],
      ['empty string', ''],
      ['whitespace only', '   '],
      ['null', null],
      ['undefined', undefined],
      ['number', 123],
    ];

    it.each(invalidTimezones)('rejects non-canonical / platform alias: %s', (_, tz) => {
      expect(isValidIanaTimezone(tz)).toBe(false);
      expect(() => validateIanaTimezone(tz)).toThrow(DomainValidationError);
    });
  });

  describe('Optional Text Normalization', () => {
    it('returns null for undefined, null, empty or whitespace strings', () => {
      expect(normalizeOptionalText(undefined, 'brandVoice')).toBeNull();
      expect(normalizeOptionalText(null, 'brandVoice')).toBeNull();
      expect(normalizeOptionalText('', 'brandVoice')).toBeNull();
      expect(normalizeOptionalText('   \t  ', 'brandVoice')).toBeNull();
    });

    it('returns trimmed string for non-empty text', () => {
      expect(normalizeOptionalText('  Friendly and punchy  ', 'brandVoice')).toBe(
        'Friendly and punchy',
      );
    });

    it('rejects non-string non-null values', () => {
      expect(() => normalizeOptionalText(123, 'brandVoice')).toThrow(DomainValidationError);
      expect(() => normalizeOptionalText({}, 'brandVoice')).toThrow(DomainValidationError);
    });
  });

  describe('Closed Status and Role Sets', () => {
    it('validates UserStatus values', () => {
      expect(USER_STATUSES).toEqual(['active', 'disabled', 'deletion_pending']);
      expect(isUserStatus('active')).toBe(true);
      expect(isUserStatus('disabled')).toBe(true);
      expect(isUserStatus('deletion_pending')).toBe(true);
      expect(isUserStatus('archived')).toBe(false);
      expect(isUserStatus(null)).toBe(false);
    });

    it('validates WorkspaceStatus values', () => {
      expect(WORKSPACE_STATUSES).toEqual(['active', 'suspended', 'deletion_pending']);
      expect(isWorkspaceStatus('active')).toBe(true);
      expect(isWorkspaceStatus('suspended')).toBe(true);
      expect(isWorkspaceStatus('deletion_pending')).toBe(true);
      expect(isWorkspaceStatus('pending')).toBe(false);
    });

    it('validates WorkspaceRole values', () => {
      expect(WORKSPACE_ROLES).toEqual(['owner', 'editor', 'viewer']);
      expect(isWorkspaceRole('owner')).toBe(true);
      expect(isWorkspaceRole('editor')).toBe(true);
      expect(isWorkspaceRole('viewer')).toBe(true);
      expect(isWorkspaceRole('admin')).toBe(false);
    });

    it('validates MembershipStatus values', () => {
      expect(MEMBERSHIP_STATUSES).toEqual(['active', 'suspended', 'removed']);
      expect(isMembershipStatus('active')).toBe(true);
      expect(isMembershipStatus('suspended')).toBe(true);
      expect(isMembershipStatus('removed')).toBe(true);
      expect(isMembershipStatus('invited')).toBe(false);
    });
  });
});
