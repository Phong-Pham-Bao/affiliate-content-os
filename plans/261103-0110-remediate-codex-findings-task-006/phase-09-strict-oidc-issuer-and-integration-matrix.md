# Phase 09: Strict Test OIDC Issuer & Integration Matrix

## Context Links

- [test-oidc-issuer.ts](../../packages/infrastructure/test/helpers/test-oidc-issuer.ts)
- [oidc-session-lifecycle.integration.test.ts](../../packages/infrastructure/test/integration/oidc-session-lifecycle.integration.test.ts)
- [postgres-auth-adapters.integration.test.ts](../../packages/infrastructure/test/integration/postgres-auth-adapters.integration.test.ts)

## Overview

- Priority: HIGH
- Status: Pending
- Goal: Enforce strict client auth, redirect URI, authorization code, and PKCE in test issuer; run complete integration matrix.

## Requirements

- Test issuer strictly checks Basic auth (rejects if missing/wrong), redirect_uri, code, and S256 code_verifier.
- Integration tests cover production-like composition, replay, concurrency, forced rotation schedules, expiry, and logout.

## Implementation Steps

1. In `test-oidc-issuer.ts`: implement strict validation of client authentication header, redirect_uri, code, and PKCE S256 challenge.
2. In integration test suites: add tests covering all required schedules, edge cases, and protocol violations.
3. Verify all integration tests pass against real PostgreSQL.
