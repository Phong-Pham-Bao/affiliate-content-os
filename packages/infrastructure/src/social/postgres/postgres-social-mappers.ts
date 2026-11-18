import type {
  OAuthCallbackResultSnapshot,
  OAuthTransactionSnapshot,
  SocialAccountSnapshot,
} from '@affiliate-content-os/domain';

export interface SocialAccountRow {
  id: string;
  workspace_id: string;
  platform: string;
  provider_account_id: string;
  display_name: string;
  handle: string | null;
  status: string;
  granted_scopes: unknown;
  capabilities_json: unknown;
  capabilities_checked_at: Date | string | null;
  token_expires_at: Date | string | null;
  connected_by_user_id: string;
  disconnected_at: Date | string | null;
  environment: string;
  created_at: Date | string;
  updated_at: Date | string;
  version: string | number;
}

export interface OAuthTransactionRow {
  id: string;
  workspace_id: string;
  platform: string;
  initiated_by_user_id: string;
  state_hash: Buffer;
  redirect_uri: string;
  return_to: string;
  requested_scopes: unknown;
  status: string;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  version: string | number;
}

export interface OAuthCallbackResultRow {
  id: string;
  workspace_id: string;
  transaction_id: string;
  result_key_hash: Buffer;
  status: string;
  platform: string;
  social_account_id: string | null;
  error_code: string | null;
  error_description: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  version: string | number;
}

function toIsoString(val: Date | string | null): string | null {
  if (val === null || val === undefined) return null;
  return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
}

export function mapSocialAccountRow(row: SocialAccountRow): SocialAccountSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform as SocialAccountSnapshot['platform'],
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    handle: row.handle,
    status: row.status as SocialAccountSnapshot['status'],
    grantedScopes: Array.isArray(row.granted_scopes) ? row.granted_scopes : [],
    capabilities:
      typeof row.capabilities_json === 'object' && row.capabilities_json !== null
        ? (row.capabilities_json as Record<string, boolean>)
        : {},
    capabilitiesCheckedAt: toIsoString(row.capabilities_checked_at),
    tokenExpiresAt: toIsoString(row.token_expires_at),
    connectedByUserId: row.connected_by_user_id,
    disconnectedAt: toIsoString(row.disconnected_at),
    environment: row.environment as SocialAccountSnapshot['environment'],
    createdAt: toIsoString(row.created_at)!,
    updatedAt: toIsoString(row.updated_at)!,
    version: Number(row.version),
  };
}

export function mapOAuthTransactionRow(row: OAuthTransactionRow): OAuthTransactionSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform as OAuthTransactionSnapshot['platform'],
    initiatedByUserId: row.initiated_by_user_id,
    stateHash: new Uint8Array(
      row.state_hash.buffer,
      row.state_hash.byteOffset,
      row.state_hash.byteLength,
    ),
    redirectUri: row.redirect_uri,
    returnTo: row.return_to,
    requestedScopes: Array.isArray(row.requested_scopes) ? row.requested_scopes : [],
    status: row.status as OAuthTransactionSnapshot['status'],
    createdAt: toIsoString(row.created_at)!,
    expiresAt: toIsoString(row.expires_at)!,
    consumedAt: toIsoString(row.consumed_at),
    version: Number(row.version),
  };
}

export function mapOAuthCallbackResultRow(
  row: OAuthCallbackResultRow,
): OAuthCallbackResultSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    transactionId: row.transaction_id,
    resultKeyHash: new Uint8Array(
      row.result_key_hash.buffer,
      row.result_key_hash.byteOffset,
      row.result_key_hash.byteLength,
    ),
    status: row.status as OAuthCallbackResultSnapshot['status'],
    platform: row.platform as OAuthCallbackResultSnapshot['platform'],
    socialAccountId: row.social_account_id,
    errorCode: row.error_code,
    errorDescription: row.error_description,
    createdAt: toIsoString(row.created_at)!,
    expiresAt: toIsoString(row.expires_at)!,
    consumedAt: toIsoString(row.consumed_at),
    version: Number(row.version),
  };
}
