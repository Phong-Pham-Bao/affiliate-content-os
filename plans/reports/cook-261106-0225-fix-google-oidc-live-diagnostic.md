# Implementation Report: Secret-Safe Google OIDC Live Diagnostic & Remediation

**Date**: 2026-11-06 02:25 (UTC+7)

**Task**: TASK-009 Google OIDC live diagnostic/remediation

**Type**: cook

**Branch**: main

## Executive Summary

Implemented an internal, secret-safe diagnostic classification layer around `authorizationCodeGrant` and OIDC callback processing for Google OIDC live integration. The system sanitizes hostile provider errors and prevents leakage of tokens, verifiers, client secrets, callback URLs, authorization codes, nonces, claims, headers, bodies, or stack traces. The diagnostic log outputs only a closed allowlisted category, status, and error, while preserving static RFC 9457 Problem Details responses (`OIDC_CALLBACK_INVALID`, `AUTH_NOT_CONFIGURED`, `OIDC_PROVIDER_UNAVAILABLE`). The API server is running with live diagnostic logging active on `http://127.0.0.1:3001`.

## Changes Made

1. **Secret-Safe Diagnostic Classifier (`packages/infrastructure/src/auth/oidc-grant-diagnostic.ts`)**:
   - Implemented 10 closed allowlisted categories:
     `oauth_invalid_grant`, `oauth_invalid_client`, `oauth_temporarily_unavailable`, `protocol_issuer_invalid`, `protocol_nonce_invalid`, `protocol_token_claim_invalid`, `protocol_timestamp_invalid`, `network_failure`, `timeout`, `unknown_safe`.
   - Sanitized `ResponseBodyError`: maps integer HTTP status (100–599) and allowlisted OAuth errors (`invalid_grant`, `invalid_client`, `invalid_request`, `unauthorized_client`, `unsupported_grant_type`, `invalid_scope`, `server_error`, `temporarily_unavailable`). Strictly drops raw bodies, headers, cause, error descriptions, secrets, and stack traces.
   - Sanitized `ClientError`: maps closed codes (`OAUTH_TIMEOUT`, `OAUTH_ABORT`, `OAUTH_JWT_TIMESTAMP_CHECK_FAILED`, `OAUTH_JWT_CLAIM_COMPARISON_FAILED`, `OAUTH_RESPONSE_IS_NOT_CONFORM`, `OAUTH_INVALID_RESPONSE`, `OAUTH_PARSE_ERROR`, `OAUTH_RESPONSE_IS_NOT_JSON`). Strictly drops message text and cause payloads containing claims or tokens.
   - Provided `defaultDiagnosticLogger` writing structured safe logs to `console.warn` without secret interpolation.
   - Modularized under 198 lines adhering to `< 200` line threshold.

2. **OIDC Adapter Integration & Discovery (`packages/infrastructure/src/auth/oidc-adapter.ts`, `oidc-adapter-discovery.ts`)**:
   - Integrated `classifyGrantError` and `mapDiagnosticOutcome` into `exchangeCodeAndValidateIdToken`.
   - Added category logging for post-grant claim checks (`protocol_issuer_invalid`, `protocol_token_claim_invalid`).
   - Added Google issuer equivalence (`https://accounts.google.com` vs legacy `accounts.google.com`), canonicalizing verified identity provider claims to `https://accounts.google.com`.
   - Decoupled discovery into `oidc-adapter-discovery.ts` (79 lines) to eliminate circular dependencies and keep `oidc-adapter.ts` at 134 lines.

3. **Application Layer Protocol Mapping (`packages/application/src/auth/ports.ts`, `complete-oidc-login.ts`, `complete-oidc-login-snapshots.ts`)**:
   - Extended `OidcExchangeResult` with `| { readonly status: 'configuration_unavailable' }`.
   - Mapped `invalid_client` to `configuration_unavailable`, translating to `AuthConfigurationUnavailableError` (HTTP 503 `AUTH_NOT_CONFIGURED`).
   - Mapped `invalid_grant`, `protocol_issuer_invalid`, `protocol_nonce_invalid`, and `protocol_token_claim_invalid` to `status: 'invalid'` (HTTP 400 `OIDC_CALLBACK_INVALID`).
   - Mapped network/timeout/temporarily unavailable errors to `status: 'unavailable'` (HTTP 503 `OIDC_PROVIDER_UNAVAILABLE`).

4. **Security & Unit Test Suite (`packages/infrastructure/test/unit/oidc-grant-diagnostic.unit.test.ts`)**:
   - 12 comprehensive unit tests verifying that hostile `ResponseBodyError` and `ClientError` containing sentinel secrets in error description, verifier, nonce, client secret, bearer token, claims, headers, and stack traces never leak into category or serialized log entries.
   - Verified that Google legacy ID-token issuer `accounts.google.com` is accepted as equivalent and canonicalized to `https://accounts.google.com`.
   - Proved outcome mapping for all allowlisted categories.

## Verification Evidence

| Quality Gate            | Command                                                                                | Status | Notes                                            |
| ----------------------- | -------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| Format                  | `pnpm format:check`                                                                    | PASSED | Prettier code style verified across all files    |
| Boundaries & Lint       | `pnpm lint`                                                                            | PASSED | ESLint clean, 473 modules cruised, 0 violations  |
| Typecheck               | `pnpm typecheck`                                                                       | PASSED | Clean across all 7 workspace projects            |
| Architecture Boundaries | `pnpm vitest run test/boundaries.test.ts`                                              | PASSED | 14 boundary tests passed                         |
| Unit Tests              | `pnpm vitest run packages/infrastructure/test/unit/oidc-grant-diagnostic.unit.test.ts` | PASSED | 12 security/diagnostic tests passed              |
| Full Unit Suite         | `pnpm test`                                                                            | PASSED | 59 test files, 1126 tests passed (0 failures)    |
| Integration Tests       | `pnpm test:integration`                                                                | PASSED | 11 test files, 110 tests passed against DB       |
| OpenAPI Schema          | `pnpm openapi:check`                                                                   | PASSED | Runtime schemas match openapi/openapi.json       |
| Production Build        | `pnpm build`                                                                           | PASSED | All workspace packages and applications compiled |
