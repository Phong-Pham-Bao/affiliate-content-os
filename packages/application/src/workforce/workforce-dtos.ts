import type {
  AgentAssignmentId,
  AgentRoleDefinitionId,
  AgentRoleKey,
  AnalysisId,
  AssignmentOfficeState,
  ContextPackageId,
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

export interface WorkOrderSummaryDTO {
  readonly id: WorkOrderId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly contextPackageId: ContextPackageId;
  readonly missionType: WorkOrderMissionType;
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

export interface WorkItemSummaryDTO {
  readonly id: WorkItemId;
  readonly workOrderId: WorkOrderId;
  readonly roleDefinitionId: AgentRoleDefinitionId;
  readonly roleKey: AgentRoleKey;
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

export interface AgentAssignmentSummaryDTO {
  readonly id: AgentAssignmentId;
  readonly workOrderId: WorkOrderId;
  readonly roleDefinitionId: AgentRoleDefinitionId;
  readonly roleKey: AgentRoleKey;
  readonly workItemId: WorkItemId | null;
  readonly officeState: AssignmentOfficeState;
  readonly waitingOnWorkItemId: WorkItemId | null;
  readonly latestReportCode: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface WorkItemDependencySummaryDTO {
  readonly id: WorkItemDependencyId;
  readonly workOrderId: WorkOrderId;
  readonly workItemId: WorkItemId;
  readonly dependsOnWorkItemId: WorkItemId;
  readonly createdAt: IsoTimestamp;
}

export interface ContextPackageSummaryDTO {
  readonly id: ContextPackageId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly factSetId: string;
  readonly contextSchemaVersion: number;
  readonly contextHashHex: string;
  readonly analysisIds: readonly AnalysisId[];
  readonly createdByUserId: UserId;
  readonly createdAt: IsoTimestamp;
}

export interface WorkOrderDetailDTO {
  readonly workOrder: WorkOrderSummaryDTO;
  readonly contextPackage: ContextPackageSummaryDTO;
  readonly workItems: readonly WorkItemSummaryDTO[];
  readonly assignments: readonly AgentAssignmentSummaryDTO[];
  readonly dependencies: readonly WorkItemDependencySummaryDTO[];
}
