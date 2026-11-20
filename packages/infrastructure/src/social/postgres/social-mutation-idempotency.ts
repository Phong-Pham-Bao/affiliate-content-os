import crypto from 'node:crypto';
import {
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
  type SocialAccountSnapshot,
} from '@affiliate-content-os/domain';
import {
  classifyOperationSafeError,
  generateUuidV7,
  IdempotencyKeyReusedError,
  reconstructOperationSafeError,
  SocialAccountNotFoundError,
  SocialOperationFenceLostError,
  type SocialIdempotencyInput,
  type SocialMutationIdempotencyResult,
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
  phase: 'claimed' | 'provider_attempt_started' | 'terminal';
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
    readonly now?: string | undefined;
    readonly leaseDurationSeconds?: number | undefined;
    readonly operationType?: 'refresh' | 'disconnect' | undefined;
    readonly executeMutation: (claimedOp?: {
      readonly operationId: string;
      readonly leaseToken: string;
    }) => Promise<SocialAccountSnapshot>;
  },
): Promise<SocialMutationIdempotencyResult> {
  const now = params.now ?? new Date().toISOString();
  const leaseDurationSeconds = params.leaseDurationSeconds ?? 180;
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

      const isExpired = Date.parse(String(op.expires_at)) <= Date.parse(now);
      if (isExpired) {
        await tx.query('DELETE FROM social_account_operations WHERE id = $1', [op.id]);
      } else if (op.status === 'completed') {
        return { kind: 'completed' as const, opId: op.id };
      } else if (op.status === 'failed') {
        // Terminal failed operation is replayed, never reclaimed!
        return { kind: 'failed' as const, opId: op.id, errorCode: op.error_code };
      } else if (op.status === 'pending') {
        const isLeaseExpired = Date.parse(String(op.lease_expires_at)) <= Date.parse(now);
        if (!isLeaseExpired) {
          return { kind: 'in_flight' as const, opId: op.id };
        }
        // Lease IS expired!
        if (op.phase === 'provider_attempt_started') {
          // Provider call started but process died before local commit! Outcome unknown!
          // Expiry MUST NOT blindly call the rotating-token endpoint again!
          await tx.query(
            `UPDATE social_account_operations
             SET status = 'failed', phase = 'terminal', status_code = 500,
                 error_code = 'OUTCOME_UNKNOWN',
                 error_message = 'Provider request timed out before outcome could be established safely.',
                 completed_at = $2
             WHERE id = $1`,
            [op.id, now],
          );
          await tx.query(
            `UPDATE social_accounts
             SET status = 'reauth_required', status_reason = 'token_expired',
                 reauth_required_at = $1, updated_at = GREATEST(updated_at, $1::timestamptz), version = version + 1
             WHERE workspace_id = $2 AND id = $3 AND status <> 'disconnected'`,
            [now, params.workspaceId, params.accountId],
          );
          return { kind: 'failed' as const, opId: op.id, errorCode: 'OUTCOME_UNKNOWN' };
        }
        // Safe to reclaim pre-call work with fresh lease token
        const newLeaseToken = generateUuidV7();
        const newLeaseExpiresAt = new Date(
          Date.parse(now) + leaseDurationSeconds * 1000,
        ).toISOString();
        await tx.query(
          `UPDATE social_account_operations
           SET lease_token = $2, lease_expires_at = $3, phase = 'claimed'
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
      const isExpired = Date.parse(snapshot.expiresAt) <= Date.parse(now);

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
    const leaseExpiresAt = new Date(Date.parse(now) + leaseDurationSeconds * 1000).toISOString();
    const expiresAt = new Date(Date.parse(now) + 86400 * 1000).toISOString();
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
      now,
      expiresAt,
    ]);

    return { kind: 'claimed' as const, opId: operationId, leaseToken };
  });

  if (claimResult.kind === 'failed') {
    throw reconstructOperationSafeError(claimResult.errorCode);
  }

  // If already completed: reload authoritative account state from database
  if (claimResult.kind === 'completed') {
    const account = await reloadAuthoritativeAccount(
      database,
      params.workspaceId,
      params.accountId,
    );
    return {
      status: 'completed',
      replayed: true,
      account,
    };
  }

  // If another concurrent request is in flight for the exact same key: converge by waiting briefly
  if (claimResult.kind === 'in_flight') {
    for (let attempt = 0; attempt < 20; attempt++) {
      await delayMs(50);
      const checkRes = await database.query<OperationRow>(
        `SELECT id, status, error_code, request_hash, expires_at
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
          return {
            status: 'completed',
            replayed: true,
            account,
          };
        }
        if (op.status === 'failed') {
          throw reconstructOperationSafeError(op.error_code);
        }
      }
    }
    // If still in flight after polling: NEVER return stale account as completed!
    return {
      status: 'in_progress',
      retryAfterSeconds: 2,
    };
  }

  // Phase 2: Winner executes the mutation outside any database transaction.
  const claimedOp = { operationId: claimResult.opId, leaseToken: claimResult.leaseToken };
  let account: SocialAccountSnapshot;
  try {
    account = await params.executeMutation(claimedOp);
  } catch (err: unknown) {
    const safeErr = classifyOperationSafeError(err);
    const failRes = await database.query(SQL_FAIL_OPERATION, [
      claimedOp.operationId,
      claimedOp.leaseToken,
      500,
      safeErr.errorCode,
      safeErr.errorMessage,
      now,
    ]);
    if (failRes.rowCount !== 1) {
      throw new SocialOperationFenceLostError(
        'Operation lease or fencing was lost during failure transition',
      );
    }
    throw err;
  }

  // Phase 3: Ensure completion in social_account_operations and idempotency_keys
  await database.withTransaction(async (tx) => {
    const compRes = await tx.query(SQL_COMPLETE_OPERATION, [
      claimedOp.operationId,
      claimedOp.leaseToken,
      account.version,
      200,
      JSON.stringify({
        id: account.id,
        version: account.version,
        status: account.status,
      }),
      now,
    ]);
    if (compRes.rowCount !== 1) {
      throw new SocialOperationFenceLostError(
        'Operation lease or fencing was lost during completion',
      );
    }

    const expiresAt = new Date(Date.parse(now) + 86400 * 1000).toISOString();
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
      createdAt: parseIsoTimestamp(now),
    });
  });

  return {
    status: 'completed',
    replayed: false,
    account,
  };
}
