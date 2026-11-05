# Implementation Report: Fix Google OIDC Callback Issuer Parameter Handling (RFC 9207)

**Date**: 2026-11-06 01:33 (UTC+7)

**Task**: TASK-009 Checkpoint A second Google OIDC blocker

**Type**: cook

**Branch**: main

## Executive Summary

Resolved Checkpoint A second Google OIDC blocker where Google discovery advertises `authorization_response_iss_parameter_supported=true` and callback includes `iss=https://accounts.google.com`. Implemented RFC 9207 compliance across the route, application boundary, snapshots, and `openid-client` adapter. The actual received `iss` is preserved through all layers without fabrication and passed to `openid-client`'s authorization response validation. Protocol validation failures (missing/mismatched issuer, invalid response) are classified as `status: 'invalid'` (HTTP 400 `OIDC_CALLBACK_INVALID`), while upstream network and token endpoint availability failures remain `status: 'unavailable'` (HTTP 503 `OIDC_PROVIDER_UNAVAILABLE`).

## Key Changes

1. **Route & Schema Boundary (`apps/api/src/auth/schemas.ts`, `apps/api/src/auth/callback-url-parser.ts`)**:
   - Allowlisted `iss` (`minLength: 1, maxLength: 2048`) in Fastify query schema and regenerated `openapi/openapi.json`.
   - Updated `parseAndValidateRawCallback` to extract and validate `iss` for both authorization code and denial callbacks.
   - Enforced strict duplicate detection (both raw and percent-encoded `%69ss`), control character rejection, and length bounds (1..2048) on `iss`.

2. **Application Boundary & Query Snapshots (`packages/application/src/auth/complete-oidc-login-query.ts`, `complete-oidc-login.ts`, `ports.ts`)**:
   - Updated `parseCallbackQuery` to accept and freeze optional `iss` parameter alongside `code` and `state` (or on denial).
   - Updated `OidcProtocolPort.exchangeCodeAndValidateIdToken` signature to accept `readonly iss?: string | undefined`.
   - In `completeOidcLogin`, passed the exact received `parsed.iss` into `exchangeCodeAndValidateIdToken`.
   - Preserved state hash, browser-binding cookie hash, single-use transaction consumption, decrypted PKCE verifier, nonce, and secret sanitization.

3. **Infrastructure OIDC Protocol Adapter (`packages/infrastructure/src/auth/oidc-adapter.ts`)**:
   - Appended actual received `iss` to `callbackUrl.searchParams` before invoking `openid-client`'s `authorizationCodeGrant`.
   - Implemented `isProtocolInvalidError` classifying protocol validation failures (`ClientError` with `OAUTH_INVALID_RESPONSE`, `OAUTH_JWT_CLAIM_COMPARISON`, etc., plus `AuthorizationResponseError` and `ResponseBodyError`) as `status: 'invalid'`.
   - Preserved `status: 'unavailable'` for genuine network failures (`TypeError`), timeouts (`AbortError`), and upstream HTTP non-conforming responses (`OAUTH_RESPONSE_IS_NOT_CONFORM`).
   - Enabled optional `grantFn` dependency injection for deterministic unit testing without altering production behavior.
   - Kept `oidc-adapter.ts` strictly modular at 191 lines (under the 200-line limit).

4. **Test Suite (`apps/api/test/auth-callback-route.unit.test.ts`, `callback-url-parser.unit.test.ts`, `packages/application/test/auth/complete-oidc-login.unit.test.ts`, `packages/infrastructure/test/unit/oidc-adapter-issuer.unit.test.ts`)**:
   - Updated Google-shaped callback route test to verify full sign-in flow with `iss=https%3A%2F%2Faccounts.google.com`.
   - Added route and parser tests for duplicate `iss`, raw-percent-encoded duplicate `%69ss`, control characters, oversized `iss`, and empty `iss`.
   - Added application-level tests verifying `iss` reaches `exchangeCodeAndValidateIdToken` and malformed `iss` is rejected prior to transaction consumption.
   - Added modular adapter tests verifying:
     - Exact matching issuer succeeds (`status: 'verified'`);
     - Missing issuer when provider requires it returns `status: 'invalid'`;
     - Mismatched issuer returns `status: 'invalid'`;
     - Protocol validation failure is classified as `status: 'invalid'`;
     - Actual network failure is classified as `status: 'unavailable'`;
     - Spy test proving the exact received callback issuer reaches `client.authorizationCodeGrant` validation.

## Verification Evidence

| Quality Gate       | Command                    | Status | Notes                                                    |
| ------------------ | -------------------------- | ------ | -------------------------------------------------------- |
| Format             | `pnpm format:check`        | PASSED | Prettier code style verified across all files            |
| Lint & Boundaries  | `pnpm lint`                | PASSED | ESLint clean, 466 modules cruised, 0 violations          |
| Typecheck          | `pnpm typecheck`           | PASSED | Clean across all 7 workspace projects                    |
| OpenAPI Schema     | `pnpm openapi:check`       | PASSED | `openapi/openapi.json` matches runtime schema            |
| Migrations         | `pnpm db:migrate:validate` | PASSED | 4 applied, 0 diff, checksums verified                    |
| Integration Tests  | `pnpm test:integration`    | PASSED | 11 test files, 110 tests passed against PostgreSQL       |
| Unit & Route Tests | `pnpm test`                | PASSED | 58 test files, 1115 tests passed (0 failures)            |
| Production Build   | `pnpm build`               | PASSED | Packages, Next.js web app, API, and worker built cleanly |
| Full Suite         | `pnpm check`               | PASSED | End-to-end composite check passed with code 0            |

## Unresolved Questions

None.
