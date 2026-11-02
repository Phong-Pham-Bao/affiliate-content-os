export const INSERT_SESSION_SQL = `
  INSERT INTO application_sessions (
    id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
    created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
    revoked_at, revocation_reason, version
  ) VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8, NULL, NULL, 1);
`;

export const FIND_CANDIDATE_SESSIONS_SQL = `
  SELECT
    id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
    created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
    revoked_at, revocation_reason, version
  FROM application_sessions
  WHERE (current_token_hash = $1 OR (previous_token_hash = $1 AND previous_token_valid_until >= $2))
  LIMIT 2
  FOR UPDATE;
`;

export const ROTATE_SESSION_SQL = `
  UPDATE application_sessions
  SET current_token_hash = $1,
      previous_token_hash = $2,
      previous_token_valid_until = $3,
      rotated_at = $4,
      last_seen_at = $5,
      idle_expires_at = $6,
      version = version + 1
  WHERE id = $7 AND version = $8;
`;

export const TOUCH_SESSION_SQL = `
  UPDATE application_sessions
  SET last_seen_at = $1,
      idle_expires_at = $2,
      version = version + 1
  WHERE id = $3 AND version = $4;
`;

export const REVOKE_SESSION_SQL = `
  UPDATE application_sessions
  SET current_token_hash = NULL,
      previous_token_hash = NULL,
      previous_token_valid_until = NULL,
      revoked_at = $1,
      revocation_reason = $2,
      version = version + 1
  WHERE id = $3 AND version = $4;
`;

export const REVOKE_MATCHING_BY_HASH_SQL = `
  UPDATE application_sessions
  SET current_token_hash = NULL,
      previous_token_hash = NULL,
      previous_token_valid_until = NULL,
      revoked_at = $1,
      revocation_reason = $2,
      version = version + 1
  WHERE current_token_hash = $3 OR previous_token_hash = $3;
`;
