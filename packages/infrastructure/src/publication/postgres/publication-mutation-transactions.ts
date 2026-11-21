import crypto from 'node:crypto';
import {
  canCancelPublication,
  canReschedulePublication,
  dateToIsoTimestamp,
  parseAuditEventId,
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  PublicationNotFoundError,
  PublicationStateConflictError,
  validateScheduleTriple,
  type Publication,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type CancelPublicationParams,
  type ReschedulePublicationParams,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import {
  computeIdempotencyAdvisoryLockKey,
  insertIdempotencyRecord,
} from '../../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../../tenancy/idempotency-row-mapper.js';
import {
  SQL_FIND_LATEST_ATTEMPT_FOR_PUBLICATION,
  SQL_FIND_PUBLICATION_FOR_UPDATE,
  SQL_INSERT_OUTBOX_EVENT,
  SQL_SUPERSEDE_OUTBOX_EVENTS,
  SQL_UPDATE_PUBLICATION_CANCEL,
  SQL_UPDATE_PUBLICATION_RESCHEDULE,
} from './postgres-publication-statements.js';
import {
  mapPublicationRow,
  type PublicationAttemptRow,
  type PublicationRow,
} from './postgres-publication-mappers.js';

export async function executeReschedulePublicationTransaction(
  database: Database,
  params: ReschedulePublicationParams,
): Promise<Publication> {
  return database.withTransaction(async (tx) => {
    // 1. Advisory lock for idempotency key
    const lockKey = computeIdempotencyAdvisoryLockKey(
      params.actorUserId,
      params.idempotency.routeKey,
      params.idempotency.keyHash,
    );
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

    // 2. Check existing idempotency record
    const existingIdemp = await tx.query<RawIdempotencyRow>(
      `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
              status_code, response_json, resource_type, resource_id, expires_at, created_at
       FROM idempotency_keys
       WHERE workspace_id = $1 AND principal_id = $2 AND route_key = $3 AND key_hash = $4
       FOR UPDATE`,
      [
        params.workspaceId,
        params.actorUserId,
        params.idempotency.routeKey,
        Buffer.from(params.idempotency.keyHash),
      ],
    );

    if (existingIdemp.rowCount > 0 && existingIdemp.rows[0]) {
      const row = existingIdemp.rows[0];
      const snapshot = validateAndMapIdempotencyRow(row);
      if (!crypto.timingSafeEqual(snapshot.requestHash, params.idempotency.requestHash)) {
        throw new IdempotencyKeyReusedError();
      }
      return snapshot.responseJson as unknown as Publication;
    }

    // 3. Lock publication FOR UPDATE
    const pubRes = await tx.query<PublicationRow>(SQL_FIND_PUBLICATION_FOR_UPDATE, [
      params.workspaceId,
      params.publicationId,
    ]);
    if (pubRes.rowCount === 0 || !pubRes.rows[0]) {
      throw new PublicationNotFoundError(params.publicationId);
    }
    const pub = pubRes.rows[0];

    // 4. Validate version & status
    if (Number(pub.version) !== params.expectedVersion) {
      throw new PublicationStateConflictError(
        pub.status,
        'reschedule',
        `Expected version ${params.expectedVersion} does not match current version ${pub.version}`,
      );
    }

    if (!canReschedulePublication(pub.status, pub.lease_token !== null)) {
      throw new PublicationStateConflictError(
        pub.status,
        'reschedule',
        `Cannot reschedule publication in status '${pub.status}' or with active lease`,
      );
    }

    // 5. Revalidate schedule triple
    const validSchedule = validateScheduleTriple(params.schedule);

    // 6. Execute reschedule update
    const updateRes = await tx.query<PublicationRow>(SQL_UPDATE_PUBLICATION_RESCHEDULE, [
      validSchedule.scheduledAtUtc,
      validSchedule.originalLocalTime,
      validSchedule.timezone,
      params.workspaceId,
      params.publicationId,
      params.expectedVersion,
    ]);
    if (updateRes.rowCount === 0 || !updateRes.rows[0]) {
      throw new PublicationStateConflictError(
        pub.status,
        'reschedule',
        'Publication reschedule CAS failed due to concurrent modification',
      );
    }
    const publication = mapPublicationRow(updateRes.rows[0]);

    // 7. Supersede old outbox wakeups and insert new outbox event
    await tx.query(SQL_SUPERSEDE_OUTBOX_EVENTS, [params.workspaceId, params.publicationId]);
    const outboxId = generateUuidV7();
    await tx.query(SQL_INSERT_OUTBOX_EVENT, [
      outboxId,
      params.workspaceId,
      'publication.rescheduled',
      'publication',
      params.publicationId,
      publication.version,
      JSON.stringify({
        publicationId: params.publicationId,
        approvalSnapshotId: pub.approval_snapshot_id,
        version: publication.version,
        scheduledAtUtc: validSchedule.scheduledAtUtc,
      }),
      validSchedule.scheduledAtUtc,
    ]);

    // 8. Append audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: params.workspaceId,
      actorType: 'user',
      actorUserId: params.actorUserId,
      action: 'publication.rescheduled',
      resourceType: 'publication',
      resourceId: params.publicationId,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        scheduledAtUtc: {
          before: dateToIsoTimestamp(new Date(pub.scheduled_at_utc)),
          after: validSchedule.scheduledAtUtc,
        },
        version: { before: Number(pub.version), after: publication.version },
      },
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
      occurredAt: parseIsoTimestamp(new Date().toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });

    // 9. Save idempotency record
    await insertIdempotencyRecord(tx, {
      id: parseIdempotencyKeyId(generateUuidV7()),
      workspaceId: params.workspaceId,
      principalId: params.actorUserId,
      routeKey: params.idempotency.routeKey,
      keyHash: params.idempotency.keyHash,
      requestHash: params.idempotency.requestHash,
      statusCode: 200,
      responseJson: publication as unknown as Record<string, unknown>,
      resourceType: 'publication',
      resourceId: params.publicationId,
      expiresAt: parseIsoTimestamp(new Date(Date.now() + 24 * 3600 * 1000).toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });

    return publication;
  });
}

