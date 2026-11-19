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
  status_reason?: string | null;
  exchange_stage?: string;
  granted_scopes: unknown;
  capabilities_json: unknown;
  capabilities_checked_at: Date | string | null;
  token_expires_at: Date | string | null;
  reauth_required_at?: Date | string | null;
  last_refreshed_at?: Date | string | null;
  next_refresh_at?: Date | string | null;
  connected_by_user_id: string;
  disconnected_at: Date | string | null;
  external_revocation_attempted?: boolean;
  external_revocation_supported?: boolean;
  external_revocation_result?: string | null;
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
  reconnect_account_id?: string | null;
  expected_provider_account_id?: string | null;
  exchange_stage?: string;
  status: string;
  claimed_at?: Date | string | null;
  claimed_expires_at?: Date | string | null;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  version: string | number;
}

export interface OAuthCallbackResultRow {
  id: string;
  workspace_id: string;
  transaction_id: string;
  initiated_by_user_id: string;
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
    statusReason: (row.status_reason as SocialAccountSnapshot['statusReason']) ?? null,
    exchangeStage: (row.exchange_stage as SocialAccountSnapshot['exchangeStage']) ?? 'completed',
    grantedScopes: Array.isArray(row.granted_scopes) ? row.granted_scopes : [],
    capabilities:
      typeof row.capabilities_json === 'object' && row.capabilities_json !== null
        ? (row.capabilities_json as Record<string, boolean>)
        : {},
    capabilitiesCheckedAt: toIsoString(row.capabilities_checked_at),
    tokenExpiresAt: toIsoString(row.token_expires_at),
    reauthRequiredAt: toIsoString(row.reauth_required_at ?? null),
    lastRefreshedAt: toIsoString(row.last_refreshed_at ?? null),
    nextRefreshAt: toIsoString(row.next_refresh_at ?? null),
    connectedByUserId: row.connected_by_user_id,
    disconnectedAt: toIsoString(row.disconnected_at),
    externalRevocationAttempted: Boolean(row.external_revocation_attempted),
    externalRevocationSupported: Boolean(row.external_revocation_supported),
    externalRevocationResult:
      (row.external_revocation_result as SocialAccountSnapshot['externalRevocationResult']) ?? null,
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
    reconnectAccountId: row.reconnect_account_id ?? null,
    expectedProviderAccountId: row.expected_provider_account_id ?? null,
    exchangeStage:
      (row.exchange_stage as OAuthTransactionSnapshot['exchangeStage']) ?? 'code_received',
    status: row.status as OAuthTransactionSnapshot['status'],
    claimedAt: toIsoString(row.claimed_at ?? null),
    claimedExpiresAt: toIsoString(row.claimed_expires_at ?? null),
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
    initiatedByUserId: row.initiated_by_user_id,
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
