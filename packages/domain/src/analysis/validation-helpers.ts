import { DomainValidationError } from '../errors.js';
import { assertNoCoercionHooks, assertPlainObject, isProxySafe } from '../catalog/safety.js';
import { parseProductFactId } from '../catalog/ids.js';
import { parseAnalysisId } from './ids.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

export function assertExactPlainObject(
  raw: unknown,
  allowedKeys: readonly string[],
  fieldName: string,
): Record<string, unknown> {
  assertPlainObject(raw, fieldName);

  if (Object.getOwnPropertySymbols(raw).length > 0) {
    throw new DomainValidationError(`${fieldName} must not contain symbol properties`, fieldName);
  }

  const allowedSet = new Set(allowedKeys);
  const ownProps = Object.getOwnPropertyNames(raw);
  for (const prop of ownProps) {
    if (!allowedSet.has(prop)) {
      throw new DomainValidationError(`Unexpected property "${prop}" on ${fieldName}`, fieldName);
    }
    const desc = Object.getOwnPropertyDescriptor(raw, prop);
    if (!desc) {
      throw new DomainValidationError(`Missing descriptor for ${fieldName}.${prop}`, fieldName);
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      throw new DomainValidationError(
        `Accessor properties are prohibited on ${fieldName}.${prop}`,
        fieldName,
      );
    }
    assertNoCoercionHooks(desc.value, `${fieldName}.${prop}`);
  }

  return raw as Record<string, unknown>;
}

export function validateTrimmedString(
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

export function validateOptionalTrimmedString(
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

export function validateArray<T>(
  raw: unknown,
  fieldName: string,
  minItems: number,
  maxItems: number,
  validateItem: (item: unknown, itemIndex: number) => T,
): readonly T[] {
  assertNoCoercionHooks(raw, fieldName);
  if (!Array.isArray(raw) || isProxySafe(raw)) {
    throw new DomainValidationError(`${fieldName} must be an array`, fieldName);
  }
  if (raw.length < minItems) {
    throw new DomainValidationError(
      `${fieldName} must contain at least ${minItems} item(s)`,
      fieldName,
    );
  }
  if (raw.length > maxItems) {
    throw new DomainValidationError(
      `${fieldName} cannot contain more than ${maxItems} items`,
      fieldName,
    );
  }
  return Object.freeze(raw.map((item, idx) => validateItem(item, idx)));
}

export function validateEvidenceFactIds(
  raw: unknown,
  fieldName: string,
): readonly string[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  assertNoCoercionHooks(raw, fieldName);
  if (!Array.isArray(raw) || isProxySafe(raw)) {
    throw new DomainValidationError(`${fieldName} must be an array of fact IDs`, fieldName);
  }
  if (raw.length > 50) {
    throw new DomainValidationError(`${fieldName} cannot exceed 50 fact references`, fieldName);
  }
  const parsed = raw.map((id, idx) => parseProductFactId(id, `${fieldName}[${idx}]`));
  return Object.freeze(Array.from(new Set(parsed)));
}

export function validateSourceAnalysisIds(
  raw: unknown,
  fieldName: string,
): readonly string[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  assertNoCoercionHooks(raw, fieldName);
  if (!Array.isArray(raw) || isProxySafe(raw)) {
    throw new DomainValidationError(`${fieldName} must be an array of analysis IDs`, fieldName);
  }
  if (raw.length > 20) {
    throw new DomainValidationError(`${fieldName} cannot exceed 20 analysis references`, fieldName);
  }
  const parsed = raw.map((id, idx) => parseAnalysisId(id, `${fieldName}[${idx}]`));
  return Object.freeze(Array.from(new Set(parsed)));
}
