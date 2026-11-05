# Phase 01: Diagnostic Classifier & Port Updates

## Overview

Implement the closed allowlisted diagnostic classification for OIDC grant failures and extend ports/snapshots for configuration unavailability.

## Requirements

- Closed allowlisted diagnostic category:
  - `oauth_invalid_grant`
  - `oauth_invalid_client`
  - `oauth_temporarily_unavailable`
  - `protocol_issuer_invalid`
  - `protocol_nonce_invalid`
  - `protocol_token_claim_invalid`
  - `protocol_timestamp_invalid`
  - `network_failure`
  - `timeout`
  - `unknown_safe`
- For ResponseBodyError: map only status (100..599) and allowlisted `error`. Never log error_description, response body, headers, code, verifier, nonce, client ID, client secret, callback URL, token, claims, cause, or stack.
- For ClientError: map closed known error.code values.
- Outcome mapping:
  - invalid_grant / issuer / nonce / claims => callback invalid (400)
  - invalid_client => auth configuration unavailable (503)
  - timeout/network/temporarily_unavailable/server_error => provider unavailable (503)

## Related Files

- `packages/infrastructure/src/auth/oidc-grant-diagnostic.ts` (new)
- `packages/application/src/auth/ports.ts`
- `packages/application/src/auth/complete-oidc-login-snapshots.ts`
- `packages/application/src/auth/complete-oidc-login.ts`
