import type { WorkItemSnapshot, WorkOrderId, WorkspaceId } from '@affiliate-content-os/domain';
import type { DecodedWorkOrderCursor } from './cursor.js';
import type {
  KickoffWorkOrderAtomicParams,
  KickoffTransactionResult,
  RetryWorkOrderPlanningAtomicParams,
  RetryWorkOrderPlanningResult,
} from './kickoff-params-types.js';
import type {
  ContentArtifactDetailDTO,
  ContentArtifactSummaryDTO,
  WorkOrderActivityDTO,
  WorkOrderDetailDTO,
  WorkOrderSummaryDTO,
} from './workforce-dtos.js';

export * from './kickoff-params-types.js';

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
  listWorkOrderArtifacts(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly ContentArtifactSummaryDTO[]>;
  getArtifactById(
    workspaceId: WorkspaceId,
    artifactId: string,
  ): Promise<ContentArtifactDetailDTO | null>;
  listWorkOrderActivities(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkOrderActivityDTO[]>;
  retryWorkOrderPlanningAtomic(
    params: RetryWorkOrderPlanningAtomicParams,
  ): Promise<RetryWorkOrderPlanningResult>;
}
