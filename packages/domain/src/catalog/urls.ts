import crypto from 'node:crypto';
import { DomainValidationError } from '../errors.js';
import { isProxySafe } from './safety.js';

// Intentional security validation: URLs must not contain C0 controls or DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;
const MALFORMED_PERCENT_REGEX = /%(?![0-9a-fA-F]{2})/;
const ENCODED_CONTROL_CHARS_REGEX = /%0[0-9a-fA-F]|%1[0-9a-fA-F]|%7[fF]/;

export function validateSafeHttpUrl(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || isProxySafe(raw)) {
    throw new DomainValidationError(`${fieldName} must be a valid URL string`, fieldName);
  }

  if (CONTROL_CHARS_REGEX.test(raw)) {
    throw new DomainValidationError(`${fieldName} must not contain control characters`, fieldName);
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new DomainValidationError(`${fieldName} cannot be empty`, fieldName);
  }
  if (trimmed.length > 2048) {
    throw new DomainValidationError(
      `${fieldName} exceeds maximum length of 2048 characters`,
      fieldName,
    );
  }

  if (MALFORMED_PERCENT_REGEX.test(trimmed)) {
    throw new DomainValidationError(`${fieldName} contains malformed percent-encoding`, fieldName);
  }

  if (ENCODED_CONTROL_CHARS_REGEX.test(trimmed)) {
    throw new DomainValidationError(
      `${fieldName} must not contain encoded control characters`,
      fieldName,
    );
  }

  try {
    decodeURIComponent(trimmed);
  } catch {
    throw new DomainValidationError(
      `${fieldName} contains invalid percent-encoded sequences`,
      fieldName,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new DomainValidationError(`${fieldName} must be a valid absolute URL`, fieldName);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DomainValidationError(`${fieldName} protocol must be http or https`, fieldName);
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new DomainValidationError(
      `${fieldName} must not contain embedded credentials`,
      fieldName,
    );
  }

  if (!parsed.hostname || parsed.hostname.length === 0) {
    throw new DomainValidationError(`${fieldName} must contain a valid host`, fieldName);
  }

  return trimmed;
}

export function normalizeCanonicalProductUrl(raw: unknown): string {
  const validated = validateSafeHttpUrl(raw, 'canonicalUrl');
  const parsed = new URL(validated);

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  parsed.hash = '';

  if (parsed.pathname === '/' && !parsed.search) {
    return parsed.origin;
  }

  return parsed.toString();
}

export function computeCanonicalUrlHash(normalizedUrl: string): Uint8Array {
  const hash = crypto.createHash('sha256').update(normalizedUrl).digest();
  return new Uint8Array(hash);
}

export function redactAffiliateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      parsed.search = '?redacted';
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '[REDACTED_URL]';
  }
}
