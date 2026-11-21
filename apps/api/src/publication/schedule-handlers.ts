import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  cancelPublication,
  reschedulePublication,
  schedulePublication,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import {
  computeCancelPublicationRequestHash,
  computeCreatePublicationScheduleRequestHash,
  computeReschedulePublicationRequestHash,
  extractPublicationIdempotencyKey,
  validatePublicationMutationOrigin,
} from './helpers.js';
import { serializePublication } from './serializers.js';
import type { PublicationRouteDependencies } from './types.js';

export async function handleCreatePublicationSchedule(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PublicationRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validatePublicationMutationOrigin(request, deps);

  const { workspaceId } = request.params as { readonly workspaceId: string };
  const { rawKey, keyHash } = extractPublicationIdempotencyKey(request);

  const body = request.body as {
    readonly approvalSnapshotId: string;
    readonly schedule: {
      readonly scheduledAtUtc: string;
      readonly originalLocalTime: string;
      readonly timezone: string;
    };
  };

  const routeKey = 'POST /api/v1/workspaces/:workspaceId/publications';
  const requestHash = computeCreatePublicationScheduleRequestHash({
    workspaceId,
    approvalSnapshotId: body.approvalSnapshotId,
    schedule: body.schedule,
  });

  const publication = await schedulePublication(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      approvalSnapshotId: body.approvalSnapshotId,
      scheduledAtUtc: body.schedule.scheduledAtUtc,
      originalLocalTime: body.schedule.originalLocalTime,
      timezone: body.schedule.timezone,
      idempotency: {
        rawKey,
        keyHash,
        requestHash,
        routeKey,
      },
    },
    {
      persistence: deps.publicationPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      now: deps.clock ? () => deps.clock!.now() : undefined,
    },
  );

  const dto = serializePublication(publication);
  return reply.status(201).type('application/json; charset=utf-8').send(dto);
}

export async function handleReschedulePublication(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PublicationRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validatePublicationMutationOrigin(request, deps);

  const { workspaceId, publicationId } = request.params as {
    readonly workspaceId: string;
    readonly publicationId: string;
  };
  const { rawKey, keyHash } = extractPublicationIdempotencyKey(request);

  const body = request.body as {
    readonly expectedVersion: number;
    readonly schedule: {
      readonly scheduledAtUtc: string;
      readonly originalLocalTime: string;
      readonly timezone: string;
    };
  };

  const routeKey = 'PATCH /api/v1/workspaces/:workspaceId/publications/:publicationId';
  const requestHash = computeReschedulePublicationRequestHash({
    workspaceId,
    publicationId,
    expectedVersion: body.expectedVersion,
    schedule: body.schedule,
  });

  const publication = await reschedulePublication(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      publicationId,
      expectedVersion: body.expectedVersion,
      scheduledAtUtc: body.schedule.scheduledAtUtc,
      originalLocalTime: body.schedule.originalLocalTime,
      timezone: body.schedule.timezone,
      idempotency: {
        rawKey,
        keyHash,
        requestHash,
        routeKey,
      },
    },
    {
      persistence: deps.publicationPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      now: deps.clock ? () => deps.clock!.now() : undefined,
    },
  );

  const dto = serializePublication(publication);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}

export async function handleCancelPublication(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PublicationRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validatePublicationMutationOrigin(request, deps);

  const { workspaceId, publicationId } = request.params as {
    readonly workspaceId: string;
    readonly publicationId: string;
  };
  const { rawKey, keyHash } = extractPublicationIdempotencyKey(request);

  const body = request.body as {
    readonly expectedVersion: number;
  };

  const routeKey = 'POST /api/v1/workspaces/:workspaceId/publications/:publicationId/cancel';
  const requestHash = computeCancelPublicationRequestHash({
    workspaceId,
    publicationId,
    expectedVersion: body.expectedVersion,
  });

  const publication = await cancelPublication(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      publicationId,
      expectedVersion: body.expectedVersion,
      idempotency: {
        rawKey,
        keyHash,
        requestHash,
        routeKey,
      },
    },
    {
      persistence: deps.publicationPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  const dto = serializePublication(publication);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}
