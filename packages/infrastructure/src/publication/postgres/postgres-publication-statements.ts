export const SQL_INSERT_PUBLICATION_APPROVAL_SNAPSHOT = `
  INSERT INTO publication_approval_snapshots (
    id, workspace_id, content_approval_id, content_approval_snapshot_hash,
    artifact_id, revision_number, content_hash, platform,
    social_account_id, provider_account_id, account_version,
    capability_fingerprint, capabilities_snapshot_json, capabilities_checked_at,
    rendered_text, preview_hash, disclosure_state_json, platform_settings_json,
    approved_by_user_id, consent_type, policy_version, policy_hash,
    snapshot_json, snapshot_hash, created_at
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
    $13::jsonb, $14, $15, $16, $17::jsonb, $18::jsonb,
    $19, $20, $21, $22, $23::jsonb, $24, $25
  )
  RETURNING *;
`;

export const SQL_FIND_APPROVAL_SNAPSHOT_BY_ID = `
  SELECT * FROM publication_approval_snapshots WHERE workspace_id = $1 AND id = $2;
`;

export const SQL_FIND_SOURCE_CONTENT_APPROVAL = `
  SELECT id, workspace_id, artifact_id, revision_number, content_hash,
         evaluation_id, policy_version, policy_hash, snapshot_hash, created_at
  FROM content_approval_snapshots WHERE workspace_id = $1 AND id = $2;
`;

export const SQL_FIND_SOURCE_ARTIFACT_REVISION = `
  SELECT id, workspace_id, artifact_id, revision_number, content_hash, content_json
  FROM content_artifact_revisions
  WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3 AND content_hash = $4;
`;

export const SQL_FIND_COMPLIANCE_EVALUATION = `
  SELECT id, workspace_id, status, result, blocking_count, warning_count
  FROM compliance_evaluations WHERE workspace_id = $1 AND id = $2;
`;

export const SQL_FIND_SOCIAL_ACCOUNT = `
  SELECT id, workspace_id, platform, provider_account_id, display_name, handle,
         status, capabilities_json, capabilities_checked_at, version
  FROM social_accounts WHERE workspace_id = $1 AND id = $2;
`;

export const SQL_FIND_SOCIAL_CREDENTIALS = `
  SELECT access_token_ciphertext, access_token_iv, access_token_auth_tag,
         refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
         encryption_key_version, token_type
  FROM social_credentials WHERE workspace_id = $1 AND social_account_id = $2;
`;

export const SQL_INSERT_PUBLICATION = `
  INSERT INTO publications (
    id, workspace_id, approval_snapshot_id, social_account_id, platform,
    status, scheduled_at_utc, original_local_time, timezone,
    lease_token, lease_owner, lease_expires_at,
    current_attempt_number, max_attempts, next_attempt_at,
    remote_post_id, remote_permalink, published_at,
    last_error_code, last_error_message, gated_reason, completed_at,
    created_by_user_id, created_at, updated_at, version
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, NULL,
    0, $10, $11, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    $12, NOW(), NOW(), 1
  )
  RETURNING *;
`;

export const SQL_FIND_PUBLICATION_BY_ID = `
  SELECT * FROM publications WHERE workspace_id = $1 AND id = $2;
`;

export const SQL_FIND_PUBLICATION_BY_APPROVAL_ID = `
  SELECT id, status, version FROM publications WHERE workspace_id = $1 AND approval_snapshot_id = $2;
`;

export const SQL_FIND_PUBLICATION_FOR_UPDATE = `
  SELECT * FROM publications WHERE workspace_id = $1 AND id = $2 FOR UPDATE;
`;

export const SQL_FIND_LATEST_ATTEMPT_FOR_PUBLICATION = `
  SELECT * FROM publication_attempts
  WHERE workspace_id = $1 AND publication_id = $2
  ORDER BY attempt_number DESC LIMIT 1;
`;

export const SQL_UPDATE_PUBLICATION_RESCHEDULE = `
  UPDATE publications
  SET scheduled_at_utc = $1, original_local_time = $2, timezone = $3,
      next_attempt_at = $1, version = version + 1, updated_at = NOW()
  WHERE workspace_id = $4 AND id = $5 AND version = $6
  RETURNING *;
`;

