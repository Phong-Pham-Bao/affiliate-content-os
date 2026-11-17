import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  acceptScriptRevision,
  authorizeWorkspaceAction,
  getComplianceEvaluation,
  listReviewDecisions,
  rejectScriptRevision,
} from '@affiliate-content-os/application';
import { parseUserId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractIdempotencyKey, validateMutationOrigin } from '../catalog/helpers.js';
import type { CatalogRouteDependencies } from '../catalog/types.js';
import type { WorkforceRouteDependencies } from './types.js';

export async function handleGetArtifactCompliance(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, artifactId } = request.params as {
    readonly workspaceId: string;
    readonly artifactId: string;
  };
  const query = request.query as {
    readonly revisionNumber?: number | undefined;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const actorId = parseUserId(authContext.user.id);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.read' },
    { authorization: deps.workspaceAuthorization },
  );

  const evaluation = await getComplianceEvaluation(
    deps.workforcePersistence,
    wsId,
    artifactId,
    query.revisionNumber !== undefined ? Number(query.revisionNumber) : undefined,
  );

  if (!evaluation) {
    return reply.status(404).send({
      type: 'https://affiliate-content-os.example/problems/compliance-evaluation-not-found',
      title: 'Not Found',
      status: 404,
      code: 'COMPLIANCE_EVALUATION_NOT_FOUND',
      detail: `Compliance evaluation for artifact ${artifactId} not found`,
    });
  }

  return reply.status(200).send(evaluation);
}

export async function handleListArtifactDecisions(
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

  const items = await listReviewDecisions(deps.workforcePersistence, wsId, artifactId);
  return reply.status(200).send({ items });
}

export async function handleAcceptArtifactRevision(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);
  const { rawKey } = extractIdempotencyKey(request);
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
    readonly revisionNumber: number;
    readonly contentHashHex: string;
    readonly note?: string | undefined;
  };

  try {
    const result = await acceptScriptRevision(deps.workforcePersistence, {
      workspaceId: wsId,
      artifactId,
      actorUserId: actorId,
      expectedVersion: body.expectedVersion,
      revisionNumber: body.revisionNumber,
      contentHashHex: body.contentHashHex,
      note: body.note,
      idempotencyKey: rawKey,
    });
    return reply.status(200).send(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes('blocking findings')) {
      return reply.status(422).send({
        type: 'https://affiliate-content-os.example/problems/compliance-blocked',
        title: 'Unprocessable Entity',
        status: 422,
        code: 'COMPLIANCE_BLOCKING_FINDINGS',
        detail: err.message,
      });
    }
    if (err instanceof Error && err.message.includes('Precondition failed')) {
      return reply.status(409).send({
        type: 'https://affiliate-content-os.example/problems/conflict',
        title: 'Conflict',
        status: 409,
        code: 'VERSION_OR_REVISION_CONFLICT',
        detail: err.message,
      });
    }
    if (err instanceof Error && err.message.includes('different payload')) {
      return reply.status(409).send({
        type: 'https://affiliate-content-os.example/problems/conflict',
        title: 'Conflict',
        status: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        detail: err.message,
      });
    }
    if (err instanceof Error && err.message.includes('not found')) {
      return reply.status(404).send({
        type: 'https://affiliate-content-os.example/problems/not-found',
        title: 'Not Found',
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        detail: err.message,
      });
    }
    throw err;
  }
}

export async function handleRejectArtifactRevision(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkforceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);
  const { rawKey } = extractIdempotencyKey(request);
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
    readonly revisionNumber: number;
    readonly contentHashHex: string;
    readonly reason: string;
  };

  try {
    const result = await rejectScriptRevision(deps.workforcePersistence, {
      workspaceId: wsId,
      artifactId,
      actorUserId: actorId,
      expectedVersion: body.expectedVersion,
      revisionNumber: body.revisionNumber,
      contentHashHex: body.contentHashHex,
      reason: body.reason,
      idempotencyKey: rawKey,
    });
    return reply.status(200).send(result);
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
    if (err instanceof Error && err.message.includes('different payload')) {
      return reply.status(409).send({
        type: 'https://affiliate-content-os.example/problems/conflict',
        title: 'Conflict',
        status: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        detail: err.message,
      });
    }
    if (err instanceof Error && err.message.includes('not found')) {
      return reply.status(404).send({
        type: 'https://affiliate-content-os.example/problems/not-found',
        title: 'Not Found',
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        detail: err.message,
      });
    }
    throw err;
  }
}
