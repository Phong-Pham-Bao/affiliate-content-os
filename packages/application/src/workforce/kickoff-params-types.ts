import type {
  AgentAssignmentId,
  AgentRoleDefinitionId,
  AnalysisId,
  AssignmentOfficeState,
  AuditEventId,
  ContextPackageId,
  IdempotencyKeyId,
  IsoTimestamp,
  ProductId,
  UserId,
  WorkItemDependencyId,
  WorkItemExpectedArtifactType,
  WorkItemId,
  WorkItemStatus,
  WorkItemTaskKey,
  WorkOrderId,
  WorkOrderMissionType,
  WorkOrderStatus,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type { WorkOrderSummaryDTO } from './workforce-dtos.js';

export interface KickoffAtomicWorkItemParam {
  readonly id: WorkItemId;
  readonly workspaceId: WorkspaceId;
  readonly workOrderId: WorkOrderId;
  readonly roleDefinitionId: AgentRoleDefinitionId;
  readonly taskKey: WorkItemTaskKey;
  readonly expectedArtifactType: WorkItemExpectedArtifactType;
  readonly status: WorkItemStatus;
}

export interface KickoffAtomicAssignmentParam {
  readonly id: AgentAssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly workOrderId: WorkOrderId;
  readonly roleDefinitionId: AgentRoleDefinitionId;
  readonly workItemId: WorkItemId | null;
  readonly officeState: AssignmentOfficeState;
  readonly waitingOnWorkItemId: WorkItemId | null;
}

export interface KickoffAtomicDependencyParam {
  readonly id: WorkItemDependencyId;
  readonly workspaceId: WorkspaceId;
  readonly workOrderId: WorkOrderId;
  readonly workItemId: WorkItemId;
  readonly dependsOnWorkItemId: WorkItemId;
}

export interface KickoffAtomicPlanningJobParam {
  readonly operationId: string;
  readonly aiRunId: string;
  readonly jobId: string;
  readonly outboxId: string;
  readonly workItemId: WorkItemId;
  readonly taskKey: 'product_strategy' | 'audience_strategy' | 'creative_direction';
  readonly roleKey: 'product_strategist' | 'audience_strategist' | 'creative_director';
  readonly promptTemplate: string;
  readonly reservedMicrounits: number;
}

export interface KickoffWorkOrderAtomicParams {
  readonly workOrder: {
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
  };
  readonly contextPackage: {
    readonly id: ContextPackageId;
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
    readonly factSetId: string;
    readonly contextSchemaVersion: number;
    readonly contextHash: Uint8Array;
    readonly createdByUserId: UserId;
    readonly productVersion: number;
    readonly factSetVersion: number;
    readonly sourceAnalyses: readonly {
      readonly id: AnalysisId;
      readonly version: number;
    }[];
  };
  readonly workItems: readonly KickoffAtomicWorkItemParam[];
  readonly assignments: readonly KickoffAtomicAssignmentParam[];
  readonly dependencies: readonly KickoffAtomicDependencyParam[];
  readonly planningJobs: readonly KickoffAtomicPlanningJobParam[];
  readonly totalEstimatedCostMicrounits: number;
  readonly idempotency: {
    readonly id: IdempotencyKeyId;
    readonly keyHash: Uint8Array;
    readonly requestHash: Uint8Array;
    readonly principalId: UserId;
    readonly routeKey: string;
    readonly statusCode: number;
    readonly responseJson: unknown;
    readonly resourceId: WorkOrderId;
    readonly createdAt: IsoTimestamp;
  };
  readonly auditEvent: {
    readonly id: AuditEventId;
    readonly workspaceId: WorkspaceId;
    readonly actorUserId: UserId;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: WorkOrderId;
    readonly changesJson: Record<string, unknown>;
  };
}

export interface KickoffTransactionResult {
  readonly workOrder: WorkOrderSummaryDTO;
  readonly cached: boolean;
}

export interface RetryPlanningItemParam {
  readonly workItemId: WorkItemId;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly jobId: string;
  readonly outboxId: string;
  readonly taskKey: 'product_strategy' | 'audience_strategy' | 'creative_direction';
  readonly roleKey: 'product_strategist' | 'audience_strategist' | 'creative_director';
  readonly promptTemplate: string;
  readonly reservedMicrounits: number;
}

export interface RetryWorkOrderPlanningAtomicParams {
  readonly workspaceId: WorkspaceId;
  readonly workOrderId: WorkOrderId;
  readonly actorUserId: UserId;
  readonly retryItems: readonly RetryPlanningItemParam[];
  readonly totalEstimatedCostMicrounits: number;
  readonly idempotency?: {
    readonly id: IdempotencyKeyId;
    readonly keyHash: Uint8Array;
    readonly requestHash: Uint8Array;
    readonly principalId: UserId;
    readonly routeKey: string;
    readonly statusCode: number;
    readonly responseJson: unknown;
    readonly resourceId: WorkOrderId;
    readonly createdAt: IsoTimestamp;
  };
  readonly auditEvent: {
    readonly id: AuditEventId;
    readonly workspaceId: WorkspaceId;
    readonly actorUserId: UserId;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: WorkOrderId;
    readonly changesJson: Record<string, unknown>;
  };
}

export interface RetryWorkOrderPlanningResult {
  readonly workOrder: WorkOrderSummaryDTO;
  readonly retriedItemIds: readonly WorkItemId[];
  readonly cached: boolean;
}
