# Implementation Report: Fix Google OIDC Callback Parameters (RFC 6749)

**Date**: 2026-11-06 00:48 (UTC+7)

**Task**: TASK-009 Checkpoint A blocker

**Type**: cook

**Branch**: main

## Executive Summary

Resolved Checkpoint A blocker where Google OIDC callbacks including `scope`, `authuser`, `prompt`, and `hd` failed with `OIDC_CALLBACK_INVALID` before transaction consumption. Implemented RFC 6749 Section 4.1.2 compliance: unrecognized response parameters are safely ignored while continuing strict validation of URL encoding, duplicates, control characters, bounds, code/error mutual exclusivity, and mandatory state. Only allowlisted core fields (`code`, `state` or `error`, `state`, `error_description`, `error_uri`) pass to `completeOidcLogin`.

## Changes Made

1. **Modular Parser Extraction (`apps/api/src/auth/callback-url-parser.ts`)**:
   - Extracted `parseAndValidateRawCallback` to modular file (162 lines) to keep `callback-route.ts` under 100 lines (modularization rule).
   - Validates URL structure: requires `?`, forbids `#`, `;`, `&&`, leading/trailing `&`.
   - Bounded query length (<= 16384 bytes) and pair count (<= 32).
   - Strict percent-encoding check: all `%` followed by two valid hex digits.
   - Strict duplicate key checks (raw and decoded) across both core and unrecognized parameters.
   - Strict C0 control (0x00-0x1F) and DEL (0x7F) rejection in all keys and values.
   - Bounded key (1..256) and value (<= 4096) lengths.
   - Rejects hostile prototype keys (`__proto__`, `constructor`, `prototype`).
   - Validates core fields: `code` XOR `error`, required `state` (1..4096), forbids `error_description`/`error_uri` when `code` is present.
   - Safely ignores unrecognized response parameters (e.g. `scope`, `authuser`, `prompt`, `hd`) per RFC 6749.
   - Extracts and returns only allowlisted core fields in null-prototype object.

2. **Schema & Route Integration (`apps/api/src/auth/schemas.ts`, `apps/api/src/auth/callback-route.ts`)**:
   - Updated `callbackRouteSchema.querystring`: `additionalProperties: true` so Fastify allows unrecognized query parameters into `preValidation` and route handler.
   - `callback-route.ts` consumes `parseAndValidateRawCallback`, passing only allowlisted core fields into `completeOidcLogin`.

3. **Public Auth Exports (`apps/api/src/auth/index.ts`)**:
   - Exported `callback-url-parser.js`.

4. **Test Suite (`apps/api/test/auth-callback-route.unit.test.ts`, `apps/api/test/callback-url-parser.unit.test.ts`)**:
   - Added Google-shaped callback route test with `code`, `state`, `scope`, `authuser`, `prompt`, `hd`. Verified 303 redirect, session cookie set, transaction cookie cleared, transaction consumed with exact state/cookie hashes, and code exchanged.
   - Added RFC 6749 unrecognized parameter handling test.
   - Retained and expanded rejection tests for duplicates (including unrecognized keys and percent-encoded duplicates), malformed percent-encoding, missing state, code+error conflicts, and hostile values (control characters, prototype keys, oversized keys/values, separators).
   - Added 12 unit tests in `callback-url-parser.unit.test.ts`.

## Verification Evidence

| Quality Gate   | Command                    | Status | Notes                                                    |
| -------------- | -------------------------- | ------ | -------------------------------------------------------- |
| Format         | `pnpm format:check`        | PASSED | Prettier code style verified                             |
| Lint           | `pnpm lint`                | PASSED | ESLint clean, 0 warnings/errors                          |
| Boundaries     | `pnpm lint:boundaries`     | PASSED | 454 modules, 1115 dependencies, 0 violations             |
| Typecheck      | `pnpm typecheck`           | PASSED | TypeScript strict mode clean across all 7 projects       |
| OpenAPI Schema | `pnpm openapi:check`       | PASSED | Runtime schema matches `openapi/openapi.json`            |
| Migrations     | `pnpm db:migrate:validate` | PASSED | 4 migrations applied, 0 diff, checksums verified         |
| Unit Tests     | `pnpm test`                | PASSED | 57 test files passed, 1104 tests passed (0 failures)     |
| Build          | `pnpm build`               | PASSED | Packages, Next.js web app, API, and worker built cleanly |

## Unresolved Questions

None.
