# TASK-016 — Sprint 4 Checkpoint A: Social connection foundation

## Objective

Implement the secure, tenant-scoped foundation for social account connections:
domain/application contracts, PostgreSQL persistence, encrypted credentials,
one-time OAuth transactions, owner-only APIs, a deterministic fake adapter, and
an accessible Connections UI. This checkpoint proves the OAuth lifecycle
without enabling real external publishing.

## Context

Sprint 3 is complete and approved at `c79ca34`. It ends with immutable human
approval snapshots and explicitly contains no social OAuth or publishing.

Read before implementation:

- `AGENTS.md`
- `docs/SPRINT-4-SOCIAL-PUBLISHING-PLAN.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/DECISIONS.md`, especially ADR-005, ADR-006, ADR-007, ADR-010,
  ADR-011, ADR-017, ADR-019, ADR-020, and ADR-021
- the actual authentication, authorization, audit, idempotency, configuration,
  migration, API bootstrap, and App Shell implementations

Existing application OIDC is not reusable as social identity. Reuse its proven
security patterns where appropriate, but social authorization has distinct
transactions, adapters, credentials, and account records.

## Required implementation

### 1. Domain and application contracts

- Add typed social platform/account/status/capability/value objects with strict
  runtime validation and closed state sets.
- Define provider-neutral `SocialAuthAdapter` behavior for:
  authorization request creation, callback code exchange, provider identity
  lookup, granted-scope/capability discovery, and optional revocation.
- Define application persistence/transaction ports without importing provider
  SDK or HTTP payload types outside infrastructure.
- Implement use cases for:
  list social accounts; begin authorization; complete callback; and retrieve a
  safe opaque callback result for the authenticated initiating workspace.
- Authorization start requires `social_accounts.manage` (owner). Listing
  requires an active workspace member with the existing read policy selected
  consistently with `docs/API.md`.
- The public callback derives workspace, actor, platform, redirect and return
  target only from the stored transaction. It never trusts caller-supplied
  workspace/account/return URLs.

### 2. OAuth transaction security

- Generate high-entropy state using a cryptographically secure RNG. Persist a
  fixed-length hash, never raw state.
- Transactions are short-lived, single-use, platform-bound, workspace-bound,
  actor-bound, exact-redirect-bound, and status/version constrained.
- Validate/consume state atomically before accepting the authorization code.
  Concurrent callbacks and replay must produce at most one exchange/account
  write. Expired, mismatched, malformed, replayed, or provider-denied callbacks
  fail closed with safe errors.
- Support PKCE fields in the contract/persistence where applicable. If the fake
  provider does not require PKCE, do not fake that it validated PKCE.
- Only server-defined scopes and redirect URIs are accepted. Do not accept raw
  client scopes, provider endpoints, callback URLs, or post-login return URLs.
- Callback redirects expose only an opaque result key. Authenticated lookup
  returns allowlisted status/recovery details; raw provider errors are not sent
  to the browser.
- Apply a bounded unauthenticated callback rate-limit hook compatible with the
  existing modular monolith. Do not invent a distributed store in this task.

### 3. Credential protection

- Add a dedicated social credential protector using authenticated encryption,
  per-record random nonce/IV, key version, and AAD binding at least the account,
  workspace, platform, and credential purpose.
- Do not reuse login-transaction ciphertext formats or keys implicitly.
- Local/test configuration may use an explicit non-production base64url key.
  Production configuration must fail closed unless a production-approved key
  provider/configuration is present; document the managed-KMS boundary rather
  than pretending a local key is KMS.
- Decryption exists only in a narrow credential repository/adapter path.
- Tokens and authorization codes must never appear in DTOs, serializers,
  Problem Details, logs, audit metadata, snapshots, queue payloads, test
  snapshots, or thrown error messages.

### 4. Fake adapter

- Implement a deterministic fake social auth adapter for local/test use behind
  an explicit non-production configuration switch.
- It must produce an allowlisted fake authorization origin/path, exchange a
  bounded opaque fake code, return deterministic provider identity/scopes/
  capabilities, and support failure modes needed by tests.
- It must never masquerade as a real Threads connection. UI/API responses label
  its platform environment as local/test where exposed.
- Production startup must reject fake-adapter enablement.

### 5. Persistence and atomicity

- Add forward-only migration `0014_social_connections_foundation.sql`.
- Implement `social_accounts`, isolated `social_credentials`,
  `oauth_transactions`, and the minimum opaque callback-result persistence
  needed by this checkpoint.
