import {
  assertExactAllowedKeys,
  extractExactInteger,
  extractExactNullableString,
  extractExactString,
  extractPageLimit,
  snapshotAuditContext,
  snapshotIdempotencyInput,
  type ValidatedAuditContext,
  type ValidatedIdempotencyInput,
} from './snapshot-utils.js';

const CREATE_AFFILIATE_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'label',
  'url',
  'networkName',
  'idempotency',
  'auditContext',
] as const;

export interface SnappedCreateAffiliateDestinationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly label: string;
  readonly url: string;
  readonly networkName?: string | null | undefined;
  readonly idempotency?: ValidatedIdempotencyInput | undefined;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotCreateAffiliateDestinationCommand(
  raw: unknown,
): SnappedCreateAffiliateDestinationCommand {
  const obj = assertExactAllowedKeys(
    raw,
    CREATE_AFFILIATE_ALLOWED_KEYS,
    'CreateAffiliateDestinationCommand',
  );
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    label: extractExactString(obj, 'label', true)!,
    url: extractExactString(obj, 'url', true)!,
    networkName: extractExactNullableString(obj, 'networkName'),
    idempotency: snapshotIdempotencyInput(obj['idempotency']),
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}

const LIST_AFFILIATE_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'status',
  'limit',
  'cursor',
] as const;

export interface SnappedListAffiliateDestinationsCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly status?: string | undefined;
  readonly limit: number;
  readonly cursor: string | null;
}

export function snapshotListAffiliateDestinationsCommand(
  raw: unknown,
): SnappedListAffiliateDestinationsCommand {
  const obj = assertExactAllowedKeys(
    raw,
    LIST_AFFILIATE_ALLOWED_KEYS,
    'ListAffiliateDestinationsCommand',
  );
  const limit = extractPageLimit(obj, 'limit');
  const cursor = extractExactNullableString(obj, 'cursor') ?? null;
  const rawStatus = extractExactNullableString(obj, 'status');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    status: rawStatus ?? undefined,
    limit,
    cursor,
  });
}

const UPDATE_AFFILIATE_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'destinationId',
  'expectedVersion',
  'label',
  'url',
  'networkName',
  'auditContext',
] as const;

export interface SnappedUpdateAffiliateDestinationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly destinationId: string;
  readonly expectedVersion: number;
  readonly label?: string | undefined;
  readonly url?: string | undefined;
  readonly networkName?: string | null | undefined;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotUpdateAffiliateDestinationCommand(
  raw: unknown,
): SnappedUpdateAffiliateDestinationCommand {
  const obj = assertExactAllowedKeys(
    raw,
    UPDATE_AFFILIATE_ALLOWED_KEYS,
    'UpdateAffiliateDestinationCommand',
  );
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    destinationId: extractExactString(obj, 'destinationId', true)!,
    expectedVersion: extractExactInteger(obj, 'expectedVersion', true)!,
    label: extractExactString(obj, 'label', false),
    url: extractExactString(obj, 'url', false),
    networkName: extractExactNullableString(obj, 'networkName'),
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}

const ARCHIVE_AFFILIATE_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'destinationId',
  'auditContext',
] as const;

export interface SnappedArchiveAffiliateDestinationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly destinationId: string;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotArchiveAffiliateDestinationCommand(
  raw: unknown,
): SnappedArchiveAffiliateDestinationCommand {
  const obj = assertExactAllowedKeys(
    raw,
    ARCHIVE_AFFILIATE_ALLOWED_KEYS,
    'ArchiveAffiliateDestinationCommand',
  );
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    destinationId: extractExactString(obj, 'destinationId', true)!,
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}
