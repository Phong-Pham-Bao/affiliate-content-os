# TASK-016 Remediation 01 — Credential binding, OAuth fencing, and production safety

## Objective

Repair the blocking correctness and security defects found by Codex in commit
`f98b6ec3edded925eb2e05b3d6fdb6dfa5b87893` so Sprint 4 Checkpoint A satisfies
`TASK-016`. Preserve the modular monolith and the useful domain/API/UI
foundation, but do not carry forward false idempotency, fake-production wiring,
or callback concurrency claims.

## Context

Codex reviewed the actual `268129f..f98b6ec` diff, not only the implementation
summary. Quality gates pass, but the following blocking defects remain.

### CRITICAL — Stored credentials are cryptographically bound to the wrong ID

`completeSocialCallback` encrypts tokens with a fresh `crypto.randomUUID()` as
AAD input. `executeCompleteOAuthCallbackTransaction` ignores that ID: it either
generates a different UUIDv7 for a new account or updates an existing account.
The ciphertext is therefore stored under an account ID different from the AAD
used to encrypt it and cannot be decrypted for later refresh/publishing.

### CRITICAL — Fake/local security wiring is not fail-closed

`apps/api/src/main.ts` always constructs and registers fake Threads/TikTok
adapters regardless of `fakeAdapterEnabled`. With a production KMS configuration
the credential protector becomes `undefined as never`, while fake adapters are
still registered. The public fake provider page is also not runtime-gated and
accepts an arbitrary `redirect_uri`, creating an app-hosted open redirect.

### HIGH — A callback can exchange one authorization code more than once

The application reads a pending transaction, performs the provider exchange,
then attempts to consume the transaction inside a later database transaction.
Concurrent callbacks can both reach `exchangeCode`; only the later database
write is fenced. `TASK-016` requires at most one exchange/account write.
Provider-denied callbacks also update without locking or checking the affected
row and can create multiple failure results/audit events.

### HIGH — Authorize is not idempotent in production

The handler parses and hashes `Idempotency-Key`, but the production route
provider does not supply `idempotencyStore`, and no atomic write stores the
authorize response. Reusing a key therefore creates another state/transaction.

### HIGH — PKCE is declared but nonfunctional

The adapter contract may return `codeVerifier`, and migration `0014` has PKCE
columns, but authorize saves the transaction before URL creation, ignores the
verifier, always persists null PKCE fields, and callback never supplies a
verifier to `exchangeCode`.

### HIGH — Callback-result and error boundaries are too broad

Callback result consumption is scoped only to workspace membership and result
key, not the initiating user. Provider-controlled `error` and
`error_description` values are stored and returned to the browser instead of an
allowlisted safe category/message.

### HIGH — Required concurrency and E2E evidence is missing

The test named “converges concurrent duplicate connections” awaits completion 1
and then completion 2 sequentially. The Playwright change only mocks the new
list endpoint in an existing Sprint 3 test; it does not exercise the fake
authorize → callback → result → account-list flow required by `TASK-016`.

### MEDIUM — API/UI state and redirect validation are incomplete

The API response schema omits `connecting` even though persistence/domain/UI
requirements include it and `capabilitiesCheckedAt` can be null. The browser
accepts any HTTP(S) authorization origin returned by the server rather than an
explicit allowed provider/local origin.

## Required implementation

### 1. Fix exact credential/AAD binding

- The exact account ID used in credential AAD must be the same ID used in
  `social_credentials.social_account_id` and the associated `social_accounts`
  row for both new and existing accounts.
- Choose/reserve/resolve the target account ID before encryption, or move the
  narrow encryption operation into an infrastructure completion boundary that
  knows the authoritative account ID. Do not pass plaintext tokens through
  general repositories, logs, queues, audit, or DTOs.
- Use UUIDv7 for newly created account IDs. Remove `crypto.randomUUID()` from
  the social account identity path.
- Add an integration test that reads the stored credential row through a
  narrow test helper and successfully decrypts it using the persisted
  workspace/account/platform identity. Cover an existing-account rotation too.
- Add negative AAD substitution tests against the persisted result.

### 2. Claim/fence callback before provider exchange

- Add an atomic persistence operation that validates state hash, platform,
  expiry, status/version and transitions one pending transaction into a single
  claimed/exchanging state before any external exchange call.
- Modify migration `0014` (this checkpoint is unmerged/unreleased) to model the
  claim state/timestamp/version and any bounded recovery data needed. Do not add
  migration `0015` and do not modify migrations `0001`–`0013`.
