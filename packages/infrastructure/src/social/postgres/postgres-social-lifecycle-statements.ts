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
  UPDATE social_accounts s
  SET refresh_lease_claimed_at = $3,
      refresh_lease_expires_at = ($3::timestamptz + ($4 * interval '1 second')),
      refresh_lease_worker_id = $5,
      refresh_lease_token = $6,
      updated_at = GREATEST(s.updated_at, $3::timestamptz)
  WHERE s.workspace_id = $1
    AND s.id = $2
    AND s.status <> 'disconnected'
    AND (s.refresh_lease_expires_at IS NULL OR s.refresh_lease_expires_at <= $3::timestamptz)
    AND EXISTS (
      SELECT 1 FROM social_credentials c
      WHERE c.workspace_id = s.workspace_id
        AND c.social_account_id = s.id
        AND (c.earliest_refresh_at IS NULL OR c.earliest_refresh_at <= $3::timestamptz)
    )
  RETURNING *;
`;

export const SQL_RELEASE_REFRESH_LEASE = `
  UPDATE social_accounts
  SET refresh_lease_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      refresh_lease_worker_id = NULL,
      refresh_lease_token = NULL,
      updated_at = GREATEST(updated_at, $3::timestamptz)
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
      capabilities_checked_at = $8,
      granted_scopes = $9::jsonb,
      capabilities_json = $10::jsonb,
      display_name = COALESCE($11, display_name),
      handle = COALESCE($12, handle),
      refresh_lease_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      refresh_lease_worker_id = NULL,
      refresh_lease_token = NULL,
      refresh_consecutive_failures = 0,
      updated_at = GREATEST(updated_at, $7::timestamptz),
      version = version + 1
  WHERE workspace_id = $1
    AND id = $2
    AND version = $13
    AND refresh_lease_token = $14
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
      updated_at = GREATEST(updated_at, $11::timestamptz),
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
      updated_at = GREATEST(updated_at, $7::timestamptz),
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
  JOIN social_credentials c ON c.workspace_id = s.workspace_id AND c.social_account_id = s.id
  WHERE s.status IN ('active', 'degraded')
    AND w.status = 'active'
    AND (c.earliest_refresh_at IS NULL OR c.earliest_refresh_at <= $1::timestamptz)
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

export const SQL_UPDATE_EXTERNAL_REVOCATION_RESULT = `
  UPDATE social_accounts
  SET external_revocation_result = $3,
      updated_at = $4
  WHERE workspace_id = $1 AND id = $2 AND status = 'disconnected';
`;

export const SQL_DELETE_SOCIAL_CREDENTIALS = `
  DELETE FROM social_credentials
  WHERE workspace_id = $1 AND social_account_id = $2;
`;

export const SQL_FIND_OPERATION_FOR_UPDATE = `
  SELECT id, workspace_id, social_account_id, principal_id, route_key,
         key_hash, request_hash, operation_type, status, phase, lease_token,
         lease_expires_at, resource_version, status_code, error_code,
         error_message, response_json, created_at, completed_at, expires_at
  FROM social_account_operations
  WHERE workspace_id = $1
    AND principal_id = $2
    AND route_key = $3
    AND key_hash = $4
  FOR UPDATE;
`;

export const SQL_INSERT_PENDING_OPERATION = `
  INSERT INTO social_account_operations (
    id, workspace_id, social_account_id, principal_id, route_key,
    key_hash, request_hash, operation_type, status, phase, lease_token,
    lease_expires_at, created_at, expires_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'claimed', $9, $10, $11, $12
  ) RETURNING *;
`;

export const SQL_MARK_OPERATION_ATTEMPT_STARTED = `
  UPDATE social_account_operations
  SET phase = 'provider_attempt_started'
  WHERE id = $1 AND lease_token = $2 AND status = 'pending';
`;

export const SQL_COMPLETE_OPERATION = `
  UPDATE social_account_operations
  SET status = 'completed',
      phase = 'terminal',
      resource_version = $3,
      status_code = $4,
      error_code = NULL,
      error_message = NULL,
      response_json = $5::jsonb,
      completed_at = $6
  WHERE id = $1 AND lease_token = $2 AND status = 'pending';
`;

export const SQL_FAIL_OPERATION = `
  UPDATE social_account_operations
  SET status = 'failed',
      phase = 'terminal',
      status_code = $3,
      error_code = $4,
      error_message = $5,
      completed_at = $6
  WHERE id = $1 AND lease_token = $2 AND status = 'pending';
`;

export const SQL_RENEW_OPERATION_LEASE = `
  UPDATE social_account_operations
  SET lease_expires_at = $3
  WHERE id = $1 AND lease_token = $2 AND status = 'pending';
`;

export const SQL_INSERT_REVOCATION_JOB = `
  INSERT INTO social_account_revocations (
    id, workspace_id, social_account_id, platform,
    encrypted_token, token_iv, token_auth_tag, encryption_key_version,
    status, phase, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'claimed', $9, $9
  ) RETURNING *;
`;

export const SQL_CLAIM_NEXT_DUE_REVOCATION_JOB = `
  UPDATE social_account_revocations
  SET status = 'in_progress',
      lease_token = $3,
      lease_expires_at = ($1::timestamptz + ($2 * interval '1 second')),
      worker_id = $4,
      attempt_count = attempt_count + 1,
      updated_at = $1
  WHERE id = (
    SELECT id FROM social_account_revocations
    WHERE status IN ('pending', 'in_progress')
      AND (lease_expires_at IS NULL OR lease_expires_at <= $1::timestamptz)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
`;

export const SQL_MARK_REVOCATION_ATTEMPT_STARTED = `
  UPDATE social_account_revocations
  SET phase = 'provider_attempt_started',
      updated_at = $3
  WHERE id = $1 AND lease_token = $2 AND status = 'in_progress';
`;

export const SQL_COMPLETE_REVOCATION_JOB = `
  UPDATE social_account_revocations
  SET status = 'succeeded',
      phase = 'terminal',
      encrypted_token = '\\x'::bytea,
      token_iv = '\\x000000000000000000000000'::bytea,
      token_auth_tag = '\\x00000000000000000000000000000000'::bytea,
      completed_at = $3,
      updated_at = $3
  WHERE id = $1 AND lease_token = $2 AND status = 'in_progress';
`;

export const SQL_FAIL_REVOCATION_JOB = `
  UPDATE social_account_revocations
  SET status = 'failed',
      phase = 'terminal',
      error_code = $3,
      error_message = $4,
      completed_at = $5,
      updated_at = $5
  WHERE id = $1 AND lease_token = $2 AND status = 'in_progress';
`;
