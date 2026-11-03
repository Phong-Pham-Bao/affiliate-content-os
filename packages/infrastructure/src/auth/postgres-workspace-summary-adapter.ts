import type { Database } from '../database/index.js';
import { DatabaseError } from '../database/errors.js';
import { isProxySafe, mapWorkspaceSummaryRow, type WorkspaceSummaryRow } from './mappers.js';

export interface CurrentUserWorkspaceAccess {
  readonly items: readonly WorkspaceSummaryRow[];
  readonly hasMore: boolean;
}

export interface PostgresWorkspaceSummaryAdapter {
  listActiveWorkspaceSummaries(userId: string): Promise<CurrentUserWorkspaceAccess>;
}

export function createPostgresWorkspaceSummaryAdapter(
  database: Database,
): PostgresWorkspaceSummaryAdapter {
  return {
    async listActiveWorkspaceSummaries(userId: string): Promise<CurrentUserWorkspaceAccess> {
      const sql = `
        SELECT
          w.id,
          w.name,
          w.slug,
          w.timezone,
          m.role
        FROM workspace_memberships m
        JOIN workspaces w ON m.workspace_id = w.id
        WHERE m.user_id = $1
          AND m.status = 'active'
          AND w.status = 'active'
        ORDER BY w.slug ASC, w.id ASC
        LIMIT 101;
      `;
      const result = await database.query(sql, [userId]);
      const rawRows = result.rows;
      if (
        typeof rawRows !== 'object' ||
        rawRows === null ||
        isProxySafe(rawRows) ||
        !Array.isArray(rawRows)
      ) {
        throw new DatabaseError('Database result rows must be an array');
      }
      if (Object.getPrototypeOf(rawRows) !== Array.prototype) {
        throw new DatabaseError('Database result rows must have Array.prototype');
      }

      const lenDesc = Object.getOwnPropertyDescriptor(rawRows, 'length');
      if (
        !lenDesc ||
        lenDesc.get !== undefined ||
        lenDesc.set !== undefined ||
        typeof lenDesc.value !== 'number'
      ) {
        throw new DatabaseError('Invalid result rows length');
      }

      const rowCount = lenDesc.value;
      const hasMore = rowCount > 100;
      const limit = hasMore ? 100 : rowCount;
      const items: WorkspaceSummaryRow[] = [];
      for (let i = 0; i < limit; i++) {
        const desc = Object.getOwnPropertyDescriptor(rawRows, String(i));
        if (!desc || desc.get !== undefined || desc.set !== undefined) {
          throw new DatabaseError('Invalid result row item');
        }
        items.push(mapWorkspaceSummaryRow(desc.value));
      }

      return Object.freeze({
        items: Object.freeze(items),
        hasMore,
      });
    },
  };
}
