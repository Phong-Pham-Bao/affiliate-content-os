import { DomainValidationError } from './errors.js';

const SLUG_CANONICAL_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateWorkspaceName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new DomainValidationError('Workspace name must be a string', 'name');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new DomainValidationError('Workspace name cannot be empty', 'name');
  }
  return trimmed;
}

export function normalizeSlug(rawSlug: unknown): string {
  if (typeof rawSlug !== 'string') {
    throw new DomainValidationError('Workspace slug must be a string', 'slug');
  }
  return rawSlug.trim().toLowerCase();
}

export function validateSlug(slug: unknown): string {
  if (typeof slug !== 'string') {
    throw new DomainValidationError('Workspace slug must be a string', 'slug');
  }
  if (!SLUG_CANONICAL_REGEX.test(slug)) {
    throw new DomainValidationError(
      'Workspace slug must consist only of lowercase ASCII letters, digits, and single hyphen-separated segments',
      'slug',
    );
  }
  return slug;
}

export function normalizeAndValidateSlug(rawSlug: unknown): string {
  const normalized = normalizeSlug(rawSlug);
  return validateSlug(normalized);
}

const EXPLICITLY_APPROVED_TIMEZONES: ReadonlySet<string> = new Set([
  'UTC',
  'Etc/UTC',
  'Asia/Ho_Chi_Minh',
]);

const CANONICAL_TIMEZONES: ReadonlySet<string> = new Set([
  ...Intl.supportedValuesOf('timeZone'),
  ...EXPLICITLY_APPROVED_TIMEZONES,
]);

export function isValidIanaTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string') {
    return false;
  }
  const trimmed = tz.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return CANONICAL_TIMEZONES.has(trimmed);
}

export function validateIanaTimezone(tz: unknown): string {
  if (typeof tz !== 'string') {
    throw new DomainValidationError('Timezone must be a string', 'timezone');
  }
  const trimmed = tz.trim();
  if (trimmed.length === 0) {
    throw new DomainValidationError('Timezone cannot be empty', 'timezone');
  }
  if (!CANONICAL_TIMEZONES.has(trimmed)) {
    throw new DomainValidationError(
      `Invalid IANA timezone: ${trimmed}. Must be a canonical IANA timezone identifier (e.g. 'UTC', 'Asia/Ho_Chi_Minh')`,
      'timezone',
    );
  }
  return trimmed;
}

export function normalizeOptionalText(text: unknown, fieldName: string): string | null {
  if (text === undefined || text === null) {
    return null;
  }
  if (typeof text !== 'string') {
    throw new DomainValidationError(`${fieldName} must be a string or null`, fieldName);
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}
