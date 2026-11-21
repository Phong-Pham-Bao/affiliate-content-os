import crypto from 'node:crypto';
import {
  parseAuditEventId,
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  type PublicationApprovalSnapshot,
  type PublicationApprovalSnapshotId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type CreatePublicationApprovalSnapshotParams,
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
  SQL_FIND_APPROVAL_SNAPSHOT_BY_ID,
  SQL_INSERT_PUBLICATION_APPROVAL_SNAPSHOT,
} from './postgres-publication-statements.js';
import {
  mapPublicationApprovalSnapshotRow,
  type PublicationApprovalSnapshotRow,
} from './postgres-publication-mappers.js';
import { validateAndAssembleApprovalSource } from './publication-approval-validation.js';

export async function executeCreateApprovalSnapshotTransaction(
  database: Database,
  params: CreatePublicationApprovalSnapshotParams,
): Promise<PublicationApprovalSnapshot> {
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
      return snapshot.responseJson as unknown as PublicationApprovalSnapshot;
    }

    // 3. Revalidate source approval, artifact, compliance, social account, and render text
    const validated = await validateAndAssembleApprovalSource(tx, params);

    const snapshotId = generateUuidV7();
    const createdAt = new Date().toISOString();

    // 4. Insert publication_approval_snapshots
    const insertRes = await tx.query<PublicationApprovalSnapshotRow>(
      SQL_INSERT_PUBLICATION_APPROVAL_SNAPSHOT,
      [
        snapshotId,
        params.workspaceId,
        validated.sourceApproval.id,
        validated.sourceApproval.snapshot_hash,
        validated.sourceApproval.artifact_id,
        validated.sourceApproval.revision_number,
        validated.sourceApproval.content_hash,
        validated.socialAccount.platform,
        validated.socialAccount.id,
        validated.socialAccount.provider_account_id,
        Number(validated.socialAccount.version),
        Buffer.from(validated.capabilityFingerprint),
        JSON.stringify(validated.caps),
        validated.socialAccount.capabilities_checked_at ?? new Date(),
        validated.renderedText,
        Buffer.from(validated.previewHash),
        JSON.stringify(
          validated.explicitDisclosure ? { explicit: validated.explicitDisclosure } : {},
        ),
        JSON.stringify(params.platformSettings),
        params.actorUserId,
        params.consent.consentType,
        params.consent.policyVersion,
        validated.sourceApproval.policy_hash,
        JSON.stringify(validated.snapshotPayload),
        Buffer.from(validated.snapshotHash),
        createdAt,
      ],
    );

    const snapshotEntity = mapPublicationApprovalSnapshotRow(insertRes.rows[0]!);

    // 5. Save idempotency record
    await insertIdempotencyRecord(tx, {
      id: parseIdempotencyKeyId(generateUuidV7()),
      workspaceId: params.workspaceId,
      principalId: params.actorUserId,
      routeKey: params.idempotency.routeKey,
      keyHash: params.idempotency.keyHash,
      requestHash: params.idempotency.requestHash,
      statusCode: 201,
      responseJson: snapshotEntity as unknown as Record<string, unknown>,
      resourceType: 'publication_approval_snapshot',
      resourceId: snapshotId,
      expiresAt: parseIsoTimestamp(new Date(Date.now() + 24 * 3600 * 1000).toISOString()),
      createdAt: parseIsoTimestamp(createdAt),
    });

    // 6. Append audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: params.workspaceId,
      actorType: 'user',
      actorUserId: params.actorUserId,
      action: 'publication.approval_created',
      resourceType: 'publication_approval_snapshot',
      resourceId: snapshotId,
      result: 'succeeded',
      reasonCode: null,
      changes: { status: { before: null, after: 'approved' } },
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
      occurredAt: parseIsoTimestamp(createdAt),
      createdAt: parseIsoTimestamp(createdAt),
    });

    return snapshotEntity;
  });
}

export async function executeFindApprovalSnapshotById(
  database: Database,
  workspaceId: WorkspaceId,
  snapshotId: PublicationApprovalSnapshotId,
): Promise<PublicationApprovalSnapshot | null> {
  const result = await database.query<PublicationApprovalSnapshotRow>(
    SQL_FIND_APPROVAL_SNAPSHOT_BY_ID,
    [workspaceId, snapshotId],
  );
  if (result.rowCount === 0 || !result.rows[0]) return null;
  return mapPublicationApprovalSnapshotRow(result.rows[0]);
}
