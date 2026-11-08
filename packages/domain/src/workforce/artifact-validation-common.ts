import { DomainValidationError } from '../errors.js';
import type { ArtifactEvidenceSourceKind } from './artifact-types.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const HTML_TAG_REGEX = /<[^>]+>/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function sanitizeBoundedText(
  value: unknown,
  fieldName: string,
  minLen = 1,
  maxLen = 2000,
): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError(`${fieldName} must be a string`, fieldName);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    throw new DomainValidationError(
      `${fieldName} length must be between ${minLen} and ${maxLen} characters`,
      fieldName,
    );
  }
  if (CONTROL_CHARS_REGEX.test(trimmed)) {
    throw new DomainValidationError(
      `${fieldName} contains forbidden control characters`,
      fieldName,
    );
  }
  if (HTML_TAG_REGEX.test(trimmed)) {
    throw new DomainValidationError(`${fieldName} contains forbidden HTML markup`, fieldName);
  }
  return trimmed;
}

export function validateStringArray(
  raw: unknown,
  fieldName: string,
  minItems = 1,
  maxItems = 10,
  minItemLen = 1,
  maxItemLen = 500,
): readonly string[] {
  if (!Array.isArray(raw)) {
    throw new DomainValidationError(`${fieldName} must be an array`, fieldName);
  }
  if (raw.length < minItems || raw.length > maxItems) {
    throw new DomainValidationError(
      `${fieldName} must contain between ${minItems} and ${maxItems} items`,
      fieldName,
    );
  }
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    result.push(sanitizeBoundedText(raw[i], `${fieldName}[${i}]`, minItemLen, maxItemLen));
  }
  return Object.freeze(result);
}

export interface DomainEvidenceReference {
  readonly sourceKind: ArtifactEvidenceSourceKind;
  readonly sourceId: string;
}

export function validateEvidenceReferenceItem(
  raw: unknown,
  fieldPrefix: string,
): DomainEvidenceReference {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError(`${fieldPrefix} must be an object`, fieldPrefix);
  }
  const obj = raw as Record<string, unknown>;
  const sourceKind = obj.sourceKind;
  if (sourceKind !== 'product_fact' && sourceKind !== 'analysis') {
    throw new DomainValidationError(
      `${fieldPrefix}.sourceKind must be 'product_fact' or 'analysis'`,
      `${fieldPrefix}.sourceKind`,
    );
  }
  const sourceId = obj.sourceId;
  if (typeof sourceId !== 'string' || !isValidUuid(sourceId)) {
    throw new DomainValidationError(
      `${fieldPrefix}.sourceId must be a valid UUID`,
      `${fieldPrefix}.sourceId`,
    );
  }
  return Object.freeze({
    sourceKind,
    sourceId: sourceId.toLowerCase(),
  });
}

export function validateEvidenceReferencesArray(
  raw: unknown,
  fieldName = 'evidenceReferences',
  minItems = 0,
  maxItems = 50,
): readonly DomainEvidenceReference[] {
  if (!Array.isArray(raw)) {
    throw new DomainValidationError(`${fieldName} must be an array`, fieldName);
  }
  if (raw.length < minItems || raw.length > maxItems) {
    throw new DomainValidationError(
      `${fieldName} must contain between ${minItems} and ${maxItems} items`,
      fieldName,
    );
  }
  const seen = new Set<string>();
  const result: DomainEvidenceReference[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = validateEvidenceReferenceItem(raw[i], `${fieldName}[${i}]`);
    const key = `${item.sourceKind}:${item.sourceId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return Object.freeze(result);
}
