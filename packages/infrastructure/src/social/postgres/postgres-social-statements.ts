export const SQL_INSERT_OAUTH_TRANSACTION = `
  INSERT INTO oauth_transactions (
    id, workspace_id, platform, initiated_by_user_id, state_hash,
    pkce_verifier_ciphertext, pkce_verifier_iv, pkce_verifier_auth_tag,
    encryption_key_version, redirect_uri, return_to, requested_scopes,
    status, created_at, expires_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'pending', $13, $14
  ) RETURNING *;
`;

export const SQL_FIND_TRANSACTION_BY_STATE_HASH = `
  SELECT * FROM oauth_transactions WHERE state_hash = $1;
`;

export const SQL_CLAIM_TRANSACTION = `
  UPDATE oauth_transactions
  SET status = 'claimed',
      claimed_at = $3,
      claimed_expires_at = ($3::timestamptz + ($4 || ' seconds')::interval),
      version = version + 1
  WHERE state_hash = $1
    AND platform = $2
    AND status = 'pending'
    AND expires_at > $3
  RETURNING *;
`;

export const SQL_LOCK_TRANSACTION_FOR_UPDATE = `
  SELECT id, status, version, expires_at, initiated_by_user_id
  FROM oauth_transactions
  WHERE id = $1 AND workspace_id = $2
  FOR UPDATE;
`;

export const SQL_CONSUME_CLAIMED_TRANSACTION = `
  UPDATE oauth_transactions
  SET status = 'consumed', consumed_at = $2, version = version + 1
  WHERE id = $1 AND status = 'claimed' AND version = $3;
`;

export const SQL_FAIL_CLAIMED_TRANSACTION = `
  UPDATE oauth_transactions
  SET status = 'failed', consumed_at = $2, version = version + 1
  WHERE id = $1 AND status = 'claimed';
`;

export const SQL_FIND_ACTIVE_ACCOUNT_FOR_UPDATE = `
  SELECT id, version
  FROM social_accounts
  WHERE workspace_id = $1 AND platform = $2 AND provider_account_id = $3 AND status <> 'disconnected'
  FOR UPDATE;
`;

export const SQL_INSERT_SOCIAL_ACCOUNT = `
  INSERT INTO social_accounts (
    id, workspace_id, platform, provider_account_id, display_name, handle,
    status, granted_scopes, capabilities_json, capabilities_checked_at,
    token_expires_at, connected_by_user_id, environment, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, 'active', $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $13
  ) RETURNING *;
`;

export const SQL_UPDATE_SOCIAL_ACCOUNT = `
  UPDATE social_accounts
  SET display_name = $2, handle = $3, granted_scopes = $4::jsonb,
      capabilities_json = $5::jsonb, capabilities_checked_at = $6,
      token_expires_at = $7, status = 'active', updated_at = $8, version = version + 1
  WHERE id = $1
  RETURNING *;
`;

export const SQL_INSERT_SOCIAL_CREDENTIALS = `
  INSERT INTO social_credentials (
    social_account_id, workspace_id, access_token_ciphertext, access_token_iv,
    access_token_auth_tag, refresh_token_ciphertext, refresh_token_iv,
    refresh_token_auth_tag, encryption_key_version, token_type, access_expires_at,
    scope_snapshot, rotated_at, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, 'bearer', $10, $11::jsonb, $12, $12, $12
  );
`;

export const SQL_UPDATE_SOCIAL_CREDENTIALS = `
  UPDATE social_credentials
  SET access_token_ciphertext = $3, access_token_iv = $4, access_token_auth_tag = $5,
      refresh_token_ciphertext = $6, refresh_token_iv = $7, refresh_token_auth_tag = $8,
      encryption_key_version = $9, access_expires_at = $10, scope_snapshot = $11::jsonb,
      rotated_at = $12, updated_at = $12, version = version + 1
  WHERE workspace_id = $1 AND social_account_id = $2;
`;

export const SQL_INSERT_CALLBACK_RESULT = `
  INSERT INTO oauth_callback_results (
    id, workspace_id, transaction_id, initiated_by_user_id, result_key_hash, status, platform,
    social_account_id, error_code, error_description, created_at, expires_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
  ) RETURNING *;
`;

export const SQL_CONSUME_CALLBACK_RESULT = `
  UPDATE oauth_callback_results
  SET consumed_at = $4, version = version + 1
  WHERE workspace_id = $1 AND initiated_by_user_id = $2 AND result_key_hash = $3 AND consumed_at IS NULL AND expires_at > $4
  RETURNING *;
`;

export const SQL_FIND_CALLBACK_RESULT_BY_KEY = `
  SELECT id, workspace_id, transaction_id, initiated_by_user_id, result_key_hash, status, platform,
         social_account_id, error_code, error_description, created_at, expires_at, consumed_at, version
  FROM oauth_callback_results
  WHERE workspace_id = $1 AND result_key_hash = $2;
`;

export const SQL_LIST_SOCIAL_ACCOUNTS = `
  SELECT id, workspace_id, platform, provider_account_id, display_name, handle,
         status, granted_scopes, capabilities_json, capabilities_checked_at,
         token_expires_at, connected_by_user_id, disconnected_at, environment,
         created_at, updated_at, version
  FROM social_accounts
  WHERE workspace_id = $1
  ORDER BY updated_at DESC;
`;

export const SQL_FIND_SOCIAL_ACCOUNT_BY_ID = `
  SELECT id, workspace_id, platform, provider_account_id, display_name, handle,
         status, granted_scopes, capabilities_json, capabilities_checked_at,
         token_expires_at, connected_by_user_id, disconnected_at, environment,
         created_at, updated_at, version
  FROM social_accounts
  WHERE workspace_id = $1 AND id = $2;
`;
