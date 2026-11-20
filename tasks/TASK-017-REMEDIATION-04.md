# TASK-017-REMEDIATION-04 — Close terminal replay and stale-lease side-effect gaps

## Objective

Fix the remaining CRITICAL/HIGH defects found by Codex in actual commit
`99804e5`. This is a narrow final remediation for terminal idempotency replay,
provider-timeout uncertainty, compatible lease budgets, fenced transition
results, and revocation-secret disposal.

## Context

Remediation 03 correctly introduced official Meta `/debug_token` inspection,
truthful HTTP 202 responses, explicit operation phases, composite tenant keys,
durable revocation staging, worker wiring, and broad tests. Actual code review
found the following blocking gaps:

1. `executeSocialAccountMutationWithIdempotency()` reclaims every `failed`
   operation. After an expired `provider_attempt_started` operation is converted
   to terminal `OUTCOME_UNKNOWN`, the next retry with the same key resets it to
   `pending` and can call the provider again. The current test checks only the
   first recovery request, not a second replay.
2. `executeClaimedSocialAccountRefresh()` treats
   `SocialAuthOutcomeUnknownError` from `refreshToken()` as an ordinary transient
   failure, records `degraded`, and permits later automated/manual refresh. A
   provider may have rotated the token before the timeout, so this can duplicate
   a non-idempotent call.
3. Manual operation lease is derived from only two HTTP timeouts, the account
   refresh lease is derived separately and can be shorter, and maintenance still
   defaults to 120 seconds. The actual worst-case refresh path can perform token
   refresh plus profile inspection, app-token acquisition, and `/debug_token`
   inspection. At the allowed 60-second timeout the current leases can expire
   while one valid sequence is still running.
4. Fenced SQL transitions use `WHERE lease_token = ...` but persistence methods
   ignore `rowCount`. A stale owner can continue to the provider call after
   `mark...AttemptStarted` updates zero rows. Revocation completion/failure also
   updates the account result even when the job transition updated zero rows.
5. Supported disconnect uses `INSERT ... SELECT` to stage a revocation job but
   does not require one inserted row. Missing credentials can produce a locally
   disconnected account that says revocation is pending with no durable job.
6. Terminal failed revocation jobs retain encrypted token material indefinitely.
   No bounded retention/recovery policy exists, despite the job being terminal.
7. Revocation defaults to a fixed 60-second lease and has no application-level
   bounded call timeout for future/test adapters. A hanging call can outlive the
   lease and be duplicated by another worker.
8. Migration 0018 lacks revocation phase/status, terminal timestamp, lease,
   attempt-count, and bounded-field consistency constraints.
9. Meta debug parsing truncates scope arrays over 50 items instead of rejecting
   the malformed observation, and expiry is only positive/safe-integer rather
   than bounded. Oversized observations can still prove grants if the required
   scopes appear early.

Read `AGENTS.md`, TASK-017 and all remediation specifications, then inspect the
actual `c852e58..99804e5` code and tests before editing.

## Required implementation

### 1. Terminal idempotency failures are replayed, never reclaimed

- A terminal failed operation with the same key/hash must replay its persisted,
  allowlisted safe failure until expiry. It must not reset to `pending` or invoke
  the mutation/provider again.
- Reconstruct only typed internal errors from a closed error-code mapping. Never
  replay raw persisted text as an exception message. `OUTCOME_UNKNOWN` must map
  to `SocialAuthOutcomeUnknownError`; unknown codes map to a fixed internal safe
  error.
- Retrying with a different idempotency key must still be blocked from refresh
  when the account is in the reauthorization state caused by outcome uncertainty.
  Reconnect/reauthorization is the recovery path.
- Add a PostgreSQL test that performs: expired provider-attempt operation -> first
  recovery -> second and third same-key replay -> different-key manual attempt.
  Assert provider-call count remains exactly zero throughout recovery and the
  operation/audit/account counts remain stable.

### 2. Treat refresh provider timeout as outcome unknown

