import crypto from 'node:crypto';
import {
  type IdempotencyRecordSnapshot,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import {
  IdempotencyConflictError,
  type IdempotencyStorePort,
} from '@affiliate-content-os/application';
import type { Database, TransactionExecutor } from '../database/types.js';
import { sanitizeDatabaseError } from '../database/errors.js';
import { validateAndMapIdempotencyRow, type RawIdempotencyRow } from './idempotency-row-mapper.js';

export { validateAndMapIdempotencyRow, type RawIdempotencyRow };
export const mapIdempotencyRow = validateAndMapIdempotencyRow;

export function computeIdempotencyAdvisoryLockKey(
  principalId: string,
  routeKey: string,
  keyHash: Uint8Array,
): string {
  const hash = crypto.createHash('sha256');
  hash.update(principalId);
  hash.update(':');
  hash.update(routeKey);
  hash.update(':');
  hash.update(Buffer.from(keyHash));
  const digest = hash.digest();
  return digest.readBigInt64BE(0).toString();
}

type QueryExecutor = Pick<Database, 'query'> | Pick<TransactionExecutor, 'query'>;

export async function insertIdempotencyRecord(
  executor: QueryExecutor,
  record: IdempotencyRecordSnapshot,
): Promise<void> {
  const isWorkspacePost = record.routeKey === 'POST /api/v1/workspaces';
  const conflictClause = isWorkspacePost
    ? `ON CONFLICT (principal_id, route_key, key_hash) WHERE route_key = 'POST /api/v1/workspaces' DO NOTHING RETURNING id`
    : `ON CONFLICT (workspace_id, principal_id, route_key, key_hash) WHERE workspace_id IS NOT NULL DO NOTHING RETURNING id`;

  const result = await executor.query<{ readonly id: string }>(
    `INSERT INTO idempotency_keys (
      id, workspace_id, principal_id, route_key, key_hash, request_hash,
      status_code, response_json, resource_type, resource_id, expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
    ${conflictClause}`,
    [
      record.id,
      record.workspaceId,
      record.principalId,
      record.routeKey,
      Buffer.from(record.keyHash),
      Buffer.from(record.requestHash),
      record.statusCode,
      JSON.stringify(record.responseJson),
      record.resourceType,
      record.resourceId,
      record.expiresAt,
      record.createdAt,
    ],
  );

  if (result.rowCount === 0) {
    throw new IdempotencyConflictError();
  }
}

export class PostgresIdempotencyAdapter implements IdempotencyStorePort {
  constructor(private readonly database: Database) {}

  public async findIdempotencyRecord(params: {
    readonly principalId: UserId;
    readonly routeKey: string;
    readonly keyHash: Uint8Array;
    readonly workspaceId?: WorkspaceId | undefined;
  }): Promise<IdempotencyRecordSnapshot | null> {
    try {
      const result = await this.database.query<RawIdempotencyRow>(
        `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
                status_code, response_json, resource_type, resource_id, expires_at, created_at
         FROM idempotency_keys
         WHERE principal_id = $1
           AND route_key = $2
           AND key_hash = $3
           AND ($4::uuid IS NULL OR workspace_id = $4::uuid)
           AND expires_at > NOW()
         LIMIT 1`,
        [
          params.principalId,
          params.routeKey,
          Buffer.from(params.keyHash),
          params.workspaceId ?? null,
        ],
      );

      if (result.rowCount === 0 || !result.rows[0]) {
        return null;
      }
      return mapIdempotencyRow(result.rows[0]);
    } catch (err) {
      throw sanitizeDatabaseError(err, 'Failed to query idempotency record');
    }
  }
}

export function createPostgresIdempotencyAdapter(database: Database): PostgresIdempotencyAdapter {
  return new PostgresIdempotencyAdapter(database);
}
