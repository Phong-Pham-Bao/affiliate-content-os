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
  SocialAccountNotFoundError,
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
import { mapSocialAccountRow, type SocialAccountRow } from './postgres-social-mappers.js';
import {
  SQL_COMPLETE_OPERATION,
  SQL_FAIL_OPERATION,
  SQL_FIND_OPERATION_FOR_UPDATE,
  SQL_INSERT_PENDING_OPERATION,
} from './postgres-social-lifecycle-statements.js';
import { SQL_FIND_SOCIAL_ACCOUNT_BY_ID } from './postgres-social-statements.js';

interface OperationRow {
  id: string;
  workspace_id: string;
  social_account_id: string;
  principal_id: string;
  route_key: string;
  key_hash: Buffer;
  request_hash: Buffer;
  operation_type: string;
  status: 'pending' | 'completed' | 'failed';
  lease_token: string;
  lease_expires_at: Date | string;
  resource_version: number | null;
  status_code: number | null;
  error_code: string | null;
  error_message: string | null;
  response_json: unknown;
  created_at: Date | string;
  completed_at: Date | string | null;
  expires_at: Date | string;
}

async function reloadAuthoritativeAccount(
  database: Database,
  workspaceId: string,
  accountId: string,
): Promise<SocialAccountSnapshot> {
  const res = await database.query<SocialAccountRow>(SQL_FIND_SOCIAL_ACCOUNT_BY_ID, [
    workspaceId,
    accountId,
  ]);
  if (res.rows.length === 0) {
    throw new SocialAccountNotFoundError();
  }
  return mapSocialAccountRow(res.rows[0]!);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeSocialAccountMutationWithIdempotency(
  database: Database,
  params: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly actorUserId: string;
    readonly idempotency: SocialIdempotencyInput;
    readonly now: string;
    readonly operationType?: 'refresh' | 'disconnect' | undefined;
    readonly executeMutation: (claimedOp?: {
      readonly operationId: string;
      readonly leaseToken: string;
    }) => Promise<SocialAccountSnapshot>;
  },
): Promise<{ readonly replayed: boolean; readonly account: SocialAccountSnapshot }> {
  const lockKey = computeIdempotencyAdvisoryLockKey(
    params.actorUserId,
    params.idempotency.routeKey,
    params.idempotency.keyHash,
  );

  // Phase 1: Claim or recover mutation operation in a short database transaction.
  // CRITICAL: We NEVER hold a database transaction open across provider calls!
  const claimResult = await database.withTransaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

    // Check existing social_account_operations
    const opRes = await tx.query<OperationRow>(SQL_FIND_OPERATION_FOR_UPDATE, [
      params.workspaceId,
      params.actorUserId,
      params.idempotency.routeKey,
      Buffer.from(params.idempotency.keyHash),
    ]);

    if (opRes.rows.length > 0) {
      const op = opRes.rows[0]!;
      const reqHash = Buffer.from(op.request_hash);
      if (
        reqHash.byteLength !== params.idempotency.requestHash.byteLength ||
        !crypto.timingSafeEqual(reqHash, params.idempotency.requestHash)
      ) {
        throw new IdempotencyKeyReusedError();
      }

      const isExpired = Date.parse(String(op.expires_at)) <= Date.parse(params.now);
      if (isExpired) {
        await tx.query('DELETE FROM social_account_operations WHERE id = $1', [op.id]);
      } else if (op.status === 'completed') {
        return { kind: 'completed' as const, opId: op.id };
      } else if (op.status === 'failed') {
        // Reclaim failed operation on retry with fresh lease token
        const newLeaseToken = generateUuidV7();
        const newLeaseExpiresAt = new Date(Date.parse(params.now) + 120_000).toISOString();
        await tx.query(
          `UPDATE social_account_operations
           SET status = 'pending', lease_token = $2, lease_expires_at = $3,
               status_code = NULL, error_code = NULL, error_message = NULL,
               completed_at = NULL
           WHERE id = $1`,
          [op.id, newLeaseToken, newLeaseExpiresAt],
        );
        return { kind: 'claimed' as const, opId: op.id, leaseToken: newLeaseToken };
      } else if (op.status === 'pending') {
        const isLeaseExpired = Date.parse(String(op.lease_expires_at)) <= Date.parse(params.now);
        if (!isLeaseExpired) {
          return { kind: 'in_flight' as const, opId: op.id };
        }
        // Reclaim expired pending operation with fresh lease token
        const newLeaseToken = generateUuidV7();
        const newLeaseExpiresAt = new Date(Date.parse(params.now) + 120_000).toISOString();
        await tx.query(
          `UPDATE social_account_operations
           SET lease_token = $2, lease_expires_at = $3
           WHERE id = $1`,
          [op.id, newLeaseToken, newLeaseExpiresAt],
        );
        return { kind: 'claimed' as const, opId: op.id, leaseToken: newLeaseToken };
      }
    }

    // Check fallback idempotency_keys
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
        return { kind: 'completed' as const, opId: snapshot.id };
      }
    }

    // Insert pending operation
    const operationId = generateUuidV7();
    const leaseToken = generateUuidV7();
    const leaseExpiresAt = new Date(Date.parse(params.now) + 120_000).toISOString();
    const expiresAt = new Date(Date.parse(params.now) + 86400 * 1000).toISOString();
    const operationType =
      params.operationType ??
      (params.idempotency.routeKey.includes('refresh') ? 'refresh' : 'disconnect');

    await tx.query(SQL_INSERT_PENDING_OPERATION, [
      operationId,
      params.workspaceId,
      params.accountId,
      params.actorUserId,
      params.idempotency.routeKey,
      Buffer.from(params.idempotency.keyHash),
      Buffer.from(params.idempotency.requestHash),
      operationType,
      leaseToken,
      leaseExpiresAt,
      params.now,
      expiresAt,
    ]);

    return { kind: 'claimed' as const, opId: operationId, leaseToken };
  });

  // If already completed: reload authoritative account state from database
  if (claimResult.kind === 'completed') {
    const account = await reloadAuthoritativeAccount(
      database,
      params.workspaceId,
      params.accountId,
    );
    return { replayed: true, account };
  }

  // If another concurrent request is in flight for the exact same key: converge by waiting briefly
  if (claimResult.kind === 'in_flight') {
    for (let attempt = 0; attempt < 20; attempt++) {
      await delayMs(50);
      const checkRes = await database.query<OperationRow>(
        `SELECT id, status, request_hash, expires_at
         FROM social_account_operations
         WHERE id = $1`,
        [claimResult.opId],
      );
      if (checkRes.rows.length > 0) {
        const op = checkRes.rows[0]!;
        if (op.status === 'completed') {
          const account = await reloadAuthoritativeAccount(
            database,
            params.workspaceId,
            params.accountId,
          );
          return { replayed: true, account };
        }
      }
    }
    // If still in flight after polling, re-evaluate authoritative account
    const account = await reloadAuthoritativeAccount(
      database,
      params.workspaceId,
      params.accountId,
    );
    return { replayed: true, account };
  }

  // Phase 2: Winner executes the mutation outside any database transaction.
  const claimedOp = { operationId: claimResult.opId, leaseToken: claimResult.leaseToken };
  let account: SocialAccountSnapshot;
  try {
    account = await params.executeMutation(claimedOp);
  } catch (err: unknown) {
    // Record failed operation state so lease doesn't linger
    await database.query(SQL_FAIL_OPERATION, [
      claimedOp.operationId,
      claimedOp.leaseToken,
      500,
      'MUTATION_ERROR',
      err instanceof Error ? err.message : 'Unknown mutation error',
      params.now,
    ]);
    throw err;
  }

  // Phase 3: Ensure completion in social_account_operations and idempotency_keys
  // (In case executeMutation was a mock or did not complete it internally)
  await database.withTransaction(async (tx) => {
    await tx.query(SQL_COMPLETE_OPERATION, [
      claimedOp.operationId,
      claimedOp.leaseToken,
      account.version,
      200,
      JSON.stringify({
        id: account.id,
        version: account.version,
        status: account.status,
      }),
      params.now,
    ]);

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
  });

  return {
    replayed: false,
    account,
  };
}
