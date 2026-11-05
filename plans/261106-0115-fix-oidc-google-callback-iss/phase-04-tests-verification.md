# Phase 04: Tests & Verification

## Objective

Comprehensive test coverage for all requirements and full quality-gate verification.

## Test Scenarios

1. Route test: Actual Google-shaped callback with `iss=https%3A%2F%2Faccounts.google.com`.
2. Parser & route tests:
   - Duplicate raw & percent-encoded `iss` (`iss=...&iss=...` and `iss=...&%69ss=...`).
   - Control characters in `iss` (`iss=https%3A%2F%2Faccounts.google.com%0A`).
   - Oversized `iss` (> 2048 chars).
3. Adapter tests:
   - Valid exact issuer matching discovery.
   - Missing issuer when provider requires it (`authorization_response_iss_parameter_supported=true`) -> status: 'invalid'.
   - Mismatched issuer (`iss=https://evil.com`) -> status: 'invalid'.
   - Protocol validation failure classified as invalid.
   - Actual network/token endpoint failure classified as unavailable.
   - Spy on `client.authorizationCodeGrant` proving the exact callback issuer reaches validation.
4. Quality Gates:
   - Format: `pnpm format:check`
   - Lint & Boundaries: `pnpm lint`
   - Typecheck: `pnpm typecheck`
   - OpenAPI: `pnpm openapi:check`
   - Migrations: `pnpm db:migrate:validate`
   - Unit & Integration Tests: `pnpm test`
   - Build: `pnpm build`
