export type AgentRoleKey =
  | 'chief_of_staff'
  | 'product_strategist'
  | 'audience_strategist'
  | 'creative_director'
  | 'scriptwriter'
  | 'compliance_reviewer';

export type WorkOrderStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type WorkItemStatus =
  'waiting_dependency' | 'ready' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type AssignmentOfficeState =
  'idle' | 'preparing' | 'queued' | 'working' | 'completed' | 'failed' | 'waiting';

export type ContentArtifactType =
  | 'product_campaign_plan'
  | 'audience_insight_board'
  | 'video_series_plan'
  | 'script_package'
  | 'compliance_report';

export type WorkOrderMissionType = 'single_product_affiliate_launch';

export interface WorkOrderSummaryDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly productId: string;
  readonly contextPackageId: string;
  readonly missionType: string;
  readonly graphTemplate: string;
  readonly graphVersion: number;
  readonly status: WorkOrderStatus;
  readonly priority: number;
  readonly createdByUserId: string;
  readonly failureCategory: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface WorkItemSummaryDTO {
  readonly id: string;
  readonly workOrderId: string;
  readonly roleDefinitionId: string;
  readonly roleKey: AgentRoleKey;
  readonly taskKey: string;
  readonly expectedArtifactType: string;
  readonly status: WorkItemStatus;
  readonly blockedReasonCode: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AgentAssignmentSummaryDTO {
  readonly id: string;
  readonly workOrderId: string;
  readonly roleDefinitionId: string;
  readonly roleKey: AgentRoleKey;
  readonly workItemId: string | null;
  readonly officeState: AssignmentOfficeState;
  readonly waitingOnWorkItemId: string | null;
  readonly latestReportCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface WorkItemDependencySummaryDTO {
  readonly id: string;
  readonly workOrderId: string;
  readonly workItemId: string;
  readonly dependsOnWorkItemId: string;
  readonly createdAt: string;
}

export interface ContextPackageSummaryDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly productId: string;
  readonly factSetId: string;
  readonly contextSchemaVersion: number;
  readonly contextHashHex: string;
  readonly analysisIds: readonly string[];
  readonly createdByUserId: string;
  readonly createdAt: string;
}

export interface WorkOrderDetailDTO {
  readonly workOrder: WorkOrderSummaryDTO;
  readonly contextPackage: ContextPackageSummaryDTO;
  readonly workItems: readonly WorkItemSummaryDTO[];
  readonly assignments: readonly AgentAssignmentSummaryDTO[];
  readonly dependencies: readonly WorkItemDependencySummaryDTO[];
}

export interface ContentArtifactSummaryDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly workItemId: string;
  readonly assignmentId: string;
  readonly authorRoleKey: AgentRoleKey;
  readonly artifactType: ContentArtifactType;
  readonly lifecycleStatus: string;
  readonly currentRevisionNumber: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ContentArtifactRevisionDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentJson: Record<string, unknown>;
  readonly contentHashHex: string;
  readonly schemaVersion: number;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly tokenInput: number | null;
  readonly tokenOutput: number | null;
  readonly costMicrounits: number | null;
  readonly costCurrency: string | null;
  readonly latencyMs: number | null;
  readonly authorRoleKey: AgentRoleKey;
  readonly createdAt: string;
}

export interface ArtifactEvidenceRefDTO {
  readonly id: string;
  readonly sourceKind: 'product_fact' | 'analysis';
  readonly sourceId: string;
  readonly createdAt: string;
}

export interface ContentArtifactDetailDTO {
  readonly artifact: ContentArtifactSummaryDTO;
  readonly latestRevision: ContentArtifactRevisionDTO;
  readonly evidenceReferences: readonly ArtifactEvidenceRefDTO[];
}

export interface WorkOrderActivityDTO {
  readonly id: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly result: string;
  readonly occurredAt: string;
  readonly changesJson: Record<string, unknown>;
}

export interface KickoffWorkOrderPayload {
  readonly missionType: 'single_product_affiliate_launch';
  readonly directiveText: string;
  readonly acceptedAnalysisIds?: readonly string[];
  readonly priority?: number;
}

export interface KickoffWorkOrderResult {
  readonly workOrder: WorkOrderSummaryDTO;
  readonly cached: boolean;
}

export interface RetryWorkOrderResult {
  readonly workOrder: WorkOrderSummaryDTO;
  readonly retriedItemIds: readonly string[];
  readonly cached: boolean;
}
