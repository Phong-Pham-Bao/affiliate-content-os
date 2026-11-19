export const SQL_INSERT_RECONNECT_OAUTH_TRANSACTION = `
  INSERT INTO oauth_transactions (
    id, workspace_id, platform, initiated_by_user_id, state_hash,
    pkce_verifier_ciphertext, pkce_verifier_iv, pkce_verifier_auth_tag,
    encryption_key_version, redirect_uri, return_to, requested_scopes,
    reconnect_account_id, expected_provider_account_id, exchange_stage,
    status, created_at, expires_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, 'pending', $16, $17
  ) RETURNING *;
`;

export const SQL_FIND_ACCOUNT_FOR_REFRESH_CLAIM = `
  SELECT id, workspace_id, platform, provider_account_id, display_name, handle,
         status, status_reason, exchange_stage, granted_scopes, capabilities_json,
         capabilities_checked_at, token_expires_at, reauth_required_at,
         last_refreshed_at, next_refresh_at, connected_by_user_id, disconnected_at,
         environment, created_at, updated_at, version, refresh_lease_expires_at
  FROM social_accounts
  WHERE workspace_id = $1 AND id = $2 AND status <> 'disconnected'
  FOR UPDATE;
`;

export const SQL_CLAIM_REFRESH_LEASE = `
  UPDATE social_accounts
  SET refresh_lease_claimed_at = $3,
      refresh_lease_expires_at = ($3::timestamptz + ($4 * interval '1 second')),
      refresh_lease_worker_id = $5,
      refresh_lease_token = $6,
      updated_at = $3
  WHERE workspace_id = $1
    AND id = $2
    AND status <> 'disconnected'
    AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= $3::timestamptz)
  RETURNING *;
`;

export const SQL_RELEASE_REFRESH_LEASE = `
  UPDATE social_accounts
  SET refresh_lease_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      refresh_lease_worker_id = NULL,
      refresh_lease_token = NULL,
      updated_at = $3
  WHERE workspace_id = $1
    AND id = $2
    AND refresh_lease_token = $4
    AND status <> 'disconnected';
`;

export const SQL_FIND_CREDENTIALS_FOR_REFRESH = `
  SELECT social_account_id, workspace_id, access_token_ciphertext, access_token_iv,
         access_token_auth_tag, refresh_token_ciphertext, refresh_token_iv,
         refresh_token_auth_tag, encryption_key_version, version
  FROM social_credentials
  WHERE workspace_id = $1 AND social_account_id = $2;
`;

export const SQL_COMPLETE_ACCOUNT_REFRESH = `
  UPDATE social_accounts
  SET status = $3,
      status_reason = $4,
      token_expires_at = $5,
      next_refresh_at = $6,
      last_refreshed_at = $7,
      capabilities_checked_at = $7,
      refresh_lease_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      refresh_lease_worker_id = NULL,
      refresh_lease_token = NULL,
      refresh_consecutive_failures = 0,
      updated_at = $7,
      version = version + 1
  WHERE workspace_id = $1
    AND id = $2
    AND version = $8
    AND refresh_lease_token = $9
    AND status <> 'disconnected'
  RETURNING *;
`;

export const SQL_COMPLETE_CREDENTIALS_REFRESH = `
  UPDATE social_credentials
  SET access_token_ciphertext = $3,
      access_token_iv = $4,
      access_token_auth_tag = $5,
      refresh_token_ciphertext = $6,
      refresh_token_iv = $7,
      refresh_token_auth_tag = $8,
      encryption_key_version = $9,
      access_expires_at = $10,
      last_refreshed_at = $11,
      rotated_at = $11,
      token_kind = 'long_lived',
      refresh_attempt_count = refresh_attempt_count + 1,
      earliest_refresh_at = ($11::timestamptz + interval '24 hours'),
      updated_at = $11,
      version = version + 1
  WHERE workspace_id = $1 AND social_account_id = $2 AND version = $12;
`;

export const SQL_RECORD_FAILED_ACCOUNT_REFRESH = `
  UPDATE social_accounts
  SET status = $3,
      status_reason = $4,
      next_refresh_at = $5,
      reauth_required_at = $6,
      refresh_lease_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      refresh_lease_worker_id = NULL,
      refresh_lease_token = NULL,
      refresh_consecutive_failures = refresh_consecutive_failures + 1,
      updated_at = $7,
      version = version + 1
  WHERE workspace_id = $1
    AND id = $2
    AND version = $8
    AND (refresh_lease_token IS NULL OR refresh_lease_token = $9)
    AND status <> 'disconnected'
  RETURNING *;
`;

export const SQL_FIND_DUE_ACCOUNT_FOR_REFRESH_CLAIM = `
  SELECT s.id, s.workspace_id, s.version
  FROM social_accounts s
  JOIN workspaces w ON w.id = s.workspace_id
  WHERE s.status IN ('active', 'degraded')
    AND (
      (s.next_refresh_at IS NOT NULL AND s.next_refresh_at <= $1::timestamptz AND (s.refresh_lease_expires_at IS NULL OR s.refresh_lease_expires_at <= $1::timestamptz))
      OR (s.refresh_lease_expires_at IS NOT NULL AND s.refresh_lease_expires_at <= $1::timestamptz)
    )
  ORDER BY s.next_refresh_at ASC NULLS LAST, s.id ASC
  LIMIT 1
  FOR UPDATE OF s SKIP LOCKED;
`;

export const SQL_DISCONNECT_SOCIAL_ACCOUNT = `
  UPDATE social_accounts
  SET status = 'disconnected',
      status_reason = 'disconnected_by_user',
      disconnected_at = $3,
      disconnected_by_user_id = $4,
      capabilities_json = '{}'::jsonb,
      capabilities_checked_at = $3,
      token_expires_at = NULL,
      next_refresh_at = NULL,
      refresh_lease_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      refresh_lease_worker_id = NULL,
      refresh_lease_token = NULL,
      external_revocation_attempted = $5,
      external_revocation_supported = $6,
      external_revocation_result = $7,
      updated_at = $3,
      version = version + 1
  WHERE workspace_id = $1 AND id = $2 AND version = $8 AND status <> 'disconnected'
  RETURNING *;
`;

export const SQL_DELETE_SOCIAL_CREDENTIALS = `
  DELETE FROM social_credentials
  WHERE workspace_id = $1 AND social_account_id = $2;
`;
