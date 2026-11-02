# Phase 01: Authentication Configuration

## Overview

Implement `AuthConfig`, `loadAuthConfig`, and `getRedactedAuthConfigMetadata` in `@affiliate-content-os/config`.

## Requirements

- `AUTH_ENABLED`: boolean ('true' | 'false'). Default false outside production; production requires true.
- When `AUTH_ENABLED=false`:
  - `issuer`, `clientId`, `clientSecret`, `redirectUri`, `transactionEncryptionKeyBase64Url`, `transactionKeyVersion` are null.
  - No OIDC discovery or secret parsing.
  - Return fixed 503 AUTH_NOT_CONFIGURED in HTTP boundary.
- When `AUTH_ENABLED=true`:
  - `APP_BASE_URL` is required and must be valid URL (HTTPS in production).
  - `OIDC_ISSUER`: absolute URL, HTTPS outside test/local loopback, no query/fragment/credentials.
  - `OIDC_CLIENT_ID`: non-empty trimmed string.
  - `OIDC_CLIENT_SECRET`: non-empty trimmed string, never logged/redacted.
  - `OIDC_REDIRECT_URI`: absolute URL, path exactly `/auth/callback`, HTTPS outside test/local loopback.
  - `AUTH_TRANSACTION_ENCRYPTION_KEY`: canonical unpadded base64url encoding of exactly 32 bytes.
  - `AUTH_TRANSACTION_KEY_VERSION`: matches `^[A-Za-z0-9._-]{1,64}$`.
  - Non-secret TTL defaults and ranges:
    - `transactionTtlSeconds`: default 600, range 120..900.
    - `sessionIdleTtlSeconds`: default 1800, range 300..3600.
    - `sessionAbsoluteTtlSeconds`: default 28800, range 3600..86400 (must be > idle).
    - `sessionRotationSeconds`: default 900, range 300..1800 (must be < idle).
    - `sessionRotationGraceSeconds`: default 30, range 5..120 (must be < rotation).
    - `sessionTouchIntervalSeconds`: default 300, range 60..600 (must be < idle).
  - `cookieSecure`: derived, true in production, false in development/test.
- Redacted metadata helper: `getRedactedAuthConfigMetadata(config: AuthConfig): RedactedAuthConfigMetadata`.

## Files

- `packages/config/src/types.ts`: AuthConfig and RedactedAuthConfigMetadata types.
- `packages/config/src/validate-auth.ts`: loadAuthConfig implementation.
- `packages/config/src/redact.ts`: getRedactedAuthConfigMetadata.
- `packages/config/src/index.ts`: export new symbols.
- `packages/config/test/auth-config.unit.test.ts`: comprehensive test suite.
