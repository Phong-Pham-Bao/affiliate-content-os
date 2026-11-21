import crypto from 'node:crypto';
import {
  dateToIsoTimestamp,
  parseAuditEventId,
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  PublicationApprovalSnapshotNotFoundError,
  PublicationStateConflictError,
  type Publication,
  type PublicationId,
  type SocialPlatform,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type CreatePublicationScheduleParams,
  type ListPublicationsOptions,
  type PaginatedPublications,
  type PublicationDetail,
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
  SQL_FIND_PUBLICATION_BY_ID,
  SQL_INSERT_OUTBOX_EVENT,
  SQL_INSERT_PUBLICATION,
} from './postgres-publication-statements.js';
import {
  mapPublicationRow,
  type PublicationApprovalSnapshotRow,
  type PublicationRow,
} from './postgres-publication-mappers.js';

export async function executeCreatePublicationScheduleTransaction(
  database: Database,
  params: CreatePublicationScheduleParams,
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

    // 3. Lock & check approval snapshot
    const snapshotRes = await tx.query<PublicationApprovalSnapshotRow>(
      `SELECT * FROM publication_approval_snapshots WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.approvalSnapshotId],
    );
    if (snapshotRes.rowCount === 0 || !snapshotRes.rows[0]) {
      throw new PublicationApprovalSnapshotNotFoundError(params.approvalSnapshotId);
    }
    const snapshot = snapshotRes.rows[0];

    // 4. Verify no publication already exists for this snapshot
    const existingPubRes = await tx.query(
      `SELECT id FROM publications WHERE workspace_id = $1 AND approval_snapshot_id = $2`,
      [params.workspaceId, params.approvalSnapshotId],
    );
    if (existingPubRes.rowCount > 0) {
      throw new PublicationStateConflictError(
        'already_scheduled',
        'create_schedule',
        'A publication has already been scheduled for this approval snapshot',
      );
    }

    // 5. Insert publication
    const publicationId = generateUuidV7();
    const insertRes = await tx.query<PublicationRow>(SQL_INSERT_PUBLICATION, [
      publicationId,
      params.workspaceId,
      snapshot.id,
      snapshot.social_account_id,
      snapshot.platform,
      'scheduled',
      params.schedule.scheduledAtUtc,
      params.schedule.originalLocalTime,
      params.schedule.timezone,
      5, // max_attempts
      params.schedule.scheduledAtUtc, // next_attempt_at
      params.actorUserId,
    ]);
    const publication = mapPublicationRow(insertRes.rows[0]!);

    // 6. Insert outbox event
    const outboxId = generateUuidV7();
    await tx.query(SQL_INSERT_OUTBOX_EVENT, [
      outboxId,
      params.workspaceId,
      'publication.scheduled',
      'publication',
      publicationId,
      1,
      JSON.stringify({ publicationId, approvalSnapshotId: snapshot.id, version: 1 }),
      params.schedule.scheduledAtUtc,
    ]);

    // 7. Insert audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: params.workspaceId,
      actorType: 'user',
      actorUserId: params.actorUserId,
      action: 'publication.scheduled',
      resourceType: 'publication',
      resourceId: publicationId,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        status: { before: null, after: 'scheduled' },
        scheduledAtUtc: { before: null, after: params.schedule.scheduledAtUtc },
      },
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
      occurredAt: parseIsoTimestamp(new Date().toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });

    // 8. Save idempotency record
    await insertIdempotencyRecord(tx, {
      id: parseIdempotencyKeyId(generateUuidV7()),
      workspaceId: params.workspaceId,
      principalId: params.actorUserId,
      routeKey: params.idempotency.routeKey,
      keyHash: params.idempotency.keyHash,
      requestHash: params.idempotency.requestHash,
      statusCode: 201,
      responseJson: publication as unknown as Record<string, unknown>,
      resourceType: 'publication',
      resourceId: publicationId,
      expiresAt: parseIsoTimestamp(new Date(Date.now() + 24 * 3600 * 1000).toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });

    return publication;
  });
}

export async function executeFindPublicationById(
  database: Database,
  workspaceId: WorkspaceId,
  publicationId: PublicationId,
): Promise<Publication | null> {
  const result = await database.query<PublicationRow>(SQL_FIND_PUBLICATION_BY_ID, [
    workspaceId,
    publicationId,
  ]);
  if (result.rowCount === 0 || !result.rows[0]) return null;
  return mapPublicationRow(result.rows[0]);
}

export async function executeFindPublicationDetail(
  database: Database,
  workspaceId: WorkspaceId,
  publicationId: PublicationId,
): Promise<PublicationDetail | null> {
  const pubRes = await database.query<PublicationRow>(SQL_FIND_PUBLICATION_BY_ID, [
    workspaceId,
    publicationId,
  ]);
  if (pubRes.rowCount === 0 || !pubRes.rows[0]) return null;
  const pubRow = pubRes.rows[0];

  const destRes = await database.query<{
    platform: SocialPlatform;
    display_name: string;
    handle: string | null;
  }>(
    `SELECT platform, display_name, handle FROM social_accounts WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, pubRow.social_account_id],
  );
  if (destRes.rowCount === 0 || !destRes.rows[0]) return null;
  const destRow = destRes.rows[0];

  const apprRes = await database.query<{
    rendered_text: string;
    preview_hash: Buffer;
    created_at: Date;
    approved_by_user_id: string;
  }>(
    `SELECT rendered_text, preview_hash, created_at, approved_by_user_id FROM publication_approval_snapshots WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, pubRow.approval_snapshot_id],
  );
  if (apprRes.rowCount === 0 || !apprRes.rows[0]) return null;
  const apprRow = apprRes.rows[0];

  const attemptsRes = await database.query<{
    attempt_number: number;
    status: string;
    phase: string;
    started_at: Date;
    completed_at: Date | null;
    outcome_code: string | null;
    outcome_message: string | null;
    remote_post_id: string | null;
  }>(
    `SELECT attempt_number, status, phase, started_at, completed_at, outcome_code, outcome_message, remote_post_id
     FROM publication_attempts
     WHERE workspace_id = $1 AND publication_id = $2
     ORDER BY attempt_number ASC`,
    [workspaceId, publicationId],
  );

  return {
    publication: mapPublicationRow(pubRow),
    destination: {
      platform: destRow.platform,
      displayName: destRow.display_name,
      handle: destRow.handle ?? null,
    },
    approval: {
      renderedText: apprRow.rendered_text,
      previewHashHex: apprRow.preview_hash.toString('hex'),
      approvedAt: dateToIsoTimestamp(new Date(apprRow.created_at)),
      approvedByUserId: apprRow.approved_by_user_id,
    },
    attempts: attemptsRes.rows.map((row) => ({
      attemptNumber: row.attempt_number,
      status: row.status,
      phase: row.phase,
      startedAt: dateToIsoTimestamp(new Date(row.started_at)),
      completedAt: row.completed_at ? dateToIsoTimestamp(new Date(row.completed_at)) : null,
      outcomeCode: row.outcome_code,
      outcomeMessage: row.outcome_message,
      remotePostId: row.remote_post_id,
    })),
  };
}

export async function executeListPublications(
  database: Database,
  workspaceId: WorkspaceId,
  options: ListPublicationsOptions,
): Promise<PaginatedPublications> {
  const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
  const conditions: string[] = ['workspace_id = $1'];
  const values: unknown[] = [workspaceId];
  let paramIdx = 2;

  if (options.status) {
    conditions.push(`status = $${paramIdx++}`);
    values.push(options.status);
  }
  if (options.socialAccountId) {
    conditions.push(`social_account_id = $${paramIdx++}`);
    values.push(options.socialAccountId);
  }
  if (options.platform) {
    conditions.push(`platform = $${paramIdx++}`);
    values.push(options.platform);
  }

  if (options.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
      if (decoded && typeof decoded.createdAt === 'string' && typeof decoded.id === 'string') {
        conditions.push(`(created_at, id) < ($${paramIdx++}, $${paramIdx++})`);
        values.push(decoded.createdAt, decoded.id);
      }
    } catch {
      // Ignore malformed cursor, start from beginning
    }
  }

  values.push(limit + 1);
  const sql = `
    SELECT * FROM publications
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT $${paramIdx}
  `;

  const result = await database.query<PublicationRow>(sql, values);
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const items = rows.map(mapPublicationRow);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = rows[rows.length - 1]!;
    nextCursor = Buffer.from(
      JSON.stringify({ createdAt: new Date(last.created_at).toISOString(), id: last.id }),
    ).toString('base64url');
  }

  return { items, nextCursor };
}
