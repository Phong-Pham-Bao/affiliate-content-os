import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  getAnalysis,
  getOperation,
  listAnalyses,
  AnalysisNotFoundError,
  OperationNotFoundError,
  WorkspaceAccessDeniedError,
} from '@affiliate-content-os/application';
import {
  canWorkspaceRole,
  parseAnalysisId,
  parseOperationId,
  parseProductId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import {
  serializeAIPolicy,
  serializeAnalysis,
  serializeAnalysisSummary,
  serializeOperation,
} from './serializers.js';
import type { AnalysisRouteDependencies } from './types.js';

export async function handleListAnalyses(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, productId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const prodId = parseProductId(productId);

  const query = request.query as {
    readonly type?: 'product' | 'niche' | 'performance';
    readonly status?: 'generated' | 'accepted' | 'rejected';
    readonly cursor?: string;
    readonly limit?: number;
  };

  const result = await listAnalyses(
    {
      workspaceId: wsId,
      productId: prodId,
      analysisType: query.type,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
      actorUserId: authContext.user.id,
    },
    {
      authPort: deps.workspaceAuthorization,
      catalogPort: deps.catalogPersistence,
      analysisPort: deps.analysisPersistence,
    },
  );

  const items = await Promise.all(
    result.items.map(async (analysis) => {
      const [run, factSet] = await Promise.all([
        deps.aiRunPersistence.getAIRunById(wsId, analysis.aiRunId),
        deps.catalogPersistence.findFactSetById({
          workspaceId: wsId,
          productId: analysis.productId,
          factSetId: analysis.factSetId,
        }),
      ]);
      return serializeAnalysisSummary(analysis, run, factSet?.factSet.revisionNumber ?? null);
    }),
  );

  return reply.status(200).send({
    items,
    nextCursor: result.nextCursor,
  });
}

export async function handleGetAnalysis(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, analysisId } = request.params as {
    readonly workspaceId: string;
    readonly analysisId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const anaId = parseAnalysisId(analysisId);

  const analysis = await getAnalysis(
    {
      workspaceId: wsId,
      analysisId: anaId,
      actorUserId: authContext.user.id,
    },
    {
      authPort: deps.workspaceAuthorization,
      analysisPort: deps.analysisPersistence,
    },
  );
  if (!analysis) {
    throw new AnalysisNotFoundError(analysisId);
  }

  const [run, factSet] = await Promise.all([
    deps.aiRunPersistence.getAIRunById(wsId, analysis.aiRunId),
    deps.catalogPersistence.findFactSetById({
      workspaceId: wsId,
      productId: analysis.productId,
      factSetId: analysis.factSetId,
    }),
  ]);

  return reply
    .status(200)
    .header('ETag', `"${analysis.version}"`)
    .send(serializeAnalysis(analysis, run, factSet?.factSet.revisionNumber ?? null));
}

export async function handleGetOperation(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, operationId } = request.params as {
    readonly workspaceId: string;
    readonly operationId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const opId = parseOperationId(operationId);

  const operation = await getOperation(
    {
      workspaceId: wsId,
      operationId: opId,
      actorUserId: authContext.user.id,
    },
    {
      authPort: deps.workspaceAuthorization,
      operationPort: deps.operationPersistence,
    },
  );
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  return reply.status(200).send(serializeOperation(operation));
}

export async function handleGetAIPolicy(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
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
  if (!deps.aiPolicyPort) {
    throw new Error('AI policy reads not supported by current adapter');
  }

  const policy = await deps.aiPolicyPort.getPolicy(wsId);
  return reply.status(200).header('ETag', `"${policy.version}"`).send(serializeAIPolicy(policy));
}
