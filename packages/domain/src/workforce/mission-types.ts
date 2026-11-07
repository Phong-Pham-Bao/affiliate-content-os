import type { ProductId } from '../catalog/ids.js';
import type { UserId, WorkspaceId } from '../ids.js';
import type { IsoTimestamp } from '../timestamps.js';
import type { ContextPackageId, WorkOrderId } from './ids.js';

export const WORK_ORDER_MISSION_TYPES = [
  'short_video_series',
  'product_launch_plan',
  'objection_handling_series',
  'educational_series',
  'custom',
] as const;

export type WorkOrderMissionType = (typeof WORK_ORDER_MISSION_TYPES)[number];

export function isWorkOrderMissionType(value: unknown): value is WorkOrderMissionType {
  return (
    typeof value === 'string' && (WORK_ORDER_MISSION_TYPES as readonly string[]).includes(value)
  );
}

export const WORK_ORDER_STATUSES = [
  'preparing',
  'in_progress',
  'waiting_review',
  'completed',
  'blocked',
  'failed',
  'canceled',
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return typeof value === 'string' && (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}

export interface WorkOrderSnapshot {
  readonly id: WorkOrderId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly contextPackageId: ContextPackageId;
  readonly missionType: WorkOrderMissionType;
  readonly directiveText: string;
  readonly graphTemplate: string;
  readonly graphVersion: number;
  readonly status: WorkOrderStatus;
  readonly priority: number;
  readonly createdByUserId: UserId;
  readonly failureCategory: string | null;
  readonly completedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}