- Special-case `SocialAuthOutcomeUnknownError` thrown by `refreshToken()`.
  Atomically release/fence the refresh claim, set the account to a safe
  reauthorization/review state, and terminally fail the idempotency operation
  with `OUTCOME_UNKNOWN`. Do not return an HTTP 200 degraded success.
- Automated maintenance must not select it again, and manual refresh must not
  call the provider. Reconnect is required unless a documented provider-safe
  reconciliation path is implemented.
- Distinguish this from an inspection timeout after `refreshToken()` returned a
  definite replacement token; that path may preserve the rotated credential and
  stale capability evidence as already designed.
- Add failure injection for timeout after attempt-start and assert no subsequent
  same-key, new-key, manual, or maintenance provider call.

### 3. One shared worst-case lease budget

- Create one tested provider-sequence lease derivation used by API operation
  claim, manual account refresh claim, maintenance account claim, and revocation
  worker claim as applicable.
- Refresh budget must cover the maximum bounded sequence: refresh call, profile
  call, optional app-token call, debug-token call, plus local processing margin.
  Use the configured per-request timeout and a documented maximum call count.
- Operation and account refresh leases for the same manual request must be equal
  or otherwise proven compatible. Maintenance must not retain a fixed 120-second
  default independent of provider configuration.
- Revocation lease must exceed its enforced provider-call timeout plus margin.
  Add an application-level timeout wrapper for adapters that do not return. A
  timed-out attempt becomes terminal outcome-unknown and is never retried; do
  not assume provider cancellation or idempotency.
- Add controlled-time/barrier tests at the maximum configured timeout proving a
  second manual request, different key, and second worker cannot call provider.

### 4. Check every fenced transition result

- `markOperationAttemptStarted`, `markSocialAccountRevocationAttemptStarted`,
  operation completion/failure, and revocation completion/failure must expose and
  validate whether exactly one owned row transitioned.
- A zero-row transition throws a typed safe lease/fence-lost error before any
  provider call or dependent account update. A stale owner cannot continue.
- In revocation terminal transactions, update
  `social_accounts.external_revocation_result` only after the owned job row was
  transitioned successfully in that same transaction.
- Check atomic refresh/disconnect operation-completion row counts when supplied.
  Failure rolls back the account/credential/audit transaction.
- Add stale-token PostgreSQL tests for every transition and exact provider-call,
  account-version, audit, and job-status counts.

### 5. Require a durable revocation handoff and dispose terminal secrets

- Supported disconnect must require exactly one encrypted credential row to be
  copied into exactly one revocation job before deleting the active credential.
  Zero or multiple staged rows fail and roll back local disconnect; never report
  `pending` without a job.
- Add a unique active-job rule appropriate to the lifecycle so repeated/concurrent
  disconnect cannot create multiple provider revocations.
- Wipe encrypted token, IV, auth tag, and any other secret-bearing staged fields
  on every terminal result, including failed and outcome-unknown. Because the
  current implementation makes failures terminal, it has no reason to retain
  token material.
- Test successful, provider-failed, outcome-unknown, crypto-failed, missing-
  credential, and stale-owner paths. Assert terminal secret columns contain only
  the defined wiped sentinel and cannot decrypt.

### 6. Forward-only schema hardening

- Add migration `0019_threads_final_fencing.sql`. Do not edit migrations
  `0015`-`0018`.
- Constrain revocation phase/status combinations, terminal `completed_at`, active
  lease/worker/token consistency, lease/timestamp ordering, nonnegative bounded
  attempt count, platform/key-version/worker/token bounds, and terminal error
  consistency.
- Add the active-job uniqueness/index needed by the handoff design.
- Migration tests must reject invalid combinations and validate all 19 migrations
  twice from clean databases.

### 7. Strict Meta observation bounds

- Reject, rather than truncate, a `data.scopes` array above the supported item
  limit. Reject non-string, oversized, or control-character scope items when they
  make the observation malformed; never allow a malformed response to prove
  grants.
- Bound `expires_at` to a documented plausible Unix timestamp range and validate
  it consistently. Bound app-access-token response length/control characters.