export async function executeCancelPublicationTransaction(
  database: Database,
  params: CancelPublicationParams,
): Promise<Publication> {
  return database.withTransaction(async (tx) => {
    // 1. Advisory lock for idempotency key
    const lockKey = computeIdempotencyAdvisoryLockKey(
      params.actorUserId,
      params.idempotency.routeKey,
      params.idempotency.keyHash,
    );
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

    // 2. Check existing idempotency record
    const existingIdemp = await tx.query<RawIdempotencyRow>(
      `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
              status_code, response_json, resource_type, resource_id, expires_at, created_at
       FROM idempotency_keys
       WHERE workspace_id = $1 AND principal_id = $2 AND route_key = $3 AND key_hash = $4
       FOR UPDATE`,
      [
        params.workspaceId,
        params.actorUserId,
        params.idempotency.routeKey,
        Buffer.from(params.idempotency.keyHash),
      ],
    );

    if (existingIdemp.rowCount > 0 && existingIdemp.rows[0]) {
      const row = existingIdemp.rows[0];
      const snapshot = validateAndMapIdempotencyRow(row);
      if (!crypto.timingSafeEqual(snapshot.requestHash, params.idempotency.requestHash)) {
        throw new IdempotencyKeyReusedError();
      }
      return snapshot.responseJson as unknown as Publication;
    }

    // 3. Lock publication FOR UPDATE
    const pubRes = await tx.query<PublicationRow>(SQL_FIND_PUBLICATION_FOR_UPDATE, [
      params.workspaceId,
      params.publicationId,
    ]);
    if (pubRes.rowCount === 0 || !pubRes.rows[0]) {
      throw new PublicationNotFoundError(params.publicationId);
    }
    const pub = pubRes.rows[0];

    // If already canceled, idempotent re-cancel
    if (pub.status === 'canceled') {
      const existingPublication = mapPublicationRow(pub);
      await insertIdempotencyRecord(tx, {
        id: parseIdempotencyKeyId(generateUuidV7()),
        workspaceId: params.workspaceId,
        principalId: params.actorUserId,
        routeKey: params.idempotency.routeKey,
        keyHash: params.idempotency.keyHash,
        requestHash: params.idempotency.requestHash,
        statusCode: 200,
        responseJson: existingPublication as unknown as Record<string, unknown>,
        resourceType: 'publication',
        resourceId: params.publicationId,
        expiresAt: parseIsoTimestamp(new Date(Date.now() + 24 * 3600 * 1000).toISOString()),
        createdAt: parseIsoTimestamp(new Date().toISOString()),
      });
      return existingPublication;
    }

    // 4. Validate version
    if (Number(pub.version) !== params.expectedVersion) {
      throw new PublicationStateConflictError(
        pub.status,
        'cancel',
        `Expected version ${params.expectedVersion} does not match current version ${pub.version}`,
      );
    }

    // 5. Check latest attempt phase
    const attemptRes = await tx.query<PublicationAttemptRow>(
      SQL_FIND_LATEST_ATTEMPT_FOR_PUBLICATION,
      [params.workspaceId, params.publicationId],
    );
    const latestAttempt = attemptRes.rows[0];

    if (!canCancelPublication(pub.status, latestAttempt?.phase)) {
      throw new PublicationStateConflictError(
        pub.status,
        'cancel',
        `Cannot cancel publication in status '${pub.status}' or after provider attempt started`,
      );
    }

    // 6. Update publication to canceled
    const updateRes = await tx.query<PublicationRow>(SQL_UPDATE_PUBLICATION_CANCEL, [
      params.workspaceId,
      params.publicationId,
      params.expectedVersion,
    ]);
    if (updateRes.rowCount === 0 || !updateRes.rows[0]) {
      throw new PublicationStateConflictError(
        pub.status,
        'cancel',
        'Publication cancellation CAS failed due to concurrent modification',
      );
    }
    const publication = mapPublicationRow(updateRes.rows[0]);

    // 7. Supersede outbox events and insert cancellation outbox event
    await tx.query(SQL_SUPERSEDE_OUTBOX_EVENTS, [params.workspaceId, params.publicationId]);
    const outboxId = generateUuidV7();
    await tx.query(SQL_INSERT_OUTBOX_EVENT, [
      outboxId,
      params.workspaceId,
      'publication.canceled',
      'publication',
      params.publicationId,
      publication.version,
      JSON.stringify({ publicationId: params.publicationId, version: publication.version }),
      new Date().toISOString(),
    ]);

    // 8. Append audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: params.workspaceId,
      actorType: 'user',
      actorUserId: params.actorUserId,
      action: 'publication.canceled',
      resourceType: 'publication',
      resourceId: params.publicationId,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        status: { before: pub.status, after: 'canceled' },
        version: { before: Number(pub.version), after: publication.version },
      },
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
      occurredAt: parseIsoTimestamp(new Date().toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });

    // 9. Save idempotency record
    await insertIdempotencyRecord(tx, {
      id: parseIdempotencyKeyId(generateUuidV7()),
      workspaceId: params.workspaceId,
      principalId: params.actorUserId,
      routeKey: params.idempotency.routeKey,
      keyHash: params.idempotency.keyHash,
      requestHash: params.idempotency.requestHash,
      statusCode: 200,
      responseJson: publication as unknown as Record<string, unknown>,
      resourceType: 'publication',
      resourceId: params.publicationId,
      expiresAt: parseIsoTimestamp(new Date(Date.now() + 24 * 3600 * 1000).toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });

    return publication;
  });
}
