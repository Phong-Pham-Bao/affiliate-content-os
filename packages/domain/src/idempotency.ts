import { DomainValidationError } from './errors.js';
import { type IdempotencyKeyId, type UserId, type WorkspaceId } from './ids.js';
import type { IsoTimestamp } from './timestamps.js';

export interface IdempotencyRecordSnapshot {
  readonly id: IdempotencyKeyId;
  readonly workspaceId: WorkspaceId | null;
  readonly principalId: UserId;
  readonly routeKey: string;
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
  readonly statusCode: number;
  readonly responseJson: Readonly<Record<string, unknown>>;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly expiresAt: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
}

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError('Idempotency-Key must be a string', 'idempotencyKey');
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 128 || value !== trimmed) {
    throw new DomainValidationError(
      'Idempotency-Key must be between 1 and 128 characters without leading or trailing whitespace',
      'idempotencyKey',
    );
  }
  if (!/^[!-~]+$/.test(value)) {
    throw new DomainValidationError(
      'Idempotency-Key must contain only printable non-whitespace ASCII characters',
      'idempotencyKey',
    );
  }
  return value;
}
