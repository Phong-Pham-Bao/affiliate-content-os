import {
  type UserId,
  type UserSnapshot,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import {
  SlugConflictError,
  type CreateWorkspaceWithOwnerParams,
  type CreateWorkspaceResult,
  type UserDirectoryPort,
  type WorkspacePersistencePort,
} from '@affiliate-content-os/application';
import type { Database } from '../database/types.js';
import { sanitizeDatabaseError } from '../database/errors.js';
import {
  mapMembershipRow,
  mapUserRow,
  mapWorkspaceRow,
  type RawMembershipRow,
  type RawUserRow,
  type RawWorkspaceRow,
} from './mappers.js';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

function isPgDriverError(error: unknown): error is PgDriverError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export class PostgresTenancyAdapter implements UserDirectoryPort, WorkspacePersistencePort {
  constructor(private readonly database: Database) {}

  public async findUserById(userId: UserId): Promise<UserSnapshot | null> {
    const result = await this.database.query<RawUserRow>(
      `SELECT id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version
       FROM users
       WHERE id = $1`,
      [userId],
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    return mapUserRow(result.rows[0]);
  }

  public async createWorkspaceWithOwner(
    params: CreateWorkspaceWithOwnerParams,
  ): Promise<CreateWorkspaceResult> {
    try {
      return await this.database.withTransaction(async (tx) => {
        try {
          await tx.query(
            `INSERT INTO workspaces (
              id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        } catch (wsErr) {
          if (
            (isPgDriverError(wsErr) && wsErr.code === '23505') ||
            (typeof wsErr === 'object' &&
              wsErr !== null &&
              (wsErr as { code?: string }).code === 'UNIQUE_VIOLATION')
          ) {
            throw new SlugConflictError(params.workspace.slug);
          }
          throw wsErr;
        }

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

        return {
          workspace: params.workspace,
          membership: params.membership,
        };
      });
    } catch (err) {
      if (err instanceof SlugConflictError) {
        throw err;
      }
      if (
        (isPgDriverError(err) && err.code === '23505') ||
        (typeof err === 'object' &&
          err !== null &&
          (err as { code?: string }).code === 'UNIQUE_VIOLATION')
      ) {
        throw new SlugConflictError(params.workspace.slug);
      }
      throw sanitizeDatabaseError(err);
    }
  }

  public async findWorkspaceByIdForUser(params: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
  }): Promise<WorkspaceSnapshot | null> {
    const result = await this.database.query<RawWorkspaceRow>(
      `SELECT w.id, w.name, w.slug, w.timezone, w.brand_voice, w.default_disclosure,
              w.ai_enabled, w.status, w.created_at, w.updated_at, w.version
       FROM workspaces w
       INNER JOIN workspace_memberships wm ON wm.workspace_id = w.id
       WHERE w.id = $1 AND wm.user_id = $2 AND wm.status = 'active'`,
      [params.workspaceId, params.userId],
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    return mapWorkspaceRow(result.rows[0]);
  }

  public async findMembership(params: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
  }): Promise<WorkspaceMembershipSnapshot | null> {
    const result = await this.database.query<RawMembershipRow>(
      `SELECT id, workspace_id, user_id, role, status, invited_by_user_id,
              joined_at, created_at, updated_at, version
       FROM workspace_memberships
       WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [params.workspaceId, params.userId],
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    return mapMembershipRow(result.rows[0]);
  }
}

export function createPostgresTenancyAdapter(database: Database): PostgresTenancyAdapter {
  return new PostgresTenancyAdapter(database);
}
