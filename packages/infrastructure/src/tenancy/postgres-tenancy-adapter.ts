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
  type IdentityLookupKey,
  type UserDirectoryPort,
  type UserIdentityDirectoryPort,
  type WorkspacePersistencePort,
} from '@affiliate-content-os/application';
import type { Database } from '../database/types.js';
import { DatabaseError, sanitizeDatabaseError } from '../database/errors.js';
import {
  mapMembershipRow,
  mapUserRow,
  mapWorkspaceRow,
  type RawMembershipRow,
  type RawUserRow,
  type RawWorkspaceRow,
} from './mappers.js';

export class PostgresTenancyAdapter
  implements UserDirectoryPort, WorkspacePersistencePort, UserIdentityDirectoryPort
{
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

  public async findUsersByIdentity(key: IdentityLookupKey): Promise<readonly UserSnapshot[]> {
    const result = await this.database.query<RawUserRow>(
      `SELECT id, identity_provider, identity_subject, email, display_name,
              status, created_at, updated_at, version
       FROM users
       WHERE identity_provider = $1
         AND identity_subject = $2
       LIMIT 2`,
      [key.identityProvider, key.identitySubject],
    );

    return Object.freeze(result.rows.map((row) => mapUserRow(row)));
  }

  public async insertUserIfAbsent(params: {
    readonly user: UserSnapshot;
  }): Promise<UserSnapshot | null> {
    const { user } = params;
    const result = await this.database.query<RawUserRow>(
      `INSERT INTO users (
        id, identity_provider, identity_subject, email, display_name,
        status, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (identity_provider, identity_subject) DO NOTHING
      RETURNING id, identity_provider, identity_subject, email, display_name,
                status, created_at, updated_at, version`,
      [
        user.id,
        user.identityProvider,
        user.identitySubject,
        user.email,
        user.displayName,
        user.status,
        user.createdAt,
        user.updatedAt,
        user.version,
      ],
    );

    if (result.rows.length === 0) {
      return null;
    }
    if (result.rows.length === 1) {
      return mapUserRow(result.rows[0]!);
    }
    throw new DatabaseError('Unexpected multiple rows returned from insert');
  }

  public async createWorkspaceWithOwner(
    params: CreateWorkspaceWithOwnerParams,
  ): Promise<CreateWorkspaceResult> {
    try {
      return await this.database.withTransaction(async (tx) => {
        const wsResult = await tx.query<{ readonly id: string }>(
          `INSERT INTO workspaces (
            id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (slug) DO NOTHING
          RETURNING id`,
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

        if (wsResult.rowCount === 0) {
          throw new SlugConflictError(params.workspace.slug);
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
