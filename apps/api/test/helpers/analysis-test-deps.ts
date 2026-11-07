import {
  DefaultIdGenerator,
  SystemClock,
  type AIRunPersistencePort,
  type AnalysisPersistencePort,
  type EnqueueAnalysisTransactionPort,
  type OperationPersistencePort,
  type WorkspaceAIPolicyPort,
  type WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type AnalysisId,
  type AnalysisSnapshot,
  type OperationId,
  type OperationSnapshot,
  type UserId,
  type WorkspaceAIPolicySnapshot,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceRole,
} from '@affiliate-content-os/domain';
import type { AnalysisRouteDependencies } from '../../src/analysis/types.js';
import { createMockAuthDeps } from './auth-test-fakes.js';
import { InMemoryCatalogPersistence } from './in-memory-catalog-persistence.js';
import { TEST_WORKSPACE_ID, OWNER_USER_ID } from './catalog-test-deps.js';

export function createTestAnalysisDeps(options?: {
  readonly defaultUserId?: UserId;
  readonly defaultRole?: WorkspaceRole;
}): {
  readonly deps: AnalysisRouteDependencies;
  readonly catalogPersistence: InMemoryCatalogPersistence;
  readonly savedAnalyses: Map<string, AnalysisSnapshot>;
  readonly savedOperations: Map<string, OperationSnapshot>;
  readonly policies: Map<string, WorkspaceAIPolicySnapshot>;
} {
  const activeUserId: UserId = options?.defaultUserId ?? OWNER_USER_ID;
  const auth = createMockAuthDeps();
  auth.sessionStore.findCandidateSessions = async () => [
    {
      id: '0192b012-3456-789a-8bcd-ef0123456720',
      userId: activeUserId,
      currentTokenHash: new Uint8Array(32).fill(7),
      previousTokenHash: null,
      previousTokenValidUntil: null,
      createdAt: '2026-11-02T12:00:00.000Z',
      lastSeenAt: '2026-11-02T12:00:00.000Z',
      idleExpiresAt: '2026-11-02T12:30:00.000Z',
      absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
      rotatedAt: '2026-11-02T12:00:00.000Z',
      revokedAt: null,
      revocationReason: null,
      version: 1,
    },
  ];

  const buildUser = (id: UserId) => ({
    id,
    identityProvider: 'https://auth.example.com',
    identitySubject: `sub-${id}`,
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    status: 'active' as const,
    createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    version: 1,
  });

  auth.sessionStore.findUserById = async () => buildUser(activeUserId);
  auth.userDirectory.findUserById = async () => buildUser(activeUserId);

  const catalogPersistence = new InMemoryCatalogPersistence();
  const savedAnalyses = new Map<string, AnalysisSnapshot>();
  const savedOperations = new Map<string, OperationSnapshot>();
  const policies = new Map<string, WorkspaceAIPolicySnapshot>();
  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

  const workspaceAuthorization: WorkspaceAuthorizationPort = {
    async findMembership(params: {
      readonly workspaceId: WorkspaceId;
      readonly userId: UserId;
    }): Promise<WorkspaceMembershipSnapshot | null> {
      if (params.workspaceId !== TEST_WORKSPACE_ID) return null;
      return {
        id: parseMembershipId('0192b012-3456-789a-8bcd-ef0123456730'),
        workspaceId: params.workspaceId,
        userId: params.userId,
        role: options?.defaultRole ?? 'owner',
        status: 'active',
        invitedByUserId: null,
        joinedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
        createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
        version: 1,
      };
    },
  };

  const analysisPersistence: AnalysisPersistencePort = {
    async getAnalysisById(
      workspaceId: WorkspaceId,
      analysisId: AnalysisId,
    ): Promise<AnalysisSnapshot | null> {
      const found = savedAnalyses.get(analysisId);
      return !found || found.workspaceId !== workspaceId ? null : found;
    },
    async listAnalyses(
      workspaceId: WorkspaceId,
      filter: Parameters<AnalysisPersistencePort['listAnalyses']>[1],
    ) {
      const items = Array.from(savedAnalyses.values())
        .filter(
          (a) =>
            a.workspaceId === workspaceId &&
            (!filter.productId || a.productId === filter.productId),
        )
        .filter((a) => !filter.analysisType || a.analysisType === filter.analysisType)
        .filter((a) => !filter.status || a.status === filter.status);
      return { items, page: { nextCursor: null, hasMore: false }, nextCursor: null };
    },
    async reviewAnalysisAtomic(
      params: Parameters<AnalysisPersistencePort['reviewAnalysisAtomic']>[0],
    ): Promise<AnalysisSnapshot> {
      const existing = savedAnalyses.get(params.analysisId);
      if (!existing || existing.workspaceId !== params.workspaceId) {
        const { AnalysisNotFoundError } = await import('@affiliate-content-os/application');
        throw new AnalysisNotFoundError(params.analysisId);
      }
      if (existing.status === params.decision) {
        return existing;
      }
      if (existing.status !== 'generated') {
        const { ReviewConflictError } = await import('@affiliate-content-os/application');
        throw new ReviewConflictError(
          `Cannot change review decision from "${existing.status}" to "${params.decision}"`,
        );
      }
      if (existing.version !== params.expectedVersion) {
        const { ReviewConflictError } = await import('@affiliate-content-os/application');
        throw new ReviewConflictError('Analysis version conflict');
      }
      const updated: AnalysisSnapshot = {
        ...existing,
        status: params.decision === 'accepted' ? 'accepted' : 'rejected',
        reviewReason: params.decision === 'rejected' ? (params.reviewReason ?? null) : null,
        reviewedByUserId: params.reviewedByUserId,
        reviewedAt: params.reviewedAt,
        version: existing.version + 1,
        updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      };
      savedAnalyses.set(params.analysisId, updated);
      return updated;
    },
  };

  const operationPersistence: OperationPersistencePort = {
    async getOperationById(
      workspaceId: WorkspaceId,
      operationId: OperationId,
    ): Promise<OperationSnapshot | null> {
      const op = savedOperations.get(operationId);
      if (!op || op.workspaceId !== workspaceId) return null;
      return op;
    },
  };

  const aiRunPersistence: AIRunPersistencePort = {
    async getAIRunById() {
      return null;
    },
  };

  const enqueueTxPort: EnqueueAnalysisTransactionPort = {
    async enqueueAnalysisAtomic(
      payload: Parameters<EnqueueAnalysisTransactionPort['enqueueAnalysisAtomic']>[0],
    ) {
      const now = parseIsoTimestamp('2026-11-02T12:00:00.000Z');
      const op: OperationSnapshot = {
        id: payload.operation.id,
        workspaceId: payload.operation.workspaceId,
        operationType: payload.operation.operationType,
        resourceType: payload.operation.resourceType,
        resourceId: payload.operation.resourceId,
        status: 'queued',
        progressPercent: null,
        resultLocation: null,
        errorCategory: null,
        errorCode: null,
        errorMessage: null,
        requestedByUserId: payload.operation.requestedByUserId,
        startedAt: null,
        completedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      savedOperations.set(payload.operation.id, op);
      return {
        operationId: payload.operation.id,
        aiRunId: payload.aiRun.id,
        jobId: payload.job.id,
      };
    },
  };

  const aiPolicyPort: WorkspaceAIPolicyPort = {
    async getPolicy(workspaceId: WorkspaceId): Promise<WorkspaceAIPolicySnapshot> {
      const p = parseIsoTimestamp('2026-11-01T00:00:00.000Z');
      return (
        policies.get(workspaceId) ?? {
          workspaceId,
          aiEnabled: true,
          monthlyBudgetMicrounits: 10_000_000,
          currentSpendMicrounits: 0,
          reservedSpendMicrounits: 0,
          rateLimitPerMinute: 60,
          budgetPeriodStart: p,
          minuteWindowStart: p,
          minuteRequestCount: 0,
          updatedAt: p,
          version: 1,
        }
      );
    },
    async updatePolicy(
      params: Parameters<NonNullable<WorkspaceAIPolicyPort['updatePolicy']>>[0],
    ): Promise<WorkspaceAIPolicySnapshot> {
      const existing = await this.getPolicy(params.workspaceId);
      if (existing.version !== params.expectedVersion) {
        const { StaleVersionConflictError } = await import('@affiliate-content-os/application');
        throw new StaleVersionConflictError(params.expectedVersion, existing.version);
      }
      const updated: WorkspaceAIPolicySnapshot = {
        ...existing,
        aiEnabled: params.aiEnabled,
        monthlyBudgetMicrounits: params.monthlyBudgetMicrounits,
        rateLimitPerMinute: params.rateLimitPerMinute,
        version: existing.version + 1,
        updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      };
      policies.set(params.workspaceId, updated);
      return updated;
    },
  };

  const deps: AnalysisRouteDependencies = {
    auth,
    workspaceAuthorization,
    catalogPersistence,
    analysisPersistence,
    aiRunPersistence,
    operationPersistence,
    enqueueTxPort,
    aiPolicyPort,
    aiModelConfig: {
      provider: 'google',
      model: 'gemini-3.8-flash',
      promptTemplate: 'product_analysis_v1',
      promptVersion: '1.0.0',
      inputSchemaVersion: 1,
      outputSchemaVersion: 1,
      estimatedCostMicrounits: 50_000,
    },
    clock,
    idGenerator,
  };

  return { deps, catalogPersistence, savedAnalyses, savedOperations, policies };
}
