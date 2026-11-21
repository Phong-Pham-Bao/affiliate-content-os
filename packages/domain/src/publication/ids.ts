import { isValidUuidV7 } from '../ids.js';
import { DomainValidationError } from '../errors.js';

declare const PublicationApprovalSnapshotIdBrand: unique symbol;
export type PublicationApprovalSnapshotId = string & {
  readonly [PublicationApprovalSnapshotIdBrand]: typeof PublicationApprovalSnapshotIdBrand;
};

declare const PublicationIdBrand: unique symbol;
export type PublicationId = string & {
  readonly [PublicationIdBrand]: typeof PublicationIdBrand;
};

declare const PublicationAttemptIdBrand: unique symbol;
export type PublicationAttemptId = string & {
  readonly [PublicationAttemptIdBrand]: typeof PublicationAttemptIdBrand;
};

export function isPublicationApprovalSnapshotId(
  value: unknown,
): value is PublicationApprovalSnapshotId {
  return typeof value === 'string' && isValidUuidV7(value);
}

export function parsePublicationApprovalSnapshotId(value: unknown): PublicationApprovalSnapshotId {
  if (!isPublicationApprovalSnapshotId(value)) {
    throw new DomainValidationError(
      'Invalid publicationApprovalSnapshotId: must be a valid UUIDv7 string',
    );
  }
  return value;
}

export function isPublicationId(value: unknown): value is PublicationId {
  return typeof value === 'string' && isValidUuidV7(value);
}

export function parsePublicationId(value: unknown): PublicationId {
  if (!isPublicationId(value)) {
    throw new DomainValidationError('Invalid publicationId: must be a valid UUIDv7 string');
  }
  return value;
}

export function isPublicationAttemptId(value: unknown): value is PublicationAttemptId {
  return typeof value === 'string' && isValidUuidV7(value);
}

export function parsePublicationAttemptId(value: unknown): PublicationAttemptId {
  if (!isPublicationAttemptId(value)) {
    throw new DomainValidationError('Invalid publicationAttemptId: must be a valid UUIDv7 string');
  }
  return value;
}