export const SQL_UPDATE_PUBLICATION_CANCEL = `
  UPDATE publications
  SET status = 'canceled', completed_at = NOW(),
      lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
      version = version + 1, updated_at = NOW()
  WHERE workspace_id = $1 AND id = $2 AND version = $3
  RETURNING *;
`;

export const SQL_CLAIM_DUE_PUBLICATIONS = `
  WITH due AS (
    SELECT id, version FROM publications
    WHERE status IN ('scheduled', 'retry_wait') AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
  )
  UPDATE publications p
  SET status = 'queued', lease_token = gen_random_uuid(), lease_owner = $2,
      lease_expires_at = NOW() + ($3 || ' seconds')::interval,
      version = p.version + 1, updated_at = NOW()
  FROM due WHERE p.id = due.id AND p.version = due.version
  RETURNING p.*;
`;

export const SQL_INSERT_PUBLICATION_ATTEMPT = `
  INSERT INTO publication_attempts (
    id, workspace_id, publication_id, attempt_number, attempt_idempotency_key,
    request_hash, adapter_version, correlation_id, phase, status,
    outcome_code, outcome_message, remote_post_id, remote_permalink,
    started_at, completed_at, created_at, updated_at, version
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    NULL, NULL, NULL, NULL, $11, NULL, NOW(), NOW(), 1
  )
  RETURNING *;
`;

export const SQL_UPDATE_PUBLICATION_PUBLISHING = `
  UPDATE publications
  SET status = 'publishing', current_attempt_number = $1, version = version + 1, updated_at = NOW()
  WHERE workspace_id = $2 AND id = $3 AND lease_token = $4 AND version = $5
  RETURNING *;
`;

export const SQL_SETTLE_ATTEMPT_TERMINAL = `
  UPDATE publication_attempts
  SET phase = 'terminal', status = $1, outcome_code = $2, outcome_message = $3,
      remote_post_id = $4, remote_permalink = $5, completed_at = NOW(),
      version = version + 1, updated_at = NOW()
  WHERE workspace_id = $6 AND id = $7 AND phase = 'provider_attempt_started'
  RETURNING *;
`;

export const SQL_SETTLE_PUBLICATION_TERMINAL = `
  UPDATE publications
  SET status = $1, remote_post_id = $2, remote_permalink = $3, published_at = $4,
      last_error_code = $5, last_error_message = $6, gated_reason = $7,
      completed_at = $8, next_attempt_at = $9, lease_token = NULL,
      lease_owner = NULL, lease_expires_at = NULL, version = version + 1, updated_at = NOW()
  WHERE workspace_id = $10 AND id = $11 AND lease_token = $12
  RETURNING *;
`;

export const SQL_FIND_EXPIRED_LEASE_PUBLICATIONS = `
  SELECT id, workspace_id, version, status, current_attempt_number FROM publications
  WHERE lease_expires_at IS NOT NULL AND lease_expires_at <= NOW()
    AND status IN ('queued', 'publishing')
  LIMIT $1 FOR UPDATE SKIP LOCKED;
`;

export const SQL_UPDATE_PUBLICATION_GATED = `
  UPDATE publications
  SET status = $1, gated_reason = $2, last_error_code = $3, last_error_message = $4,
      completed_at = NOW(), lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
      version = version + 1, updated_at = NOW()
  WHERE workspace_id = $5 AND id = $6 AND lease_token = $7
  RETURNING *;
`;

export const SQL_SUPERSEDE_OUTBOX_EVENTS = `
  UPDATE outbox_events
  SET delivered_at = NOW()
  WHERE workspace_id = $1 AND aggregate_type = 'publication' AND aggregate_id = $2 AND delivered_at IS NULL;
`;

export const SQL_INSERT_OUTBOX_EVENT = `
  INSERT INTO outbox_events (
    id, workspace_id, event_type, aggregate_type, aggregate_id,
    aggregate_version, payload_json, occurred_at, available_at, delivery_count, created_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), $8, 0, NOW());
`;
