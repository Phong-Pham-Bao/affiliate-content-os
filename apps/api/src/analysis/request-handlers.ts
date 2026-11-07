import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  enqueueAnalysis,
  AIDisabledError,
  generateUuidV7,
  SystemClock,
  WorkspaceAccessDeniedError,
} from '@affiliate-content-os/application';
import {
  canWorkspaceRole,
  parseAuditEventId,
  parseProductId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import {
  extractIdempotencyKey,
  extractIfMatchVersion,
  validateMutationOrigin,
} from '../catalog/helpers.js';
import type { CatalogRouteDependencies } from '../catalog/types.js';
import { serializeAIPolicy } from './serializers.js';
import type { AnalysisRouteDependencies } from './types.js';

export async function handleEnqueueAnalysis(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);

  const { workspaceId, productId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const prodId = parseProductId(productId);

  const { rawKey } = extractIdempotencyKey(request);
  const body = request.body as {
    readonly analysisType: 'product' | 'niche';
    readonly factSetId: string;
    readonly sourceAnalysisIds?: readonly string[];
  };

  if (!deps.aiModelConfig) {
    throw new AIDisabledError();
  }
  const aiModelConfig = {
    ...deps.aiModelConfig,
    promptTemplate: body.analysisType === 'product' ? 'product_analysis_v1' : 'niche_analysis_v1',
  };

  const result = await enqueueAnalysis(
    {
      workspaceId: wsId,
      productId: prodId,
      analysisType: body.analysisType,
      factSetId: body.factSetId,
      sourceAnalysisIds: body.sourceAnalysisIds,
      idempotencyKey: rawKey,
      actorUserId: authContext.user.id,
    },
    {
      authPort: deps.workspaceAuthorization,
      enqueueTxPort: deps.enqueueTxPort,
      catalogPort: deps.catalogPersistence,
      analysisPort: deps.analysisPersistence,
      aiModelConfig,
      idGenerator: deps.idGenerator,
      clock: deps.clock ?? new SystemClock(),
    },
  );

  return reply.status(202).header('Location', result.location).send({
    operationId: result.operationId,
    location: result.location,
    status: 'queued',
  });
}

export async function handleUpdateAIPolicy(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);

  const { workspaceId } = request.params as { readonly workspaceId: string };
  const wsId = parseWorkspaceId(workspaceId);

  const membership = await deps.workspaceAuthorization.findMembership({
    workspaceId: wsId,
    userId: authContext.user.id,
  });
  if (
    !membership ||
    membership.status !== 'active' ||
    !canWorkspaceRole(membership.role, 'workspace.manage')
  ) {
    throw new WorkspaceAccessDeniedError();
  }

  const body = request.body as {
    readonly aiEnabled: boolean;
    readonly monthlyBudgetMicrounits: number;
    readonly rateLimitPerMinute: number;
    readonly expectedVersion?: number;
  };

  if (!deps.aiPolicyPort?.updatePolicy) {
    throw new Error('AI policy updates not supported by current adapter');
  }

  const expectedVersion = request.headers['if-match']
    ? extractIfMatchVersion(request)
    : body.expectedVersion;
  if (!expectedVersion) {
    extractIfMatchVersion(request);
    return;
  }

  const updated = await deps.aiPolicyPort.updatePolicy({
    workspaceId: wsId,
    aiEnabled: body.aiEnabled,
    monthlyBudgetMicrounits: body.monthlyBudgetMicrounits,
    rateLimitPerMinute: body.rateLimitPerMinute,
    expectedVersion,
    actorUserId: authContext.user.id,
    auditEventId: parseAuditEventId(deps.idGenerator?.generateAuditEventId?.() ?? generateUuidV7()),
  });

  return reply.status(200).send(serializeAIPolicy(updated));
}
