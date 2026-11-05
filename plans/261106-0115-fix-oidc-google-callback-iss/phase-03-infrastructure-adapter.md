# Phase 03: Infrastructure OIDC Adapter

## Objective

Update `OidcProtocolAdapter.exchangeCodeAndValidateIdToken` to attach the actual callback `iss` to the URL passed to `openid-client`, allowing native RFC 9207 validation, and classify protocol validation errors as `status: 'invalid'` (400) vs availability failures as `status: 'unavailable'` (503).

## Key Changes

1. `packages/infrastructure/src/auth/oidc-adapter.ts`:
   - Set `iss` on `callbackUrl` if provided in `params.iss`.
   - Call `client.authorizationCodeGrant(this.config, callbackUrl, ...)`.
   - In `catch`, classify error:
     - `ClientError` with `OAUTH_INVALID_RESPONSE`, `OAUTH_JWT_CLAIM_COMPARISON`, `OAUTH_JSON_ATTRIBUTE_COMPARISON`, `OAUTH_JWT_TIMESTAMP_CHECK`, `OAUTH_PARSE_ERROR`, or `AuthorizationResponseError`, `ResponseBodyError` -> `status: 'invalid'`.
     - Network errors (`TypeError`, `AbortError`), HTTP non-conform (500/503), etc. -> `status: 'unavailable'`.
   - Ensure file size remains strictly under 200 lines.
