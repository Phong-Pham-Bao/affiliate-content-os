import type { Database } from '../database/index.js';
import { DatabaseError } from '../database/errors.js';
import { mapWorkspaceSummaryRow, type WorkspaceSummaryRow } from './mappers.js';

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
      if (!Array.isArray(result.rows)) {
        throw new DatabaseError('Database result rows must be an array');
      }

      const hasMore = result.rows.length > 100;
      const rawSlice = hasMore ? result.rows.slice(0, 100) : result.rows;
      const items = rawSlice.map((r) => mapWorkspaceSummaryRow(r));

      return Object.freeze({
        items: Object.freeze(items),
        hasMore,
      });
    },
  };
}