- Use UUIDv7-compatible IDs and repository timestamp/version conventions.
- Enforce composite workspace foreign keys/uniqueness so cross-tenant joins
  cannot be represented accidentally.
- Enforce closed status/platform values, non-empty bounded strings, valid JSON
  shapes, key/hash/nonce/tag lengths, timestamp ordering, and version >= 1.
- Account identity becomes `active` only in the same transaction that persists
  confirmed provider identity, encrypted credentials, granted scopes,
  capabilities, transaction consumption, result, and audit/outbox evidence.
- Concurrent duplicate connections for the same active
  `(workspace, platform, provider_account_id)` converge safely. They must not
  create multiple active accounts or overwrite a different account's secret.
- General list/account queries must not select credential ciphertext columns.
- Add bounded cleanup eligibility/indexing for expired OAuth transactions and
  callback results; the cleanup job itself may be deferred.

### 6. API and OpenAPI

Implement under `/api/v1`:

- `GET /workspaces/{workspaceId}/social-accounts`
- `POST /workspaces/{workspaceId}/social-connections/{platform}/authorize`
- `GET /social-connections/{platform}/callback`
- one authenticated, workspace-scoped endpoint to consume/read the opaque
  callback result after redirect

Requirements:

- Authorize is owner-only and requires `Idempotency-Key`; same key/request
  replays the stored safe response and a different request hash returns `409`.
- Callback is public, strictly validates query multiplicity/size and rejects
  ambiguous duplicate `state`, `code`, `error`, or related fields.
- Browser/session CSRF rules remain correct: the callback is an OAuth protocol
  endpoint, while authenticated mutation/read routes preserve existing origin
  and session protections.
- Use RFC 9457 Problem Details with stable allowlisted codes and no provider
  secrets. Return accurate `401`, `403`, `404`, `409`, `410`, `422`, `429`, and
  `503` behavior where applicable.
- OpenAPI is generated from runtime schemas and contains no token fields.

### 7. Frontend

- Add an accessible Connections area integrated into the existing signed-in
  App Shell/workspace experience; do not create a disconnected demo page.
- Display loading, empty, connecting, active, degraded, reauth-required,
  review-gated, disconnected, stale-capability, error, and fake/local states
  truthfully using plain Vietnamese-friendly/clear product wording consistent
  with the current UI language strategy.
- Viewer/editor can view safe account state if allowed by the selected read
  policy; only owner sees/uses Connect.
- Connect uses a fresh cryptographic idempotency key and navigates only to the
  server-returned authorization URL after validating its allowed shape/origin.
- Callback landing consumes the opaque result through the authenticated API,
  refreshes the account list, and offers a clear next action.
- Keyboard navigation, visible focus, semantic status, screen-reader
  announcements, reduced-motion compatibility, modal/background isolation if a
  modal is used, and non-destructive retry are required.
- Never show/store a provider token or raw authorization code in component
  state, browser storage, telemetry, or errors.

### 8. Audit and observability

- Audit authorization started, connection completed/failed, and replay/rejected
  security-relevant events using allowlisted metadata only.
- Correlate start/callback/result without logging state, code, tokens, provider
  raw bodies, or ciphertext.
- Add useful counters/status hooks for OAuth start, completion categories,
  replay, expiry, provider failure, and encryption failure without adding a new
  observability vendor.

## Expected files

Expected changes are primarily in:

- `packages/domain/src/social/**` and exports/tests
- `packages/application/src/social/**` and tests
- `packages/infrastructure/src/social/**`, configuration/bootstrap, and tests
- `packages/infrastructure/migrations/0014_social_connections_foundation.sql`
- `packages/config/**` and `.env.example`
- `apps/api/src/social/**`, app/bootstrap wiring, route/OpenAPI tests
- `apps/web/src/components/connections/**`, API client/validators/types/tests,
  and App Shell integration
- `openapi/openapi.json`
- relevant canonical documentation

Keep files cohesive and within repository maintainability conventions. Do not
stage or modify unrelated untracked `plans/` content or
`packages/application/src/workforce/affiliate-content-os.code-workspace`.

## Database changes

Forward-only migration `0014` only. Do not rewrite migrations `0001`–`0013`.
The migration must be idempotency-validator compatible and pass the repository's
twice-run migration validation.

## API changes

The four route families listed above plus schemas, serializers, Problem Details,
and generated OpenAPI. No disconnect/reconnect/refresh or publication APIs yet.

## Frontend changes

Connections list and authorize/callback-result experience integrated into the
current application shell. No Calendar or publishing UI in this checkpoint.

