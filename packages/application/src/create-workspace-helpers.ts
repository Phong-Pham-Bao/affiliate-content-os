import util from 'node:util';
import {
  dateToIsoTimestamp,
  parseAuditEventId,
  parseCorrelationId,
  parseIdempotencyKeyId,
  type AuditEventSnapshot,
  type IdempotencyKeyId,
  type IdempotencyRecordSnapshot,
  type IsoTimestamp,
  type UserId,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import { captureAuditEventSnapshot } from './audit/capture-audit-event-snapshot.js';
import { ValidationError } from './errors.js';
import { generateUuidV7 } from './id-generator.js';
import type { IdGeneratorPort } from './ports.js';

export interface CreateWorkspaceAuditContext {
  readonly ipHash?: string | null | undefined;
  readonly userAgentSummary?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
}

export interface CreateWorkspaceIdempotencyInput {
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
}

function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

function validateAndCloneHash(raw: unknown, field: string): Uint8Array {
  if (typeof raw !== 'object' || raw === null || isProxySafe(raw)) {
    throw new ValidationError(`${field} must be a non-proxy binary buffer`, 'idempotency');
  }
  if (!(raw instanceof Uint8Array || Buffer.isBuffer(raw))) {
    throw new ValidationError(`${field} must be a binary buffer`, 'idempotency');
  }
  if (raw.byteLength !== 32) {
    throw new ValidationError(`${field} must be 32 bytes`, 'idempotency');
  }
  return new Uint8Array(raw);
}

export function validateIdempotencyInput(input: unknown): CreateWorkspaceIdempotencyInput {
  if (typeof input !== 'object' || input === null || isProxySafe(input)) {
    throw new ValidationError('idempotency is required', 'idempotency');
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError('idempotency must be a plain object', 'idempotency');
  }
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== 2) {
    throw new ValidationError(
      'idempotency must contain exactly keyHash and requestHash',
      'idempotency',
    );
  }
  const descKey = Object.getOwnPropertyDescriptor(input, 'keyHash');
  if (!descKey || descKey.get !== undefined || descKey.set !== undefined || !descKey.enumerable) {
    throw new ValidationError('Invalid property descriptor for idempotency.keyHash', 'idempotency');
  }
  const descReq = Object.getOwnPropertyDescriptor(input, 'requestHash');
  if (!descReq || descReq.get !== undefined || descReq.set !== undefined || !descReq.enumerable) {
    throw new ValidationError(
      'Invalid property descriptor for idempotency.requestHash',
      'idempotency',
    );
  }

  const keyHash = validateAndCloneHash(descKey.value, 'idempotency.keyHash');
  const requestHash = validateAndCloneHash(descReq.value, 'idempotency.requestHash');

  return Object.freeze({ keyHash, requestHash });
}

export function sanitizeUserAgentSummary(ua: unknown): string | null {
  if (typeof ua !== 'string') {
    return null;
  }
  // Allow printable ASCII characters only: space (0x20) through tilde (0x7E)
  const sanitized = ua.replace(/[^\x20-\x7E]/g, '').trim();
  if (sanitized.length === 0) {
    return null;
  }
  return sanitized.slice(0, 128);
}

export function buildWorkspaceAuditEvent(params: {
  readonly workspace: WorkspaceSnapshot;
  readonly userId: UserId;
  readonly now: IsoTimestamp;
  readonly idGenerator: IdGeneratorPort;
  readonly auditContext?: CreateWorkspaceAuditContext | undefined;
}): AuditEventSnapshot {
  const auditId = params.idGenerator.generateAuditEventId
    ? params.idGenerator.generateAuditEventId()
    : parseAuditEventId(generateUuidV7());

  return captureAuditEventSnapshot({
    id: auditId,
    workspaceId: params.workspace.id,
    actorType: 'user',
    actorUserId: params.userId,
    action: 'workspace.created',
    resourceType: 'workspace',
    resourceId: params.workspace.id,
    result: 'succeeded',
    reasonCode: null,
    changes: {
      status: { before: null, after: 'active' },
      name: { before: null, after: params.workspace.name },
      slug: { before: null, after: params.workspace.slug },
      timezone: { before: null, after: params.workspace.timezone },
    },
    // MEDIUM-1: Do not store unsalted raw IP hash; store null until keyed hash exists
    ipHash: null,
    userAgentSummary: sanitizeUserAgentSummary(params.auditContext?.userAgentSummary),
    correlationId: params.auditContext?.correlationId
      ? parseCorrelationId(params.auditContext.correlationId)
      : null,
    occurredAt: params.now,
    createdAt: params.now,
  });
}

export function buildWorkspaceIdempotencyRecord(params: {
  readonly workspace: WorkspaceSnapshot;
  readonly userId: UserId;
  readonly now: IsoTimestamp;
  readonly clockDate: Date;
  readonly idGenerator: IdGeneratorPort;
  readonly idempotency: CreateWorkspaceIdempotencyInput;
}): IdempotencyRecordSnapshot {
  const idempotencyId: IdempotencyKeyId = params.idGenerator.generateIdempotencyKeyId
    ? params.idGenerator.generateIdempotencyKeyId()
    : parseIdempotencyKeyId(generateUuidV7());

  const expiresAtDate = new Date(params.clockDate.getTime() + 24 * 60 * 60 * 1000);
  const expiresAt = dateToIsoTimestamp(expiresAtDate);

  const responseJson: Readonly<Record<string, unknown>> = Object.freeze({
    id: params.workspace.id,
    name: params.workspace.name,
    slug: params.workspace.slug,
    timezone: params.workspace.timezone,
    brandVoice: params.workspace.brandVoice,
    defaultDisclosure: params.workspace.defaultDisclosure,
    aiEnabled: params.workspace.aiEnabled,
    status: params.workspace.status,
    role: 'owner',
    createdAt: params.workspace.createdAt,
    updatedAt: params.workspace.updatedAt,
    version: params.workspace.version,
  });

  return Object.freeze({
    id: idempotencyId,
    workspaceId: params.workspace.id,
    principalId: params.userId,
    routeKey: 'POST /api/v1/workspaces',
    keyHash: params.idempotency.keyHash,
    requestHash: params.idempotency.requestHash,
    statusCode: 201,
    responseJson,
    resourceType: 'workspace',
    resourceId: params.workspace.id,
    expiresAt,
    createdAt: params.now,
  });
}
