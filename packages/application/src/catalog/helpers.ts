import {
  type AuditEventSnapshot,
  type AuditScalarChange,
  type IsoTimestamp,
  type ProductId,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import { captureAuditEventSnapshot } from '../audit/capture-audit-event-snapshot.js';
import type { IdGeneratorPort } from '../ports.js';
import {
  getValidClockDate,
  resolveAffiliateDestinationId,
  resolveAuditEventId,
  resolveIdempotencyKeyId,
  resolveProductFactId,
  resolveProductFactSetId,
  resolveProductId,
} from './id-and-clock-helpers.js';
import {
  buildAffiliateCreateIdempotencyRecord,
  buildFactSetCreateIdempotencyRecord,
  buildProductCreateIdempotencyRecord,
} from './idempotency-helpers.js';
import type { ValidatedAuditContext, ValidatedIdempotencyInput } from './snapshot-utils.js';

export {
  buildAffiliateCreateIdempotencyRecord,
  buildFactSetCreateIdempotencyRecord,
  buildProductCreateIdempotencyRecord,
  getValidClockDate,
  resolveAffiliateDestinationId,
  resolveAuditEventId,
  resolveIdempotencyKeyId,
  resolveProductFactId,
  resolveProductFactSetId,
  resolveProductId,
};

export type CatalogAuditContext = ValidatedAuditContext;
export type ProductCreateIdempotencyInput = ValidatedIdempotencyInput;

export function buildProductAuditEvent(params: {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly resourceId: ProductId;
  readonly action: string;
  readonly changes: Record<string, AuditScalarChange>;
  readonly now: IsoTimestamp;
  readonly idGenerator: IdGeneratorPort;
  readonly auditContext?: ValidatedAuditContext | undefined;
}): AuditEventSnapshot {
  const auditId = resolveAuditEventId(params.idGenerator);

  return captureAuditEventSnapshot({
    id: auditId,
    workspaceId: params.workspaceId,
    actorType: 'user',
    actorUserId: params.userId,
    action: params.action,
    resourceType: 'product',
    resourceId: params.resourceId,
    result: 'succeeded',
    reasonCode: null,
    changes: params.changes,
    ipHash: null,
    userAgentSummary: params.auditContext?.userAgentSummary ?? null,
    correlationId: params.auditContext?.correlationId ?? null,
    occurredAt: params.now,
    createdAt: params.now,
  });
}

export function buildFactSetAuditEvent(params: {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly resourceId: string;
  readonly action: string;
  readonly changes: Record<string, AuditScalarChange>;
  readonly now: IsoTimestamp;
  readonly idGenerator: IdGeneratorPort;
  readonly auditContext?: ValidatedAuditContext | undefined;
}): AuditEventSnapshot {
  const auditId = resolveAuditEventId(params.idGenerator);

  return captureAuditEventSnapshot({
    id: auditId,
    workspaceId: params.workspaceId,
    actorType: 'user',
    actorUserId: params.userId,
    action: params.action,
    resourceType: 'product_fact_set',
    resourceId: params.resourceId,
    result: 'succeeded',
    reasonCode: null,
    changes: params.changes,
    ipHash: null,
    userAgentSummary: params.auditContext?.userAgentSummary ?? null,
    correlationId: params.auditContext?.correlationId ?? null,
    occurredAt: params.now,
    createdAt: params.now,
  });
}

export function buildAffiliateAuditEvent(params: {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly resourceId: string;
  readonly action: string;
  readonly changes: Record<string, AuditScalarChange>;
  readonly now: IsoTimestamp;
  readonly idGenerator: IdGeneratorPort;
  readonly auditContext?: ValidatedAuditContext | undefined;
}): AuditEventSnapshot {
  const auditId = resolveAuditEventId(params.idGenerator);

  return captureAuditEventSnapshot({
    id: auditId,
    workspaceId: params.workspaceId,
    actorType: 'user',
    actorUserId: params.userId,
    action: params.action,
    resourceType: 'affiliate_destination',
    resourceId: params.resourceId,
    result: 'succeeded',
    reasonCode: null,
    changes: params.changes,
    ipHash: null,
    userAgentSummary: params.auditContext?.userAgentSummary ?? null,
    correlationId: params.auditContext?.correlationId ?? null,
    occurredAt: params.now,
    createdAt: params.now,
  });
}
