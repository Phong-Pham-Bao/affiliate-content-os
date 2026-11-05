import type { Database } from '../database/index.js';
import { DatabaseError } from '../database/errors.js';
import { mapWorkspaceSummaryRow, type WorkspaceSummaryRow } from './mappers.js';
import {
  validateDatabaseQueryResult,
  validateGenuineRowsArray,
} from './postgres-result-validator.js';

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
      const validated = validateDatabaseQueryResult(result, 'SELECT');
      const rows = validateGenuineRowsArray(validated.rows, 0, 101);
      if (validated.rowCount !== rows.length) {
        throw new DatabaseError('Database query result validation failed');
      }

      const hasMore = rows.length === 101;
      const limit = hasMore ? 100 : rows.length;
      const items: WorkspaceSummaryRow[] = new Array(limit);
      for (let i = 0; i < limit; i++) {
        items[i] = mapWorkspaceSummaryRow(rows[i]);
      }

      return Object.freeze({
        items: Object.freeze(items),
        hasMore,
      });
    },
  };
}
