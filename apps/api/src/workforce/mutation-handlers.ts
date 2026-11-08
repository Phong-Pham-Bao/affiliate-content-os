import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  kickoffWorkOrder,
  retryWorkOrderPlanning,
  type WorkforceCatalogQueryPort,
} from '@affiliate-content-os/application';
import { parseProductFactSetId } from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractIdempotencyKey, validateMutationOrigin } from '../catalog/helpers.js';
import type { CatalogRouteDependencies } from '../catalog/types.js';
import type { WorkforceRouteDependencies } from './types.js';

function createCatalogQueryAdapter(deps: WorkforceRouteDependencies): WorkforceCatalogQueryPort {
  return {
    findProductById: (params) => deps.catalogPersistence.findProductById(params),
    findFactSetById: async (params) => {
      const res = await deps.catalogPersistence.findFactSetById({
        workspaceId: params.workspaceId,
        productId: params.productId,
        factSetId: parseProductFactSetId(params.factSetId),
      });
      if (!res) return null;
      return {
        id: res.factSet.id,
        productId: res.factSet.productId,
        workspaceId: res.factSet.workspaceId,
        status: res.factSet.status,
        version: res.factSet.version,
      };
    },
  };
}

export async function handleKickoffWorkOrder(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);

  const { workspaceId, productId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
  };
  const { rawKey } = extractIdempotencyKey(request);

  const body = request.body as {
    readonly missionType: string;
    readonly directiveText: string;
    readonly acceptedAnalysisIds?: readonly string[] | undefined;
    readonly priority?: number | undefined;
  };

  const catalogQuery = createCatalogQueryAdapter(deps);

  const result = await kickoffWorkOrder(
    {
      workspaceId,
      productId,
      missionType: body.missionType,
      directiveText: body.directiveText,
      acceptedAnalysisIds: body.acceptedAnalysisIds,
      priority: body.priority,
      idempotencyKey: rawKey,
      actorUserId: authContext.user.id,
    },
    {
      workforcePersistence: deps.workforcePersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      catalogQuery,
      analysisQuery: deps.analysisPersistence,
      idGenerator: deps.idGenerator,
    },
  );

  return reply.status(201).send(result);
}

export async function handleRetryWorkOrderPlanning(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);

  const { workspaceId, workOrderId } = request.params as {
    readonly workspaceId: string;
    readonly workOrderId: string;
  };

  const catalogQuery = createCatalogQueryAdapter(deps);

  const result = await retryWorkOrderPlanning(
    {
      workspaceId,
      workOrderId,
      actorUserId: authContext.user.id,
    },
    {
      workforcePersistence: deps.workforcePersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      catalogQuery,
      analysisQuery: deps.analysisPersistence,
      idGenerator: deps.idGenerator,
    },
  );

  return reply.status(200).send(result);
}
