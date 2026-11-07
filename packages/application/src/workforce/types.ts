import type { AnalysisId } from '@affiliate-content-os/domain';
import type { ProductId, WorkspaceId } from '@affiliate-content-os/domain';
import type { IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import type { WorkforcePersistencePort } from './ports.js';
import type { WorkOrderSummaryDTO } from './workforce-dtos.js';

export * from './workforce-dtos.js';

export interface KickoffWorkOrderCommand {
  readonly workspaceId: string;
  readonly productId: string;
  readonly missionType: string;
  readonly directiveText: string;
  readonly acceptedAnalysisIds?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly idempotencyKey: string;
  readonly actorUserId: string;
}

export interface KickoffWorkOrderResult {
  readonly workOrder: WorkOrderSummaryDTO;
  readonly replayed: boolean;
}

export interface GetWorkOrderQuery {
  readonly workspaceId: string;
  readonly workOrderId: string;
  readonly actorUserId: string;
}

export interface ListWorkOrdersQuery {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly cursor?: string | null | undefined;
  readonly limit?: number | undefined;
}

export interface ListWorkOrdersResult {
  readonly items: readonly WorkOrderSummaryDTO[];
  readonly nextCursor: string | null;
}

export interface WorkforceCatalogProductInfo {
  readonly id: ProductId;
  readonly workspaceId: WorkspaceId;
  readonly status: string;
  readonly currentFactSetId: string | null;
  readonly version: number;
}

export interface WorkforceCatalogFactSetInfo {
  readonly id: string;
  readonly productId: ProductId;
  readonly workspaceId: WorkspaceId;
  readonly status: string;
  readonly version: number;
}

export interface WorkforceCatalogQueryPort {
  findProductById(params: {
    workspaceId: WorkspaceId;
    productId: ProductId;
  }): Promise<WorkforceCatalogProductInfo | null>;
  findFactSetById(params: {
    workspaceId: WorkspaceId;
    productId: ProductId;
    factSetId: string;
  }): Promise<WorkforceCatalogFactSetInfo | null>;
}

export interface WorkforceAnalysisQueryPort {
  getAnalysisById(
    workspaceId: WorkspaceId,
    analysisId: AnalysisId,
  ): Promise<{
    readonly id: AnalysisId;
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
    readonly status: string;
    readonly version: number;
  } | null>;
}

export interface WorkforceDependencies {
  readonly workforcePersistence: WorkforcePersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly catalogQuery: WorkforceCatalogQueryPort;
  readonly analysisQuery: WorkforceAnalysisQueryPort;
  readonly idGenerator?: IdGeneratorPort | undefined;
}
