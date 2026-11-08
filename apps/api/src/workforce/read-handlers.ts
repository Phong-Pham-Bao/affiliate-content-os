import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  getArtifactById,
  getWorkOrder,
  listWorkOrderActivities,
  listWorkOrderArtifacts,
  listWorkOrders,
  WorkOrderNotFoundError,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import type { WorkforceRouteDependencies } from './types.js';

export async function handleGetWorkOrder(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, workOrderId } = request.params as {
    readonly workspaceId: string;
    readonly workOrderId: string;
  };

  const workOrder = await getWorkOrder(
    { workspaceId, workOrderId, actorUserId: authContext.user.id },
    {
      workforcePersistence: deps.workforcePersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  if (!workOrder) {
    throw new WorkOrderNotFoundError(workOrderId);
  }

  return reply.status(200).send(workOrder);
}

export async function handleListWorkOrders(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId } = request.params as { readonly workspaceId: string };
  const { cursor, limit } = request.query as {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  };

  const result = await listWorkOrders(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      cursor,
      limit,
    },
    {
      workforcePersistence: deps.workforcePersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  return reply.status(200).send(result);
}

export async function handleListWorkOrderArtifacts(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, workOrderId } = request.params as {
    readonly workspaceId: string;
    readonly workOrderId: string;
  };

  const items = await listWorkOrderArtifacts(
    { workspaceId, workOrderId, actorUserId: authContext.user.id },
    {
      workforcePersistence: deps.workforcePersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  return reply.status(200).send({ items });
}

export async function handleGetArtifactById(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, artifactId } = request.params as {
    readonly workspaceId: string;
    readonly artifactId: string;
  };

  const result = await getArtifactById(
    { workspaceId, artifactId, actorUserId: authContext.user.id },
    {
      workforcePersistence: deps.workforcePersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  if (!result) {
    return reply.status(404).send({
      type: 'https://problems.affiliate-content-os.com/artifact-not-found',
      title: 'Not Found',
      status: 404,
      detail: `Artifact ${artifactId} not found`,
    });
  }

  return reply.status(200).send(result);
}

export async function handleListWorkOrderActivities(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, workOrderId } = request.params as {
    readonly workspaceId: string;
    readonly workOrderId: string;
  };

  const items = await listWorkOrderActivities(
    { workspaceId, workOrderId, actorUserId: authContext.user.id },
    {
      workforcePersistence: deps.workforcePersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  return reply.status(200).send({ items });
}
