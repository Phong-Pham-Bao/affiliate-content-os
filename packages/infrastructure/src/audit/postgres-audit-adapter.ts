import util from 'node:util';
import type { AuditEventSnapshot } from '@affiliate-content-os/domain';
import {
  captureAuditEventSnapshot,
  type AuditEventAppendPort,
} from '@affiliate-content-os/application';
import type { Database, TransactionExecutor } from '../database/types.js';
import { sanitizeDatabaseError } from '../database/errors.js';

type QueryExecutor = Pick<Database, 'query'> | Pick<TransactionExecutor, 'query'>;

class PostgresAuditAdapter implements AuditEventAppendPort {
  public constructor(private readonly executor: QueryExecutor) {}

  public async appendAuditEvent(rawEvent: AuditEventSnapshot): Promise<void> {
    try {
      if (typeof rawEvent !== 'object' || rawEvent === null || util.types.isProxy(rawEvent))
        throw new Error('invalid');
      const event = captureAuditEventSnapshot(rawEvent);
      const result = await this.executor.query(
        `INSERT INTO audit_events (
          id, workspace_id, actor_type, actor_user_id, action, resource_type, resource_id,
          result, reason_code, changes_json, ip_hash, user_agent_summary, correlation_id,
          occurred_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)`,
        [
          event.id,
          event.workspaceId,
          event.actorType,
          event.actorUserId,
          event.action,
          event.resourceType,
          event.resourceId,
          event.result,
          event.reasonCode,
          JSON.stringify(event.changes),
          event.ipHash,
          event.userAgentSummary,
          event.correlationId,
          event.occurredAt,
          event.createdAt,
        ],
      );
      if (typeof result !== 'object' || result === null || util.types.isProxy(result))
        throw new Error('invalid result');
      const prototype = Object.getPrototypeOf(result);
      const keys = Reflect.ownKeys(result);
      if (
        (prototype !== Object.prototype && prototype !== null) ||
        keys.length !== 3 ||
        keys.some((key) => typeof key !== 'string') ||
        !keys.includes('rows') ||
        !keys.includes('rowCount') ||
        !keys.includes('command')
      )
        throw new Error('invalid result');
      const rows = Object.getOwnPropertyDescriptor(result, 'rows');
      const rowCount = Object.getOwnPropertyDescriptor(result, 'rowCount');
      const command = Object.getOwnPropertyDescriptor(result, 'command');
      if (
        !rows ||
        !rows.enumerable ||
        rows.get !== undefined ||
        rows.set !== undefined ||
        typeof rows.value !== 'object' ||
        rows.value === null ||
        util.types.isProxy(rows.value) ||
        !Array.isArray(rows.value) ||
        Object.getPrototypeOf(rows.value) !== Array.prototype ||
        Reflect.ownKeys(rows.value).length !== 1 ||
        Reflect.ownKeys(rows.value)[0] !== 'length' ||
        rows.value.length !== 0 ||
        !rowCount ||
        !rowCount.enumerable ||
        rowCount.get !== undefined ||
        rowCount.set !== undefined ||
        rowCount.value !== 1 ||
        !command ||
        !command.enumerable ||
        command.get !== undefined ||
        command.set !== undefined ||
        command.value !== 'INSERT'
      )
        throw new Error('invalid result');
    } catch (error) {
      throw sanitizeDatabaseError(error, 'Audit event insert failed');
    }
  }
}

export function createPostgresAuditAdapter(database: Database): AuditEventAppendPort {
  return new PostgresAuditAdapter(database);
}
export function createTransactionScopedPostgresAuditAdapter(
  transaction: TransactionExecutor,
): AuditEventAppendPort {
  return new PostgresAuditAdapter(transaction);
}
