import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeWorkspaceAction,
  createManualRevision,
  getArtifactRevisionByNumber,
  getArtifactRevisions,
  getChangeRequestById,
  requestScriptChanges,
} from '@affiliate-content-os/application';
import { parseUserId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { validateMutationOrigin } from '../catalog/helpers.js';
import type { CatalogRouteDependencies } from '../catalog/types.js';
import type { WorkforceRouteDependencies } from './types.js';

export async function handleGetArtifactRevisions(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, artifactId } = request.params as {
    readonly workspaceId: string;
    readonly artifactId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const actorId = parseUserId(authContext.user.id);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.read' },
    { authorization: deps.workspaceAuthorization },
  );

  const items = await getArtifactRevisions(deps.workforcePersistence, wsId, artifactId);
  return reply.status(200).send({ items });
}

export async function handleGetArtifactRevisionByNumber(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, artifactId, revisionNumber } = request.params as {
    readonly workspaceId: string;
    readonly artifactId: string;
    readonly revisionNumber: number;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const actorId = parseUserId(authContext.user.id);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.read' },
    { authorization: deps.workspaceAuthorization },
  );

  const revision = await getArtifactRevisionByNumber(
    deps.workforcePersistence,
    wsId,
    artifactId,
    Number(revisionNumber),
  );
  if (!revision) {
    return reply.status(404).send({
      type: 'https://affiliate-content-os.example/problems/revision-not-found',
      title: 'Not Found',
      status: 404,
      code: 'REVISION_NOT_FOUND',
      detail: `Revision ${revisionNumber} for artifact ${artifactId} not found`,
    });
  }
  return reply.status(200).send(revision);
}

export async function handleGetChangeRequestById(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, artifactId, changeRequestId } = request.params as {
    readonly workspaceId: string;
    readonly artifactId: string;
    readonly changeRequestId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const actorId = parseUserId(authContext.user.id);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.read' },
    { authorization: deps.workspaceAuthorization },
  );

  const cr = await getChangeRequestById(
    deps.workforcePersistence,
    wsId,
    artifactId,
    changeRequestId,
  );
  if (!cr) {
    return reply.status(404).send({
      type: 'https://affiliate-content-os.example/problems/change-request-not-found',
      title: 'Not Found',
      status: 404,
      code: 'CHANGE_REQUEST_NOT_FOUND',
      detail: `Change request ${changeRequestId} not found`,
    });
  }
  return reply.status(200).send(cr);
}

export async function handleCreateManualRevision(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);
  const { workspaceId, artifactId } = request.params as {
    readonly workspaceId: string;
    readonly artifactId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const actorId = parseUserId(authContext.user.id);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.manage' },
    { authorization: deps.workspaceAuthorization },
  );

  const body = request.body as {
    readonly expectedVersion: number;
    readonly baseRevisionNumber: number;
    readonly baseContentHashHex: string;
    readonly rawContent: unknown;
    readonly note?: string | undefined;
  };

  try {
    const detail = await createManualRevision(deps.workforcePersistence, {
      workspaceId: wsId,
      artifactId,
      actorUserId: actorId,
      expectedVersion: body.expectedVersion,
      baseRevisionNumber: body.baseRevisionNumber,
      baseContentHashHex: body.baseContentHashHex,
      rawContent: body.rawContent,
      note: body.note,
    });
    return reply.status(201).send(detail);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Precondition failed')) {
      return reply.status(409).send({
        type: 'https://affiliate-content-os.example/problems/conflict',
        title: 'Conflict',
        status: 409,
        code: 'VERSION_OR_REVISION_CONFLICT',
        detail: err.message,
      });
    }
    throw err;
  }
}

export async function handleRequestScriptChanges(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);
  const { workspaceId, artifactId } = request.params as {
    readonly workspaceId: string;
    readonly artifactId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const actorId = parseUserId(authContext.user.id);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.manage' },
    { authorization: deps.workspaceAuthorization },
  );

  const body = request.body as {
    readonly expectedVersion: number;
    readonly baseRevisionNumber: number;
    readonly baseContentHashHex: string;
    readonly instructionText: string;
    readonly selectedVideoNumbers: readonly number[];
    readonly targetVariantCount?: number | undefined;
  };

  try {
    const changeRequest = await requestScriptChanges(deps.workforcePersistence, {
      workspaceId: wsId,
      artifactId,
      actorUserId: actorId,
      expectedVersion: body.expectedVersion,
      baseRevisionNumber: body.baseRevisionNumber,
      baseContentHashHex: body.baseContentHashHex,
      instructionText: body.instructionText,
      selectedVideoNumbers: body.selectedVideoNumbers,
      targetVariantCount: body.targetVariantCount,
    });
    return reply.status(202).send(changeRequest);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Precondition failed')) {
      return reply.status(409).send({
        type: 'https://affiliate-content-os.example/problems/conflict',
        title: 'Conflict',
        status: 409,
        code: 'VERSION_OR_REVISION_CONFLICT',
        detail: err.message,
      });
    }
    throw err;
  }
}
