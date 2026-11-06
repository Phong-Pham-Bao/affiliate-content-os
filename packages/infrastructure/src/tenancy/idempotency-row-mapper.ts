import {
  isValidUuidV7,
  parseIdempotencyKeyId,
  parseUserId,
  parseWorkspaceId,
  type IdempotencyRecordSnapshot,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { copyPlainJsonValue, isProxySafe, mapSafeTimestamp } from './idempotency-mapper-helpers.js';

export interface RawIdempotencyRow {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly principal_id: unknown;
  readonly route_key: unknown;
  readonly key_hash: unknown;
  readonly request_hash: unknown;
  readonly status_code: unknown;
  readonly response_json: unknown;
  readonly resource_type: unknown;
  readonly resource_id: unknown;
  readonly expires_at: unknown;
  readonly created_at: unknown;
}

const EXPECTED_COLUMNS = [
  'id',
  'workspace_id',
  'principal_id',
  'route_key',
  'key_hash',
  'request_hash',
  'status_code',
  'response_json',
  'resource_type',
  'resource_id',
  'expires_at',
  'created_at',
] as const;

function validateAndCopyHash(raw: unknown, name: string): Uint8Array {
  if (typeof raw !== 'object' || raw === null || isProxySafe(raw)) {
    throw new DatabaseError(`${name} must be a non-proxy binary buffer`);
  }
  if (!(raw instanceof Uint8Array || Buffer.isBuffer(raw))) {
    throw new DatabaseError(`${name} must be a binary buffer`);
  }
  if (raw.byteLength !== 32) {
    throw new DatabaseError(`${name} must be exactly 32 bytes`);
  }
  return new Uint8Array(raw);
}

export function validateAndMapIdempotencyRow(row: unknown): IdempotencyRecordSnapshot {
  if (typeof row !== 'object' || row === null || isProxySafe(row)) {
    throw new DatabaseError('Invalid idempotency row structure');
  }
  const rowProto = Object.getPrototypeOf(row);
  if (rowProto !== Object.prototype && rowProto !== null) {
    throw new DatabaseError('Invalid idempotency row prototype');
  }

  const ownKeys = Reflect.ownKeys(row);
  if (ownKeys.length !== EXPECTED_COLUMNS.length) {
    throw new DatabaseError('Invalid idempotency row: unexpected key count');
  }

  const values: Record<string, unknown> = {};
  for (const col of EXPECTED_COLUMNS) {
    const desc = Object.getOwnPropertyDescriptor(row, col);
    if (!desc || desc.get !== undefined || desc.set !== undefined || !desc.enumerable) {
      throw new DatabaseError(`Invalid property descriptor for ${col}`);
    }
    values[col] = desc.value;
  }

  const rawId = values['id'];
  if (typeof rawId !== 'string' || !isValidUuidV7(rawId)) {
    throw new DatabaseError('id must be a valid UUIDv7');
  }
  const id = parseIdempotencyKeyId(rawId);

  const rawPrincipalId = values['principal_id'];
  if (typeof rawPrincipalId !== 'string' || !isValidUuidV7(rawPrincipalId)) {
    throw new DatabaseError('principal_id must be a valid UUIDv7');
  }
  const principalId = parseUserId(rawPrincipalId);

  const rawWorkspaceId = values['workspace_id'];
  let workspaceId = null;
  if (rawWorkspaceId !== null && rawWorkspaceId !== undefined) {
    if (typeof rawWorkspaceId !== 'string' || !isValidUuidV7(rawWorkspaceId)) {
      throw new DatabaseError('workspace_id must be null or valid UUIDv7');
    }
    workspaceId = parseWorkspaceId(rawWorkspaceId);
  }

  const rawResourceId = values['resource_id'];
  let resourceId: string | null = null;
  if (rawResourceId !== null && rawResourceId !== undefined) {
    if (typeof rawResourceId !== 'string' || !isValidUuidV7(rawResourceId)) {
      throw new DatabaseError('resource_id must be null or valid UUIDv7');
    }
    resourceId = rawResourceId;
  }

  const rawResourceType = values['resource_type'];
  let resourceType: string | null = null;
  if (rawResourceType !== null && rawResourceType !== undefined) {
    if (
      typeof rawResourceType !== 'string' ||
      rawResourceType.length > 128 ||
      !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(rawResourceType)
    ) {
      throw new DatabaseError('resource_type must be a valid format');
    }
    resourceType = rawResourceType;
  }

  const rawRouteKey = values['route_key'];
  if (
    typeof rawRouteKey !== 'string' ||
    rawRouteKey.length < 1 ||
    rawRouteKey.length > 256 ||
    rawRouteKey !== rawRouteKey.trim() ||
    !/^[\x20-\x7E]+$/.test(rawRouteKey)
  ) {
    throw new DatabaseError('route_key must be a bounded printable string');
  }

  const rawStatusCode = values['status_code'];
  if (
    typeof rawStatusCode !== 'number' ||
    !Number.isInteger(rawStatusCode) ||
    rawStatusCode < 100 ||
    rawStatusCode > 599
  ) {
    throw new DatabaseError('status_code must be an integer between 100 and 599');
  }

  const keyHash = validateAndCopyHash(values['key_hash'], 'key_hash');
  const requestHash = validateAndCopyHash(values['request_hash'], 'request_hash');

  const rawResponseJson = values['response_json'];
  if (
    typeof rawResponseJson !== 'object' ||
    rawResponseJson === null ||
    Array.isArray(rawResponseJson) ||
    isProxySafe(rawResponseJson)
  ) {
    throw new DatabaseError('response_json must be a plain non-null object');
  }
  const responseJson = copyPlainJsonValue(rawResponseJson) as Readonly<Record<string, unknown>>;

  const createdAt = mapSafeTimestamp(values['created_at'], 'created_at');
  const expiresAt = mapSafeTimestamp(values['expires_at'], 'expires_at');
  if (new Date(expiresAt).getTime() <= new Date(createdAt).getTime()) {
    throw new DatabaseError('expires_at must be strictly after created_at');
  }

  return Object.freeze({
    id,
    workspaceId,
    principalId,
    routeKey: rawRouteKey,
    keyHash,
    requestHash,
    statusCode: rawStatusCode,
    responseJson,
    resourceType,
    resourceId,
    expiresAt,
    createdAt,
  });
}
