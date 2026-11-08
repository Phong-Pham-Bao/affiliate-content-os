import type {
  ProductId,
  WorkItemSnapshot,
  WorkOrderId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type { DecodedWorkOrderCursor } from './cursor.js';
import type {
  KickoffWorkOrderAtomicParams,
  KickoffTransactionResult,
  RetryWorkOrderPlanningAtomicParams,
  RetryWorkOrderPlanningResult,
} from './kickoff-params-types.js';
import type {
  ArtifactChangeRequestDTO,
  ContentArtifactDetailDTO,
  ContentArtifactRevisionDTO,
  ContentArtifactSummaryDTO,
  ScriptGenerationUnitDTO,
  WorkOrderActivityDTO,
  WorkOrderDetailDTO,
  WorkOrderSummaryDTO,
} from './workforce-dtos.js';
import type {
  CreateManualRevisionParams,
  RequestScriptChangesParams,
} from './script-params-types.js';

export * from './kickoff-params-types.js';
export * from './script-params-types.js';

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
      readonly productId?: ProductId | undefined;
    },
  ): Promise<readonly WorkOrderSummaryDTO[]>;
  findReadyWorkItems(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkItemSnapshot[]>;
  listWorkOrderArtifacts(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly ContentArtifactSummaryDTO[]>;
  getArtifactById(
    workspaceId: WorkspaceId,
    artifactId: string,
  ): Promise<ContentArtifactDetailDTO | null>;
  getArtifactRevisions(
    workspaceId: WorkspaceId,
    artifactId: string,
  ): Promise<readonly ContentArtifactRevisionDTO[]>;
  getArtifactRevisionByNumber(
    workspaceId: WorkspaceId,
    artifactId: string,
    revisionNumber: number,
  ): Promise<ContentArtifactDetailDTO | null>;
  getChangeRequestById(
    workspaceId: WorkspaceId,
    artifactId: string,
    changeRequestId: string,
  ): Promise<ArtifactChangeRequestDTO | null>;
  createManualRevision(params: CreateManualRevisionParams): Promise<ContentArtifactDetailDTO>;
  requestScriptChanges(params: RequestScriptChangesParams): Promise<ArtifactChangeRequestDTO>;
  listScriptUnits(
    workspaceId: WorkspaceId,
    workOrderId: string,
    changeRequestId?: string | null,
  ): Promise<readonly ScriptGenerationUnitDTO[]>;
  listWorkOrderActivities(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkOrderActivityDTO[]>;
  retryWorkOrderPlanningAtomic(
    params: RetryWorkOrderPlanningAtomicParams,
  ): Promise<RetryWorkOrderPlanningResult>;
}
