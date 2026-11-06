import util from 'node:util';
import { DomainValidationError, parseCorrelationId } from '@affiliate-content-os/domain';
import { ValidationError } from '../errors.js';
import {
  assertExactAllowedKeys,
  extractExactNullableString,
  extractExactString,
  extractExactInteger,
  extractPageLimit,
  extractProductCreateStatus,
  isProxy,
} from './snapshot-property-extractors.js';
import { snapshotFacts, type ValidatedFactInput } from './snapshot-fact-items.js';

export {
  assertExactAllowedKeys,
  extractExactNullableString,
  extractExactString,
  extractExactInteger,
  extractPageLimit,
  extractProductCreateStatus,
  isProxy,
  snapshotFacts,
  type ValidatedFactInput,
};

export interface ValidatedAuditContext {
  readonly ipHash: null;
  readonly userAgentSummary: string | null;
  readonly correlationId: string | null;
}

export interface ValidatedIdempotencyInput {
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
}

const AUDIT_CONTEXT_ALLOWED_KEYS = ['ipHash', 'userAgentSummary', 'correlationId'] as const;
const IDEMPOTENCY_ALLOWED_KEYS = ['keyHash', 'requestHash'] as const;

export function sanitizeUserAgentSummary(ua: unknown): string | null {
  if (typeof ua !== 'string') {
    throw new ValidationError(
      'userAgentSummary must be a string or null',
      'auditContext.userAgentSummary',
    );
  }
  const sanitized = ua.replace(/[^\x20-\x7E]/g, '').trim();
  return sanitized.length === 0 ? null : sanitized.slice(0, 128);
}

export function snapshotAuditContext(raw: unknown): ValidatedAuditContext | undefined {
  if (raw === undefined || raw === null) return undefined;
  const obj = assertExactAllowedKeys(raw, AUDIT_CONTEXT_ALLOWED_KEYS, 'auditContext');

  const ipHashDesc = Object.getOwnPropertyDescriptor(obj, 'ipHash');
  if (ipHashDesc && ipHashDesc.value !== undefined && ipHashDesc.value !== null) {
    if (typeof ipHashDesc.value !== 'string') {
      throw new ValidationError('ipHash must be a string or null', 'auditContext.ipHash');
    }
  }

  let userAgentSummary: string | null = null;
  const uaDesc = Object.getOwnPropertyDescriptor(obj, 'userAgentSummary');
  if (uaDesc && uaDesc.value !== undefined && uaDesc.value !== null) {
    userAgentSummary = sanitizeUserAgentSummary(uaDesc.value);
  }

  let correlationId: string | null = null;
  const corrDesc = Object.getOwnPropertyDescriptor(obj, 'correlationId');
  if (corrDesc && corrDesc.value !== undefined && corrDesc.value !== null) {
    if (typeof corrDesc.value !== 'string') {
      throw new ValidationError(
        'correlationId must be a string or null',
        'auditContext.correlationId',
      );
    }
    const trimmed = corrDesc.value.trim();
    if (trimmed.length > 0) {
      try {
        correlationId = parseCorrelationId(trimmed);
      } catch (err) {
        if (err instanceof DomainValidationError) {
          throw new ValidationError(err.message, 'auditContext.correlationId');
        }
        throw new ValidationError(
          'correlationId must be a valid UUIDv7',
          'auditContext.correlationId',
        );
      }
    }
  }

  return Object.freeze({
    ipHash: null,
    userAgentSummary,
    correlationId,
  });
}

function validateAndCloneIdempotencyHash(
  raw: unknown,
  fieldName: 'keyHash' | 'requestHash',
): Uint8Array {
  if (typeof raw !== 'object' || raw === null || isProxy(raw)) {
    throw new ValidationError(
      `${fieldName} must be a 32-byte binary buffer`,
      `idempotency.${fieldName}`,
    );
  }

  if (!util.types.isUint8Array(raw) && !Buffer.isBuffer(raw)) {
    throw new ValidationError(
      `${fieldName} must be a 32-byte binary buffer`,
      `idempotency.${fieldName}`,
    );
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto !== Uint8Array.prototype && proto !== Buffer.prototype) {
    throw new ValidationError(
      `${fieldName} must be a 32-byte binary buffer`,
      `idempotency.${fieldName}`,
    );
  }

  const byteLengthDesc = Object.getOwnPropertyDescriptor(raw, 'byteLength');
  if (byteLengthDesc !== undefined) {
    throw new ValidationError(
      `${fieldName} must be a 32-byte binary buffer`,
      `idempotency.${fieldName}`,
    );
  }

  if (raw.byteLength !== 32) {
    throw new ValidationError(
      `${fieldName} must be a 32-byte binary buffer`,
      `idempotency.${fieldName}`,
    );
  }

  return new Uint8Array(raw);
}

export function snapshotIdempotencyInput(raw: unknown): ValidatedIdempotencyInput | undefined {
  if (raw === undefined || raw === null) return undefined;
  const obj = assertExactAllowedKeys(raw, IDEMPOTENCY_ALLOWED_KEYS, 'idempotency');

  const keyHashDesc = Object.getOwnPropertyDescriptor(obj, 'keyHash');
  if (!keyHashDesc || keyHashDesc.get !== undefined || keyHashDesc.set !== undefined) {
    throw new ValidationError('keyHash must be a 32-byte binary buffer', 'idempotency.keyHash');
  }
  const keyHash = validateAndCloneIdempotencyHash(keyHashDesc.value, 'keyHash');

  const reqHashDesc = Object.getOwnPropertyDescriptor(obj, 'requestHash');
  if (!reqHashDesc || reqHashDesc.get !== undefined || reqHashDesc.set !== undefined) {
    throw new ValidationError(
      'requestHash must be a 32-byte binary buffer',
      'idempotency.requestHash',
    );
  }
  const requestHash = validateAndCloneIdempotencyHash(reqHashDesc.value, 'requestHash');

  return Object.freeze({
    keyHash,
    requestHash,
  });
}
