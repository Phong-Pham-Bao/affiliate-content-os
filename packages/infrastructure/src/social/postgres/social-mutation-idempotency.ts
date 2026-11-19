import crypto from 'node:crypto';
import {
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
  type SocialAccountSnapshot,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type SocialIdempotencyInput,
} from '@affiliate-content-os/application';
import type { Database } from '../../database/types.js';
import {
  computeIdempotencyAdvisoryLockKey,
  insertIdempotencyRecord,
} from '../../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../../tenancy/idempotency-row-mapper.js';

export async function executeSocialAccountMutationWithIdempotency(
  database: Database,
  params: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly actorUserId: string;
    readonly idempotency: SocialIdempotencyInput;
    readonly now: string;
    readonly executeMutation: () => Promise<SocialAccountSnapshot>;
  },
): Promise<{ readonly replayed: boolean; readonly account: SocialAccountSnapshot }> {
  const lockKey = computeIdempotencyAdvisoryLockKey(
    params.actorUserId,
    params.idempotency.routeKey,
    params.idempotency.keyHash,
  );

  return database.withTransaction(async (tx) => {
    // 1. Transaction-scoped advisory lock for idempotency key
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
      [
        params.workspaceId,
        params.actorUserId,
        params.idempotency.routeKey,
        Buffer.from(params.idempotency.keyHash),
      ],
    );

    if (existingResult.rowCount !== 0 && existingResult.rows[0]) {
      const rawRow = existingResult.rows[0];
      const snapshot = validateAndMapIdempotencyRow(rawRow);
      const isExpired = Date.parse(snapshot.expiresAt) <= Date.parse(params.now);

      if (isExpired) {
        await tx.query('DELETE FROM idempotency_keys WHERE id = $1', [snapshot.id]);
      } else {
        if (
          snapshot.requestHash.byteLength !== params.idempotency.requestHash.byteLength ||
          !crypto.timingSafeEqual(snapshot.requestHash, params.idempotency.requestHash)
        ) {
          throw new IdempotencyKeyReusedError();
        }

        const cachedAccount = snapshot.responseJson as unknown as SocialAccountSnapshot;
        return {
          replayed: true,
          account: cachedAccount,
        };
      }
    }

    // 3. Execute the underlying mutation
    const account = await params.executeMutation();

    // 4. Save into idempotency_keys
    const expiresAt = new Date(Date.parse(params.now) + 86400 * 1000).toISOString();
    await insertIdempotencyRecord(tx, {
      id: parseIdempotencyKeyId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      principalId: parseUserId(params.actorUserId),
      routeKey: params.idempotency.routeKey,
      keyHash: params.idempotency.keyHash,
      requestHash: params.idempotency.requestHash,
      statusCode: 200,
      responseJson: account as unknown as Record<string, unknown>,
      resourceType: 'social_account',
      resourceId: params.accountId,
      expiresAt: parseIsoTimestamp(expiresAt),
      createdAt: parseIsoTimestamp(params.now),
    });

    return {
      replayed: false,
      account,
    };
  });
}