- Only the successful claimant receives the transaction secrets and may call
  `exchangeCode`. Concurrent/replayed callbacks fail before the adapter call.
- Final success/failure must compare-and-swap from the claimed state and create
  at most one callback result and one terminal audit outcome.
- Provider-denied callbacks must use the same atomic fencing discipline; zero
  affected rows is a replay/conflict, not permission to insert another result.
- Define safe behavior if the claimant crashes or exchange times out. A bounded
  claim expiry may allow operator/recovery handling, but it must never permit a
  blind second token exchange whose remote outcome is uncertain.
- Replace the sequential “concurrent” test with real concurrent promises and
  assert the provider exchange spy/counter is exactly one.

### 3. Implement PKCE round-trip correctly

- Create the authorization URL before persistence if the adapter produces PKCE
  material, but do not return the URL unless durable transaction persistence
  succeeds.
- Protect the verifier with a dedicated OAuth-transaction secret/AAD purpose;
  do not reuse credential ciphertext implicitly or store plaintext.
- Persist verifier ciphertext/IV/tag/key version and map it through the
  transaction snapshot/claim result.
- Decrypt only for the winning callback claimant and pass the verifier to
  `exchangeCode`. The fake adapter may explicitly return no verifier and tests
  must not pretend it validated one.
- Add adapter-contract and persistence tests for both PKCE and non-PKCE flows,
  tamper/wrong-transaction AAD, and absence from API/log/audit output.

### 4. Make authorize idempotency atomic and production-wired

- Implement authorize idempotency inside the same transaction that persists the
  OAuth transaction and its safe response/response reconstruction data.
- Scope by workspace, principal, route, and key hash; bind a canonical request
  hash. Same key + same request returns the original transaction/state-derived
  authorization response without creating another transaction. Same key +
  different request returns `409 IDEMPOTENCY_KEY_REUSED`.
- Concurrent duplicate requests must produce exactly one transaction and one
  response. Do not implement this as an optional cache lookup followed by an
  uncoordinated insert.
- Wire the production PostgreSQL adapter; remove optional behavior that silently
  disables idempotency.
- Add real PostgreSQL concurrent idempotency tests and route-level replay tests.

### 5. Enforce fake/local and production configuration

- Instantiate/register `FakeSocialAuthAdapter` only when the explicit fake flag
  is true and the effective environment is non-production.
- When social auth is disabled, do not construct an unusable protector or fake
  adapter and do not rely on `undefined as never`.
- Because no managed KMS implementation exists in this checkpoint, production
  with social auth enabled must fail startup/config validation clearly rather
  than accepting `SOCIAL_KEY_PROVIDER=kms` and later crashing or falling back.
- Runtime-gate the fake provider page so production cannot use it. Validate its
  redirect target against the exact configured same-origin callback path before
  navigation; arbitrary HTTP(S) `redirect_uri` input must not create an open
  redirect.
- Add startup/config tests proving: fake flag false registers no fake adapters;
  production cannot activate fake/local paths; disabled mode is safe; enabled
  local/test mode has a real protector and explicit adapters.

### 6. Bind callback result and sanitize failures

- Bind callback results to the initiating user in persistence and in the atomic
  consume predicate, in addition to workspace and hashed result key.
- A different member of the same workspace cannot consume another user's
  result. Add unit/API/PostgreSQL tests.
- Map provider denial/failure to a closed allowlist of internal error codes and
  fixed safe user-facing descriptions. Do not persist or return raw
  provider/caller `error_description` text.
- Bound error code/description columns and add relational uniqueness so a
  transaction cannot have multiple terminal callback results.
- Audit authorize-started, claimed/replay-rejected, completed, and failed events
  with fixed reason codes and allowlisted metadata only.

### 7. Complete API/UI contract and redirect validation

- Align runtime/OpenAPI/browser validators for every account state, including
  `connecting`, and nullable capability freshness where the database permits
  it; alternatively strengthen persistence so impossible states truly cannot
  exist. Do not leave contradictory contracts.
- Validate authorization URL against adapter/config-owned allowed origins and
  paths. A syntactically valid arbitrary HTTPS URL is insufficient.
- Keep fake/local labeling explicit and never display a real-success claim for
  a fake account.
- Preserve accessibility, keyboard behavior, live announcements, focus
  visibility, safe error handling, and non-destructive retry.

### 8. Add truthful full-flow evidence

- Add Playwright coverage for the actual local fake flow: owner connects,
  authorize/deny callback lands with opaque result, result is consumed once,
  list refreshes, and fake/local account/status is visibly honest.
