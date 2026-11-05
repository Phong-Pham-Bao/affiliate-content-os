# Phase 03: Security & Hostile Input Tests

## Overview

Add comprehensive unit tests verifying that hostile provider error fields, arbitrary response bodies, secrets, headers, and stack traces never reach logs.

## Test Coverage

1. Hostile `ResponseBodyError` with secrets in `error_description`, `cause`, `response.headers`, `response.body`, `stack`:
   - Verify none of those secrets appear in logged outputs.
   - Verify allowlisted error is preserved when safe; unallowlisted error is omitted.
2. Hostile `ClientError` with secrets in `message`, `cause.claims`, `cause.expected`:
   - Verify no secrets appear in logged output.
   - Verify only closed allowlisted category is logged.
3. Hostile generic Error / Network Error / Timeout:
   - Verify mapped to `network_failure` / `timeout` / `unknown_safe`.
4. Classification outcome tests:
   - `invalid_grant`, `issuer`, `nonce`, `claims` => 400 `OIDC_CALLBACK_INVALID`
   - `invalid_client` => 503 `AUTH_NOT_CONFIGURED`
   - `timeout`, `network_failure`, `temporarily_unavailable`, `server_error` => 503 `OIDC_PROVIDER_UNAVAILABLE`

## Related Files

- `packages/infrastructure/test/unit/oidc-grant-diagnostic.unit.test.ts`
- `packages/infrastructure/test/unit/oidc-adapter.unit.test.ts`
