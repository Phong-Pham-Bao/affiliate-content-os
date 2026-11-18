import {
  parseUserId,
  parseWorkspaceId,
  type SocialAccountEnvironment,
  type SocialAccountSnapshot,
  type SocialAccountStatus,
  type SocialPlatform,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import type { SocialPersistencePort } from './ports.js';

export interface ListSocialAccountsQuery {
  readonly workspaceId: string;
  readonly actorUserId: string;
}

export interface ListSocialAccountsDependencies {
  readonly persistence: SocialPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export interface SafeSocialAccountDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly providerAccountId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly status: SocialAccountStatus;
  readonly grantedScopes: readonly string[];
  readonly capabilities: Record<string, boolean>;
  readonly capabilitiesCheckedAt: string | null;
  readonly tokenExpiresAt: string | null;
  readonly connectedByUserId: string;
  readonly disconnectedAt: string | null;
  readonly environment: SocialAccountEnvironment;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

function mapSnapshotToSafeDto(snap: SocialAccountSnapshot): SafeSocialAccountDTO {
  return {
    id: snap.id,
    workspaceId: snap.workspaceId,
    platform: snap.platform,
    providerAccountId: snap.providerAccountId,
    displayName: snap.displayName,
    handle: snap.handle,
    status: snap.status,
    grantedScopes: snap.grantedScopes,
    capabilities: snap.capabilities,
    capabilitiesCheckedAt: snap.capabilitiesCheckedAt,
    tokenExpiresAt: snap.tokenExpiresAt,
    connectedByUserId: snap.connectedByUserId,
    disconnectedAt: snap.disconnectedAt,
    environment: snap.environment,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
    version: snap.version,
  };
}

export async function listSocialAccounts(
  query: ListSocialAccountsQuery,
  deps: ListSocialAccountsDependencies,
): Promise<readonly SafeSocialAccountDTO[]> {
  const wsId = parseWorkspaceId(query.workspaceId);
  const actorId = parseUserId(query.actorUserId);

  await authorizeWorkspaceAction(
    {
      workspaceId: wsId,
      userId: actorId,
      capability: 'publications.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const accounts = await deps.persistence.listSocialAccounts({ workspaceId: wsId });
  return accounts.map(mapSnapshotToSafeDto);
}
