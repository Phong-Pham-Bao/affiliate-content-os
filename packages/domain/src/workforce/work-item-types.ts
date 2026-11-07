import type { WorkspaceId } from '../ids.js';
import type { IsoTimestamp } from '../timestamps.js';
import type {
  AgentRoleDefinitionId,
  WorkItemDependencyId,
  WorkItemId,
  WorkOrderId,
} from './ids.js';

export const WORK_ITEM_STATUSES = [
  'ready',
  'waiting_dependency',
  'queued',
  'running',
  'review_required',
  'completed',
  'blocked',
  'failed',
  'canceled',
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export function isWorkItemStatus(value: unknown): value is WorkItemStatus {
  return typeof value === 'string' && (WORK_ITEM_STATUSES as readonly string[]).includes(value);
}

export const WORK_ITEM_TASK_KEYS = [
  'product_strategy',
  'audience_strategy',
  'creative_direction',
  'scriptwriting',
  'compliance_review',
] as const;

export type WorkItemTaskKey = (typeof WORK_ITEM_TASK_KEYS)[number];

export function isWorkItemTaskKey(value: unknown): value is WorkItemTaskKey {
  return typeof value === 'string' && (WORK_ITEM_TASK_KEYS as readonly string[]).includes(value);
}

export const WORK_ITEM_EXPECTED_ARTIFACT_TYPES = [
  'product_campaign_plan',
  'audience_insight_board',
  'video_series_plan',
  'script_package',
  'compliance_report',
] as const;

export type WorkItemExpectedArtifactType = (typeof WORK_ITEM_EXPECTED_ARTIFACT_TYPES)[number];

export function isWorkItemExpectedArtifactType(
  value: unknown,
): value is WorkItemExpectedArtifactType {
  return (
    typeof value === 'string' &&
    (WORK_ITEM_EXPECTED_ARTIFACT_TYPES as readonly string[]).includes(value)
  );
}

export interface WorkItemSnapshot {
  readonly id: WorkItemId;
  readonly workspaceId: WorkspaceId;
  readonly workOrderId: WorkOrderId;
  readonly roleDefinitionId: AgentRoleDefinitionId;
  readonly taskKey: WorkItemTaskKey;
  readonly expectedArtifactType: WorkItemExpectedArtifactType;
  readonly status: WorkItemStatus;
  readonly blockedReasonCode: string | null;
  readonly startedAt: IsoTimestamp | null;
  readonly completedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface WorkItemDependencySnapshot {
  readonly id: WorkItemDependencyId;
  readonly workspaceId: WorkspaceId;
  readonly workOrderId: WorkOrderId;
  readonly workItemId: WorkItemId;
  readonly dependsOnWorkItemId: WorkItemId;
  readonly createdAt: IsoTimestamp;
}
