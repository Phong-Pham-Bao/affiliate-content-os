import { type AuditEventId, type CorrelationId, type UserId, type WorkspaceId } from './ids.js';
import type { IsoTimestamp } from './timestamps.js';

export const AUDIT_ACTOR_TYPES = ['user', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export const AUDIT_RESULTS = ['succeeded', 'denied', 'failed'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];
export type AuditScalarValue = string | number | boolean | null;
export interface AuditScalarChange {
  readonly before: AuditScalarValue;
  readonly after: AuditScalarValue;
}
export interface AuditEventSnapshot {
  readonly id: AuditEventId;
  readonly workspaceId: WorkspaceId;
  readonly actorType: AuditActorType;
  readonly actorUserId: UserId | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly result: AuditResult;
  readonly reasonCode: string | null;
  readonly changes: Readonly<Record<string, AuditScalarChange>>;
  readonly ipHash: string | null;
  readonly userAgentSummary: string | null;
  readonly correlationId: CorrelationId | null;
  readonly occurredAt: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
}

export function isAuditActorType(value: unknown): value is AuditActorType {
  return value === 'user' || value === 'system';
}
export function isAuditResult(value: unknown): value is AuditResult {
  return value === 'succeeded' || value === 'denied' || value === 'failed';
}