## Backend changes

Social domain/application modules, PostgreSQL repositories/transactions,
credential crypto boundary, fake auth adapter, configuration, API wiring,
audit/metric hooks, and tests.

## Security requirements

- OAuth CSRF/state replay, transaction fixation, redirect injection, query
  pollution, cross-tenant IDOR, credential disclosure, log injection, hostile
  provider values, concurrent callback, and configuration downgrade must have
  explicit tests.
- Provider display names/handles are untrusted bounded Unicode strings and are
  rendered as text, never HTML.
- No secrets in Git. `.env.example` contains names/placeholders only.
- The fake provider and local encryption key path cannot run in production.
- Use constant-time comparison where secret-derived fixed-length values are
  compared outside the database.

## Edge cases

- User denies authorization or provider omits a required field.
- Missing, duplicate, oversized, malformed, expired, already-consumed, or
  wrong-platform state.
- Callback arrives concurrently twice or after the user begins a newer flow.
- Provider timeout before or after token issuance; do not claim success without
  confirmed identity and persisted credentials.
- Same provider identity connected twice in one workspace or in two different
  workspaces.
- Existing account is degraded/disconnected while a new transaction completes.
- Capability/scopes are empty, unknown, or contain hostile/unbounded values.
- Encryption/decryption fails, key version is unknown, or database commit
  aborts after exchange. No partial active account may remain.
- Browser refreshes callback landing or opaque result expires.

## Acceptance criteria

1. Migration `0014` creates strongly constrained, tenant-safe social account,
   credential, OAuth transaction, and callback-result persistence without
   changing earlier migrations.
2. Owner can start a fake/local authorization and complete it through the
   public callback into exactly one active fake account; viewer/editor cannot
   start it.
3. Listing exposes identity, safe status, granted scopes/capabilities and
   freshness only; no credential, state, code, ciphertext, provider raw body,
   or secret-derived value crosses the API/browser/log/audit boundary.
4. Expired/replayed/malformed/mismatched/concurrent callbacks fail closed; one
   state produces at most one exchange and one committed account result.
5. Cross-workspace access and cross-tenant relational substitution are rejected
   by application authorization and database constraints.
6. Credential encryption uses resource-bound AAD/key versioning and production
   rejects fake/local-only security configuration.
7. API runtime schemas and generated OpenAPI match, authorize is idempotent,
   and safe Problem Details/status codes cover expected failure classes.
8. Connections UI is integrated, accessible, role-aware, honest about fake vs
   real state, and resilient to refresh/error without displaying false success.
9. Unit, adversarial, PostgreSQL integration, API, frontend accessibility, and
   fake end-to-end tests demonstrate the complete checkpoint flow.
10. No publication, scheduling, real Threads network call, TikTok behavior,
    analytics, unofficial API, autonomous action, or infrastructure redesign is
    introduced.

## Test plan

Antigravity must add and run:

- domain/application unit tests for validation, authorization, idempotency, and
  every transaction transition;
- crypto round-trip, AAD substitution, tamper, wrong-key-version, and redaction
  tests;
- adapter contract tests for deterministic fake success/failure modes;
- API route/schema/query-pollution/Problem Details/OpenAPI tests;
- frontend validator, role/state, keyboard, screen-reader, error/retry, and
  callback-result tests;
- real PostgreSQL migration, isolation, uniqueness, replay, concurrent callback,
  rollback, and ciphertext-boundary integration tests;
- a Playwright fake-connection flow if the existing test harness can support it
  without weakening authentication; otherwise document the bounded reason and
  provide the closest full-stack automated evidence for Codex review.

Required gates before handoff:

- `pnpm check`
- `pnpm test:integration`
- `pnpm db:migrate:validate` twice
- relevant `pnpm test:e2e` coverage added by this task
- `git diff --check c79ca34..HEAD`
- secret scan of the changed diff and explicit token/ciphertext response scan

Report exact commands, exit codes, test counts where available, final commit,
changed areas, and any deviation. Do not claim a gate passed unless it ran.

## Out of scope

- Real Threads or TikTok provider network calls.
- Refresh/reconnect/disconnect/revocation commands beyond the adapter contract.
- Publication approvals, consents, schedules, workers, attempts, remote posts,
  retries, reconciliation, analytics, or Calendar UI.
- Production KMS vendor selection or cloud deployment.
- Media upload/generation/editing, engagement automation, scraping, unofficial
  APIs, browser automation, microservices, Kafka, or a second database.
