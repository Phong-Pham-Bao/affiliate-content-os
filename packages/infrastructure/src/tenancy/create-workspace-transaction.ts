import crypto from 'node:crypto';
import {
  IdempotencyKeyReusedError,
  SlugConflictError,
  type CreateWorkspaceWithOwnerParams,
  type CreateWorkspaceResult,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { createTransactionScopedPostgresAuditAdapter } from '../audit/index.js';
import {
  computeIdempotencyAdvisoryLockKey,
  insertIdempotencyRecord,
} from './postgres-idempotency-adapter.js';
import { validateAndMapIdempotencyRow, type RawIdempotencyRow } from './idempotency-row-mapper.js';
import {
  mapMembershipRow,
  mapWorkspaceRow,
  type RawMembershipRow,
  type RawWorkspaceRow,
} from './mappers.js';

export async function executeCreateWorkspaceTransaction(
  tx: TransactionExecutor,
  params: CreateWorkspaceWithOwnerParams,
): Promise<CreateWorkspaceResult> {
  if (!params.workspace || !params.membership || !params.idempotencyRecord || !params.auditEvent) {
    throw new DatabaseError('Missing required parameters for workspace creation');
  }

  const lockKey = computeIdempotencyAdvisoryLockKey(
    params.idempotencyRecord.principalId,
    params.idempotencyRecord.routeKey,
    params.idempotencyRecord.keyHash,
  );
  await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

  const existingResult = await tx.query<RawIdempotencyRow>(
    `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
            status_code, response_json, resource_type, resource_id, expires_at, created_at
     FROM idempotency_keys
     WHERE principal_id = $1
       AND route_key = $2
       AND key_hash = $3
     FOR UPDATE`,
    [
      params.idempotencyRecord.principalId,
      params.idempotencyRecord.routeKey,
      Buffer.from(params.idempotencyRecord.keyHash),
    ],
  );

  if (existingResult.rowCount !== 0 && existingResult.rows[0]) {
    const rawRow = existingResult.rows[0];
    const snapshot = validateAndMapIdempotencyRow(rawRow);
    const isExpired =
      Date.parse(snapshot.expiresAt) <= Date.parse(params.idempotencyRecord.createdAt);

    if (isExpired) {
      await tx.query('DELETE FROM idempotency_keys WHERE id = $1', [snapshot.id]);
    } else {
      if (!crypto.timingSafeEqual(snapshot.requestHash, params.idempotencyRecord.requestHash)) {
        throw new IdempotencyKeyReusedError();
      }

      const workspaceId = snapshot.resourceId ?? snapshot.workspaceId;
      if (!workspaceId) {
        throw new DatabaseError('Idempotency row missing workspace reference');
      }

      const wsResult = await tx.query<RawWorkspaceRow>(
        `SELECT id, name, slug, timezone, brand_voice, default_disclosure,
                ai_enabled, status, created_at, updated_at, version
         FROM workspaces
         WHERE id = $1`,
        [workspaceId],
      );
      if (wsResult.rowCount === 0 || !wsResult.rows[0]) {
        throw new DatabaseError(`Persisted workspace not found: ${workspaceId}`);
      }

      const memResult = await tx.query<RawMembershipRow>(
        `SELECT id, workspace_id, user_id, role, status, invited_by_user_id,
                joined_at, created_at, updated_at, version
         FROM workspace_memberships
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, params.membership.userId],
      );
      if (memResult.rowCount === 0 || !memResult.rows[0]) {
        throw new DatabaseError(`Persisted membership not found for workspace: ${workspaceId}`);
      }

      return {
        workspace: mapWorkspaceRow(wsResult.rows[0]),
        membership: mapMembershipRow(memResult.rows[0]),
        idempotencyRecord: snapshot,
        auditEvent: null,
        cached: true,
      };
    }
  }

  const wsResult = await tx.query<{ readonly id: string }>(
    `INSERT INTO workspaces (
      id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id`,
    [
      params.workspace.id,
      params.workspace.name,
      params.workspace.slug,
      params.workspace.timezone,
      params.workspace.brandVoice,
      params.workspace.defaultDisclosure,
      params.workspace.aiEnabled,
      params.workspace.status,
      params.workspace.createdAt,
      params.workspace.updatedAt,
      params.workspace.version,
    ],
  );

  if (wsResult.rowCount === 0) {
    throw new SlugConflictError(params.workspace.slug);
  }

  await tx.query(
    `INSERT INTO workspace_ai_policies (workspace_id, ai_enabled)
     VALUES ($1, $2)`,
    [params.workspace.id, params.workspace.aiEnabled],
  );

  await tx.query(
    `INSERT INTO workspace_memberships (
      id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      params.membership.id,
      params.membership.workspaceId,
      params.membership.userId,
      params.membership.role,
      params.membership.status,
      params.membership.invitedByUserId,
      params.membership.joinedAt,
      params.membership.createdAt,
      params.membership.updatedAt,
      params.membership.version,
    ],
  );

  await insertIdempotencyRecord(tx, params.idempotencyRecord);

  const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
  await auditAdapter.appendAuditEvent(params.auditEvent);

  return {
    workspace: params.workspace,
    membership: params.membership,
    idempotencyRecord: params.idempotencyRecord,
    auditEvent: params.auditEvent,
    cached: false,
  };
}