- Cover editor/viewer inability to initiate and a failure/expired/replayed
  result path at the nearest appropriate layer.
- Do not label sequential calls as concurrency. Concurrency tests must overlap
  at a controlled barrier and assert exact external-call/write counts.

## Expected files

Primarily the existing TASK-016 social domain/application/infrastructure/API/
web/config/test files, migration `0014`, OpenAPI, and a new focused E2E spec or
cohesive extension. Keep unrelated Sprint 3 files unchanged except for minimal
test-harness routing when strictly required.

Do not stage or modify unrelated untracked `plans/` content or
`packages/application/src/workforce/affiliate-content-os.code-workspace`.

## Database changes

Modify only forward-only migration `0014_social_connections_foundation.sql`
because Checkpoint A is not merged/released. Add the callback claim/fencing,
actor binding, terminal-result uniqueness, safe bounds, and atomic authorize
idempotency support required above. Do not alter migrations `0001`–`0013`.

## API changes

Preserve the approved TASK-016 route surface. Correct idempotency, result actor
binding, safe errors, status schemas, and authorization URL validation. Do not
add publication or account lifecycle commands.

## Frontend changes

Correct provider URL validation and fake page gating/open-redirect behavior;
align account states and add real fake-flow E2E coverage. No Calendar or
publishing UI.

## Backend changes

Repair callback claim/finalization, PKCE persistence/protection, exact credential
AAD identity, atomic authorize idempotency, production composition, safe error
mapping, audit, and database constraints/tests.

## Security requirements

- One state permits at most one adapter exchange call, even under concurrent
  requests, denial callbacks, retries, or replay.
- Stored tokens decrypt only with the authoritative persisted resource identity.
- Fake adapters/pages and local keys cannot run in production.
- No raw state, code, verifier, token, ciphertext, provider body, raw provider
  error, or key material appears in responses/logs/audit/snapshots.
- Callback result consumption requires exact workspace, initiating actor, and
  hashed opaque result key.
- No open redirects or client-selected provider origins/scopes/callbacks.

## Edge cases

- Adapter URL construction succeeds but transaction/idempotency persistence
  fails; no URL is returned and no false success is cached.
- Two authorize requests with the same key overlap.
- Two success callbacks overlap at the claim barrier.
- Success and denial callbacks race for the same state.
- Exchange times out after the provider may have accepted the code.
- New and existing account credential binding/rotation.
- PKCE adapter vs non-PKCE fake adapter.
- Wrong actor in the same workspace attempts to consume a result.
- Fake flag false, social disabled, production local key, production fake flag,
  and unsupported KMS composition.
- Hostile error/description/display/capability values and oversized arrays.

## Acceptance criteria

1. New and rotated stored credentials decrypt with the exact persisted account
   identity; AAD substitution fails.
2. Concurrent callbacks cause exactly one adapter exchange and at most one
   account/result/audit terminal write.
3. PKCE verifier is encrypted, persisted, claimant-only, passed to exchange,
   and never exposed; non-PKCE fake flow remains truthful.
4. Authorize idempotency is atomic, PostgreSQL-backed, production-wired, and
   correct for replay, mismatch, and concurrent duplicates.
5. Production cannot instantiate fake/local security paths or an undefined
   protector; unsupported production KMS fails clearly at startup.
6. Callback results are initiating-actor-bound and provider failures expose only
   fixed safe codes/messages.
7. Runtime schemas, OpenAPI, browser validators, database states, and UI agree.
8. A real Playwright fake-connection flow passes; concurrency tests truly
   overlap and assert external call counts.
9. All original TASK-016 acceptance criteria pass with no scheduling,
   publishing, real provider call, TikTok posting, analytics, or scope expansion.

## Test plan

Add focused regression tests for every finding, then run:

- `pnpm check`
- `pnpm test:integration`
- `pnpm db:migrate:validate` twice
- `pnpm test:e2e`
- `git diff --check f98b6ec..HEAD`
- secret/token/verifier/ciphertext response and log scan

Report exact commands, exit codes, counts, commit SHA, and deviations. Codex
will review the actual remediation diff and rerun proportionate gates.

## Out of scope

- Real Threads/TikTok adapters or external network calls.
- Refresh/reconnect/disconnect, scheduling, publication workers, reconciliation,
  analytics, media generation, or later Sprint 4 checkpoints.
- Production KMS vendor implementation, microservices, Kafka, or a second
  database.
