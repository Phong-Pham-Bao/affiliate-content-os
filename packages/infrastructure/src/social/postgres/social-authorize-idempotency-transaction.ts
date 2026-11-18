import crypto from 'node:crypto';
import {
  parseAuditEventId,
  parseCorrelationId,
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type SaveOAuthTransactionWithIdempotencyParams,
  type SaveOAuthTransactionWithIdempotencyResult,
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
import { SQL_INSERT_OAUTH_TRANSACTION } from './postgres-social-statements.js';

export async function executeSaveOAuthTransactionWithIdempotency(
  database: Database,
  params: SaveOAuthTransactionWithIdempotencyParams,
): Promise<SaveOAuthTransactionWithIdempotencyResult> {
  return database.withTransaction(async (tx) => {
    // 1. Transaction-scoped advisory lock for idempotency key
    const lockKey = computeIdempotencyAdvisoryLockKey(
      params.initiatedByUserId,
      params.routeKey,
      params.keyHash,
    );
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

    // 2. Lock & check existing idempotency row
    const existingResult = await tx.query<RawIdempotencyRow>(
      `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
              status_code, response_json, resource_type, resource_id, expires_at, created_at
       FROM idempotency_keys
       WHERE workspace_id = $1
         AND principal_id = $2
         AND route_key = $3
         AND key_hash = $4
       FOR UPDATE`,
      [params.workspaceId, params.initiatedByUserId, params.routeKey, Buffer.from(params.keyHash)],
    );

    if (existingResult.rowCount !== 0 && existingResult.rows[0]) {
      const rawRow = existingResult.rows[0];
      const snapshot = validateAndMapIdempotencyRow(rawRow);
      const isExpired = Date.parse(snapshot.expiresAt) <= Date.parse(params.createdAt);

      if (isExpired) {
        await tx.query('DELETE FROM idempotency_keys WHERE id = $1', [snapshot.id]);
      } else {
        if (!crypto.timingSafeEqual(snapshot.requestHash, params.requestHash)) {
          throw new IdempotencyKeyReusedError();
        }

        const cachedResponse =
          snapshot.responseJson as unknown as SaveOAuthTransactionWithIdempotencyResult['response'];
        return {
          replayed: true,
          response: cachedResponse,
        };
      }
    }

    // 3. Insert oauth_transactions row
    await tx.query(SQL_INSERT_OAUTH_TRANSACTION, [
      params.id,
      params.workspaceId,
      params.platform,
      params.initiatedByUserId,
      Buffer.from(params.stateHash),
      params.pkceVerifierCiphertext ? Buffer.from(params.pkceVerifierCiphertext) : null,
      params.pkceVerifierIv ? Buffer.from(params.pkceVerifierIv) : null,
      params.pkceVerifierAuthTag ? Buffer.from(params.pkceVerifierAuthTag) : null,
      params.encryptionKeyVersion ?? null,
      params.redirectUri,
      params.returnTo,
      JSON.stringify(params.requestedScopes),
      params.createdAt,
      params.expiresAt,
    ]);

    // 4. Insert idempotency_keys record in the same atomic transaction
    await insertIdempotencyRecord(tx, {
      id: parseIdempotencyKeyId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      principalId: parseUserId(params.initiatedByUserId),
      routeKey: params.routeKey,
      keyHash: params.keyHash,
      requestHash: params.requestHash,
      statusCode: 200,
      responseJson: params.responseData as unknown as Record<string, unknown>,
      resourceType: 'social_connection_authorization',
      resourceId: params.id,
      expiresAt: parseIsoTimestamp(params.expiresAt),
      createdAt: parseIsoTimestamp(params.createdAt),
    });

    // 5. Append audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      actorType: 'user',
      actorUserId: parseUserId(params.initiatedByUserId),
      action: 'social_connection.authorization_started',
      resourceType: 'oauth_transaction',
      resourceId: params.id,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        platform: { before: null, after: params.platform },
        status: { before: null, after: 'pending' },
      },
      ipHash: params.auditContext?.ipHash ?? null,
      userAgentSummary: params.auditContext?.userAgentSummary ?? null,
      correlationId: params.auditContext?.correlationId
        ? parseCorrelationId(params.auditContext.correlationId)
        : null,
      occurredAt: parseIsoTimestamp(params.createdAt),
      createdAt: parseIsoTimestamp(params.createdAt),
    });

    return {
      replayed: false,
      response: params.responseData,
    };
  });
}
