import { DomainValidationError } from './errors.js';

declare const UserIdBrand: unique symbol;
export type UserId = string & { readonly [UserIdBrand]: typeof UserIdBrand };

declare const WorkspaceIdBrand: unique symbol;
export type WorkspaceId = string & { readonly [WorkspaceIdBrand]: typeof WorkspaceIdBrand };

declare const MembershipIdBrand: unique symbol;
export type MembershipId = string & { readonly [MembershipIdBrand]: typeof MembershipIdBrand };

declare const AuditEventIdBrand: unique symbol;
export type AuditEventId = string & { readonly [AuditEventIdBrand]: typeof AuditEventIdBrand };

declare const CorrelationIdBrand: unique symbol;
export type CorrelationId = string & { readonly [CorrelationIdBrand]: typeof CorrelationIdBrand };

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_REGEX.test(value);
}

function assertCanonicalUuidV7(value: unknown, entityName: string): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError(`Invalid ${entityName} ID: must be a string`, 'id');
  }
  if (!UUID_V7_REGEX.test(value)) {
    throw new DomainValidationError(
      `Invalid ${entityName} ID: must be a canonical lowercase UUIDv7 string`,
      'id',
    );
  }
  return value;
}

export function parseUserId(value: unknown): UserId {
  return assertCanonicalUuidV7(value, 'user') as UserId;
}

export function parseWorkspaceId(value: unknown): WorkspaceId {
  return assertCanonicalUuidV7(value, 'workspace') as WorkspaceId;
}

export function parseMembershipId(value: unknown): MembershipId {
  return assertCanonicalUuidV7(value, 'membership') as MembershipId;
}

export function isAuditEventId(value: unknown): value is AuditEventId {
  return isValidUuidV7(value);
}

export function isCorrelationId(value: unknown): value is CorrelationId {
  return isValidUuidV7(value);
}

export function parseAuditEventId(value: unknown): AuditEventId {
  return assertCanonicalUuidV7(value, 'audit event') as AuditEventId;
}

export function parseCorrelationId(value: unknown): CorrelationId {
  return assertCanonicalUuidV7(value, 'correlation') as CorrelationId;
}
