import { DomainValidationError } from '../errors.js';
import { assertNoCoercionHooks, isProxySafe } from './safety.js';

// Intentional security validation: names and keys must not contain C0 controls or DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;
const FACT_KEY_REGEX = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

function validateTrimmedString(
  raw: unknown,
  fieldName: string,
  minLen: number,
  maxLen: number,
  allowControlChars = false,
): string {
  assertNoCoercionHooks(raw, fieldName);
  if (typeof raw !== 'string' || isProxySafe(raw)) {
    throw new DomainValidationError(`${fieldName} must be a string`, fieldName);
  }
  const trimmed = raw.trim();
  if (trimmed.length < minLen) {
    throw new DomainValidationError(
      `${fieldName} cannot be empty and must have at least ${minLen} character(s)`,
      fieldName,
    );
  }
  if (trimmed.length > maxLen) {
    throw new DomainValidationError(
      `${fieldName} exceeds maximum length of ${maxLen} characters`,
      fieldName,
    );
  }
  if (!allowControlChars && CONTROL_CHARS_REGEX.test(trimmed)) {
    throw new DomainValidationError(`${fieldName} must not contain control characters`, fieldName);
  }
  return trimmed;
}

function validateOptionalTrimmedString(
  raw: unknown,
  fieldName: string,
  maxLen: number,
  allowControlChars = false,
): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  assertNoCoercionHooks(raw, fieldName);
  if (typeof raw !== 'string' || isProxySafe(raw)) {
    throw new DomainValidationError(`${fieldName} must be a string or null`, fieldName);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLen) {
    throw new DomainValidationError(
      `${fieldName} exceeds maximum length of ${maxLen} characters`,
      fieldName,
    );
  }
  if (!allowControlChars && CONTROL_CHARS_REGEX.test(trimmed)) {
    throw new DomainValidationError(`${fieldName} must not contain control characters`, fieldName);
  }
  return trimmed;
}

export function validateProductName(name: unknown): string {
  return validateTrimmedString(name, 'name', 1, 256);
}

export function validateMerchantName(merchantName: unknown): string {
  return validateTrimmedString(merchantName, 'merchantName', 1, 256);
}

export function validateCategory(category: unknown): string {
  return validateTrimmedString(category, 'category', 1, 128);
}

export function validateDescription(description: unknown): string {
  return validateTrimmedString(description, 'description', 1, 10000, true);
}

export function validateAudienceNotes(notes: unknown): string | null {
  return validateOptionalTrimmedString(notes, 'audienceNotes', 5000, true);
}

export function validateAllowedClaimsNotes(notes: unknown): string | null {
  return validateOptionalTrimmedString(notes, 'allowedClaimsNotes', 5000, true);
}

export function validateProhibitedClaimsNotes(notes: unknown): string | null {
  return validateOptionalTrimmedString(notes, 'prohibitedClaimsNotes', 5000, true);
}

export function validateFactKey(key: unknown): string {
  const validated = validateTrimmedString(key, 'factKey', 1, 128);
  if (!FACT_KEY_REGEX.test(validated)) {
    throw new DomainValidationError(
      'factKey must be lowercase alphanumeric separated by single periods, underscores, or hyphens',
      'factKey',
    );
  }
  return validated;
}

export function validateFactValue(value: unknown): string {
  return validateTrimmedString(value, 'valueText', 1, 10000, true);
}

export function validateSourceExcerpt(excerpt: unknown): string | null {
  return validateOptionalTrimmedString(excerpt, 'sourceExcerpt', 2048, true);
}

export function validateFactSetSummary(summary: unknown): string | null {
  return validateOptionalTrimmedString(summary, 'summary', 2048, true);
}

export function validateAffiliateLabel(label: unknown): string {
  return validateTrimmedString(label, 'label', 1, 256);
}

export function validateAffiliateNetworkName(network: unknown): string | null {
  return validateOptionalTrimmedString(network, 'networkName', 128);
}
