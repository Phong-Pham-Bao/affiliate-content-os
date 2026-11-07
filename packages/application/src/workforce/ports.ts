import type {
  AgentAssignmentId,
  AgentRoleDefinitionId,
  AnalysisId,
  AssignmentOfficeState,
  AuditEventId,
  ContextPackageId,
  IdempotencyKeyId,
  ProductId,
  UserId,
  WorkItemDependencyId,
  WorkItemExpectedArtifactType,
  WorkItemId,
  WorkItemSnapshot,
  WorkItemStatus,
  WorkItemTaskKey,
  WorkOrderId,
  WorkOrderMissionType,
  WorkOrderStatus,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type { DecodedWorkOrderCursor } from './cursor.js';
import type { WorkOrderDetailDTO, WorkOrderSummaryDTO } from './workforce-dtos.js';

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
  };
  readonly sourceAnalysisIds: readonly AnalysisId[];
  readonly workItems: readonly KickoffAtomicWorkItemParam[];
  readonly assignments: readonly KickoffAtomicAssignmentParam[];
  readonly dependencies: readonly KickoffAtomicDependencyParam[];
  readonly idempotency: {
    readonly id: IdempotencyKeyId;
    readonly keyHash: Uint8Array;
    readonly requestHash: Uint8Array;
    readonly principalId: UserId;
    readonly routeKey: string;
    readonly statusCode: number;
    readonly responseJson: unknown;
    readonly resourceId: WorkOrderId;
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

export interface WorkforcePersistencePort {
  kickoffWorkOrderAtomic(params: KickoffWorkOrderAtomicParams): Promise<KickoffTransactionResult>;
  getWorkOrderById(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<WorkOrderDetailDTO | null>;
  listWorkOrders(
    workspaceId: WorkspaceId,
    options: {
      readonly cursor?: DecodedWorkOrderCursor | undefined;
      readonly limit: number;
    },
  ): Promise<readonly WorkOrderSummaryDTO[]>;
  findReadyWorkItems(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkItemSnapshot[]>;
}
