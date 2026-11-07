import type { FastifyReply, FastifyRequest } from 'fastify';
import { reviewAnalysis, SystemClock } from '@affiliate-content-os/application';
import { parseAnalysisId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractIfMatchVersion, validateMutationOrigin } from '../catalog/helpers.js';
import type { CatalogRouteDependencies } from '../catalog/types.js';
import { serializeAnalysis } from './serializers.js';
import type { AnalysisRouteDependencies } from './types.js';

function resolveExpectedVersion(request: FastifyRequest): number {
  if (request.headers['if-match']) {
    return extractIfMatchVersion(request);
  }
  const body = request.body as { readonly expectedVersion?: number } | undefined;
  if (
    typeof body?.expectedVersion === 'number' &&
    Number.isSafeInteger(body.expectedVersion) &&
    body.expectedVersion >= 1
  ) {
    return body.expectedVersion;
  }
  // If neither provided, extractIfMatchVersion will throw PreconditionRequiredError
  return extractIfMatchVersion(request);
}

export async function handleAcceptAnalysis(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);

  const { workspaceId, analysisId } = request.params as {
    readonly workspaceId: string;
    readonly analysisId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const anaId = parseAnalysisId(analysisId);
  const expectedVersion = resolveExpectedVersion(request);

  const updated = await reviewAnalysis(
    {
      workspaceId: wsId,
      analysisId: anaId,
      expectedVersion,
      decision: 'accepted',
      actorUserId: authContext.user.id,
    },
    {
      analysisPort: deps.analysisPersistence,
      authPort: deps.workspaceAuthorization,
      clock: deps.clock ?? new SystemClock(),
      idGenerator: deps.idGenerator,
    },
  );

  return reply.status(200).header('ETag', `"${updated.version}"`).send(serializeAnalysis(updated));
}

export async function handleRejectAnalysis(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AnalysisRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateMutationOrigin(request, { auth: deps.auth } as unknown as CatalogRouteDependencies);

  const { workspaceId, analysisId } = request.params as {
    readonly workspaceId: string;
    readonly analysisId: string;
  };
  const wsId = parseWorkspaceId(workspaceId);
  const anaId = parseAnalysisId(analysisId);
  const expectedVersion = resolveExpectedVersion(request);

  const body = request.body as { readonly reason?: string } | undefined;

  const updated = await reviewAnalysis(
    {
      workspaceId: wsId,
      analysisId: anaId,
      expectedVersion,
      decision: 'rejected',
      actorUserId: authContext.user.id,
      reason: body?.reason,
    },
    {
      analysisPort: deps.analysisPersistence,
      authPort: deps.workspaceAuthorization,
      clock: deps.clock ?? new SystemClock(),
      idGenerator: deps.idGenerator,
    },
  );

  return reply.status(200).header('ETag', `"${updated.version}"`).send(serializeAnalysis(updated));
}
