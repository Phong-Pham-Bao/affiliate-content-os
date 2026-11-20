-- 0020_threads_terminal_secret_sentinels.sql: Enforce complete terminal revocation secret sentinels in PostgreSQL.
-- Forward-only migration hardening terminal secret wiping to require defined all-zero byte sentinels for token_iv and token_auth_tag.

ALTER TABLE social_account_revocations
  DROP CONSTRAINT social_account_revocations_secret_wipe_check;

ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_secret_wipe_check
    CHECK (
      (
        phase = 'terminal' AND
        octet_length(encrypted_token) = 0 AND
        token_iv = '\x000000000000000000000000'::bytea AND
        token_auth_tag = '\x00000000000000000000000000000000'::bytea
      ) OR
      (
        phase <> 'terminal' AND
        octet_length(encrypted_token) > 0 AND
        octet_length(token_iv) = 12 AND
        octet_length(token_auth_tag) = 16
      )
    );
