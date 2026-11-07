import type { WorkspaceId } from '../ids.js';
import type { IsoTimestamp } from '../timestamps.js';
import type { AgentAssignmentId, AgentRoleDefinitionId, WorkItemId, WorkOrderId } from './ids.js';

export const ASSIGNMENT_OFFICE_STATES = [
  'preparing',
  'queued',
  'running',
  'waiting_dependency',
  'review_required',
  'completed',
  'blocked',
  'failed',
  'canceled',
] as const;

export type AssignmentOfficeState = (typeof ASSIGNMENT_OFFICE_STATES)[number];

export function isAssignmentOfficeState(value: unknown): value is AssignmentOfficeState {
  return (
    typeof value === 'string' && (ASSIGNMENT_OFFICE_STATES as readonly string[]).includes(value)
  );
}

export interface AgentAssignmentSnapshot {
  readonly id: AgentAssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly workOrderId: WorkOrderId;
  readonly roleDefinitionId: AgentRoleDefinitionId;
  readonly workItemId: WorkItemId | null;
  readonly officeState: AssignmentOfficeState;
  readonly waitingOnWorkItemId: WorkItemId | null;
  readonly latestReportCode: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}
