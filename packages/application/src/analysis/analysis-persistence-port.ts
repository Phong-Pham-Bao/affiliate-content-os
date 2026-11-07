import type {
  AIRunId,
  AnalysisId,
  AnalysisSnapshot,
  AnalysisStatus,
  AnalysisType,
  IsoTimestamp,
  ProductFactSetId,
  ProductId,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';

export interface CreateAnalysisSubjectParams {
  readonly subjectType: 'product' | 'fact_set' | 'analysis';
  readonly role: 'primary_subject' | 'grounding_source' | 'input_analysis';
  readonly subjectProductId?: ProductId | null;
  readonly subjectFactSetId?: ProductFactSetId | null;
  readonly subjectAnalysisId?: AnalysisId | null;
}

export interface CreateAnalysisRecordParams {
  readonly id: AnalysisId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly analysisType: AnalysisType;
  readonly revisionNumber?: number | undefined;
  readonly factSetId: ProductFactSetId;
  readonly aiRunId: AIRunId;
  readonly contentJson: unknown;
  readonly schemaVersion: number;
  readonly createdByUserId: UserId;
  readonly subjects: readonly CreateAnalysisSubjectParams[];
}

export interface ListAnalysesFilter {
  readonly productId: ProductId;
  readonly analysisType?: AnalysisType | undefined;
  readonly status?: AnalysisStatus | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface ReviewAnalysisAtomicParams {
  readonly workspaceId: WorkspaceId;
  readonly analysisId: AnalysisId;
  readonly expectedVersion: number;
  readonly decision: 'accepted' | 'rejected';
  readonly reviewedByUserId: UserId;
  readonly reviewedAt: IsoTimestamp;
  readonly reviewReason: string | null;
  readonly auditEvent: {
    readonly id: string;
    readonly workspaceId: WorkspaceId;
    readonly actorUserId: UserId;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly result: 'succeeded';
    readonly changesJson: Record<string, unknown>;
  };
}

export interface AnalysisPersistencePort {
  getAnalysisById(
    workspaceId: WorkspaceId,
    analysisId: AnalysisId,
  ): Promise<AnalysisSnapshot | null>;

  listAnalyses(
    workspaceId: WorkspaceId,
    filter: ListAnalysesFilter,
  ): Promise<PaginatedResult<AnalysisSnapshot>>;

  reviewAnalysisAtomic(params: ReviewAnalysisAtomicParams): Promise<AnalysisSnapshot>;
}
