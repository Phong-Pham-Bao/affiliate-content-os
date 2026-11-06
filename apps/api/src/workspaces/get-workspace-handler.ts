import type { FastifyReply, FastifyRequest } from 'fastify';
import { isValidUuidV7, parseWorkspaceId } from '@affiliate-content-os/domain';
import {
  authorizeWorkspaceAction,
  ValidationError,
  WorkspaceAccessDeniedError,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import type { WorkspaceRouteDependencies } from './types.js';

export async function handleGetWorkspace(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkspaceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);

  const { workspaceId } = request.params as {
    readonly workspaceId: string;
  };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }

  const authz = await authorizeWorkspaceAction(
    {
      workspaceId,
      userId: authContext.user.id,
      capability: 'workspace.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const workspace = await deps.workspacePersistence.findWorkspaceByIdForUser({
    workspaceId: parseWorkspaceId(workspaceId),
    userId: authContext.user.id,
  });

  if (!workspace) {
    throw new WorkspaceAccessDeniedError();
  }

  return reply
    .status(200)
    .header('ETag', `"${workspace.version}"`)
    .type('application/json; charset=utf-8')
    .send({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
      brandVoice: workspace.brandVoice,
      defaultDisclosure: workspace.defaultDisclosure,
      aiEnabled: workspace.aiEnabled,
      status: workspace.status,
      role: authz.role,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      version: workspace.version,
    });
}