- Preserve allowlist filtering for well-formed unknown scopes and exact app/user
  matching. Add contract tests for oversized arrays, malformed items, far-future
  expiry, and oversized/control app tokens.

### 8. Observable worker failures

- Do not silently swallow unexpected maintenance/revocation errors in the worker
  loop. Record a secret-safe structured error/counter through the existing worker
  logging/observation convention while keeping the loop alive where safe.
- Never log provider payloads, URLs containing tokens, exception messages from
  provider transports, or staged credential fields.

## Expected files

Application lifecycle errors/ports/refresh/maintenance/revocation services;
PostgreSQL mutation, refresh, disconnect, revocation repositories/statements;
migration `0019`; API lease composition if needed; worker composition and safe
observation; Threads adapter validation; focused unit/integration/concurrency/
failure-injection tests. Generated OpenAPI should change only if public behavior
requires it.

Preserve unrelated untracked files and user plans. Do not stage them.

## Database changes

Forward-only `0019_threads_final_fencing.sql` only. Validate all 19 migrations
twice. Existing committed migrations are immutable.

## API changes

Preserve the truthful 202 contract. Terminal same-key failures must converge on
the same safe error response; no internal row/lease token or provider diagnostic
may cross the boundary.

## Frontend changes

No redesign. Preserve existing in-progress handling and display only existing
safe reconnect guidance for outcome-unknown/reauthorization state.

## Backend changes

Terminal-failure replay, timeout uncertainty, shared lease budgeting, checked
CAS transitions, strict durable revocation handoff, terminal secret wiping,
schema constraints, strict Meta bounds, and safe worker observation.

## Security requirements

- Never repeat a provider call after its outcome is unknown.
- Never call a provider after a zero-row/stale fenced transition.
- No external call inside a database transaction.
- No terminal revocation secret retention.
- No raw provider error/message/URL/token in persistence, logs, audit, API, or UI.
- Cross-tenant and stale-token substitutions fail closed.

## Edge cases

- First, second, and later replay of terminal `OUTCOME_UNKNOWN`.
- New idempotency key against an account awaiting reauthorization.
- Operation lease alive while account lease expires; different-key overlap.
- Worker lease expires before/hard at provider timeout; provider promise hangs.
- CAS mark/complete/fail updates zero rows.
- Supported disconnect with missing credential or concurrent duplicate handoff.
- Every terminal revocation outcome and secret wiping.
- Debug response with 51 scopes, malformed scope item, maximum/far-future expiry,
  and oversized/control app token.

## Acceptance criteria

1. No same-key or different-key retry can repeat refresh/revocation after outcome
   uncertainty; reconnect is required.
2. Refresh timeout is not reported as degraded success and is not auto-retried.
3. Shared leases cover the complete maximum provider sequence and remain
   compatible across operation/account/worker claims.
4. Every stale fenced transition stops before provider or dependent state update.
5. Supported disconnect cannot commit pending revocation without exactly one
   durable encrypted job.
6. All terminal revocation rows wipe staged secret material.
7. Migration 0019 enforces valid revocation state/lease/time/attempt/bounds and
   active-job uniqueness.
8. Malformed/oversized Meta observations fail closed.
9. Unexpected worker failures are observed safely, not silently swallowed.
10. All previous TASK-016/TASK-017 tests remain green.

## Test plan

Run and report:

- focused application/adapter/API/worker tests;
- controlled PostgreSQL stale-token, second-replay, timeout, handoff, secret-
  wipe, and schema-constraint tests with exact side-effect counts;
- `pnpm check`;
- `pnpm test:integration`;
- `pnpm db:migrate:validate` twice;
- `pnpm test:e2e:clean`;
- `git diff --check 99804e5..HEAD`;
- changed-diff scans for raw provider diagnostics, token-bearing URLs,
  `/me/permissions`, unchecked fenced transitions, and modified old migrations.

Commit and push only after all gates pass. Report every deviation.

## Out of scope

Publishing/scheduling, TikTok, analytics, production KMS vendor selection, live
Meta mutations, microservices, and unrelated Sprint 4 checkpoints.
