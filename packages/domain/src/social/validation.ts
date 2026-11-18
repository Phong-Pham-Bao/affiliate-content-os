import { DomainValidationError } from '../errors.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;
const MAX_BOUNDED_STRING_LEN = 255;
const MAX_URI_LEN = 2048;

export function validateProviderAccountId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_BOUNDED_STRING_LEN ||
    value !== value.trim() ||
    CONTROL_CHARS_REGEX.test(value)
  ) {
    throw new DomainValidationError(
      `Invalid providerAccountId: must be 1-${MAX_BOUNDED_STRING_LEN} chars, trimmed, without control characters`,
    );
  }
  return value;
}

export function validateSocialDisplayName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_BOUNDED_STRING_LEN ||
    value !== value.trim() ||
    CONTROL_CHARS_REGEX.test(value)
  ) {
    throw new DomainValidationError(
      `Invalid displayName: must be 1-${MAX_BOUNDED_STRING_LEN} chars, trimmed, without control characters`,
    );
  }
  return value;
}

export function validateSocialHandle(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_BOUNDED_STRING_LEN ||
    value !== value.trim() ||
    CONTROL_CHARS_REGEX.test(value)
  ) {
    throw new DomainValidationError(
      `Invalid handle: must be 1-${MAX_BOUNDED_STRING_LEN} chars, trimmed, without control characters`,
    );
  }
  return value;
}

export function validateSocialScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new DomainValidationError('Invalid scopes: must be an array of strings');
  }
  const result: string[] = [];
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 128 ||
      item !== item.trim() ||
      CONTROL_CHARS_REGEX.test(item)
    ) {
      throw new DomainValidationError(
        'Invalid scope element: must be 1-128 chars, trimmed, without control characters',
      );
    }
    result.push(item);
  }
  return Object.freeze(result);
}

export function validateSocialCapabilities(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainValidationError('Invalid capabilities: must be an object of boolean flags');
  }
  const result: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (
      typeof k !== 'string' ||
      k.length === 0 ||
      k.length > 64 ||
      k !== k.trim() ||
      CONTROL_CHARS_REGEX.test(k) ||
      typeof v !== 'boolean'
    ) {
      throw new DomainValidationError(
        'Invalid capability entry: key must be 1-64 chars and value must be boolean',
      );
    }
    result[k] = v;
  }
  return Object.freeze(result);
}

export function validateOAuthRedirectUri(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_URI_LEN ||
    value !== value.trim() ||
    CONTROL_CHARS_REGEX.test(value)
  ) {
    throw new DomainValidationError('Invalid redirectUri: must be a valid URL <= 2048 chars');
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new DomainValidationError('Invalid redirectUri: must use http or https protocol');
    }
  } catch (err) {
    if (err instanceof DomainValidationError) throw err;
    throw new DomainValidationError('Invalid redirectUri: must be a parseable URL');
  }
  return value;
}

export function validateOAuthReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_URI_LEN ||
    value !== value.trim() ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    CONTROL_CHARS_REGEX.test(value)
  ) {
    throw new DomainValidationError(
      'Invalid returnTo: must be a relative application path starting with single / and <= 2048 chars',
    );
  }
  return value;
}

export function validateOAuthState(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 256 ||
    value !== value.trim() ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new DomainValidationError(
      'Invalid OAuth state: must be 16-256 base64url characters without whitespace',
    );
  }
  return value;
}
