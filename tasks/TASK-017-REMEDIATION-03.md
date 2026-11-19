# TASK-017-REMEDIATION-03 — Final lifecycle fencing and official token inspection

## Objective

Close the remaining blocking defects found by Codex in actual commit `2924e50`
so TASK-017 can be approved without duplicate provider side effects, false
in-flight success, undocumented Meta endpoints, or cross-workspace operation
links.

## Context

TASK-017 remains `STATUS: CHANGES REQUIRED`. Remediation 02 correctly added a
shared claimed-refresh executor, worker wiring, earliest-refresh enforcement,
derived refresh leases, strict authorize scopes, fresh inspection semantics,
local-first disconnect ordering, and controlled provider-call tests. Actual
code review still found these blockers:

1. The Threads adapter calls `graph.threads.com/v1.0/me/permissions`. Codex found
   no official Threads contract for that endpoint. Meta officially documents
   `GET /debug_token` on `graph.facebook.com` for token validity, user, expiry,
   app ID, and granted scopes. It requires a same-app access token.
2. A concurrent same-key request polls a pending operation for about one second,
   then returns the old authoritative account with HTTP success and
   `replayed=true` while the winning request is still running. This falsely
   reports completion and does not converge on the winning response.
3. The operation lease is fixed at 120 seconds while one refresh sequence may
   include a provider refresh plus identity/grant inspection and has a derived
   refresh lease up to or beyond 150 seconds. The idempotency operation can be
   reclaimed while its valid owner is still executing.
4. `pending/completed/failed` cannot distinguish “provider call never started”
   from “provider may have succeeded but the process died before local commit.”
   Expiry blindly reclaims both and can call a rotating-token provider twice.
5. Supported revocation is performed after local commit but still inline in the
   HTTP request. A crash loses the only remaining plaintext token and leaves an
   unrecoverable `pending` result; a hung provider also delays the response.
6. `social_account_operations` has independent workspace and account foreign
   keys, not a composite tenant relationship. It can structurally associate an
   operation workspace with an account owned by another workspace.
7. Mutation failure stores raw `err.message` in the operation row. Provider
   errors can contain request details or secrets and must not enter persistence.
8. Worker startup catches any social configuration error and silently disables
   maintenance, which hides an enabled-but-invalid production configuration.

Read `AGENTS.md`, TASK-017, all three prior TASK-017 implementation/remediation
specifications, and the actual `daa59fc..2924e50` diff before implementation.
Do not trust prior implementation reports in place of reading the code.

## Required implementation

### 1. Use the official Meta token-inspection contract

- Remove the `/me/permissions` call completely. Do not invent a replacement
  Threads endpoint.
- Inspect the Threads user token through Meta's documented versioned
  `GET https://graph.facebook.com/{version}/debug_token` contract. Supply the
  inspected user token as `input_token` and a valid same-app credential as the
  request access token. Keep the Meta Graph origin and bounded supported version
  configuration-owned and HTTPS-only; do not reuse the Threads Graph base URL.
- Prefer an injected app access token secret supplied through the existing
  secret/config boundary. If the implementation obtains one dynamically, only
  use Meta's officially documented app-token flow and add a contract test. Do
  not construct an undocumented credential format.
- Validate the bounded response at runtime: wrapper, `app_id`, `user_id`,
  `is_valid`, `scopes`, and expiry fields. Require `app_id` to equal the
  configured Threads app ID and `user_id` to equal the fetched/stored provider
  account ID. Invalid/mismatched observations fail closed and never create fresh
  capabilities.
- Start observed grants empty and retain only exact allowlisted scopes explicitly
  present in `data.scopes`. Both required scopes are needed for publish-ready
  capability. Preserve the task's truthful degraded/review-gated policy when
  inspection is unavailable or grants are removed.
- Treat `input_token`, `access_token`, Authorization values, and their encoded
  query forms as secrets in transport diagnostics/redaction. They may not enter
  logs, persisted errors, audit, metrics labels, browser DTOs, or fixtures using
  real-looking values.
- Add adapter contract tests for exact origin/version/path/query/auth behavior,
  app/user mismatch, invalid token, missing/partial/unknown/oversized scopes,
  expiry bounds, malformed payload, timeout, redaction, and proof that
  `/me/permissions` is never called.

### 2. Truthful in-flight idempotency responses

- Never serialize the pre-mutation account as a successful replay while the
  owning operation is still active.
- Same-key/same-hash concurrent callers may wait only for a small bounded time.
  If the owner remains active, return a typed safe `operation_in_progress`
  outcome mapped consistently to HTTP `202` (preferred) or `409`, with a bounded
  `Retry-After`. It must not claim `replayed=true` or expose an internal
  operation/lease token.
- Once completed, retry/replay reloads the authoritative account through the
  normal tenant-scoped serializer and converges on the same resource outcome.
  Different request hashes remain `409`.
- Update API schema/OpenAPI/frontend handling if the truthful public status is
  new. Add controller/use-case tests proving no premature 200, no stale account
  masquerading as completion, and eventual convergent replay.

### 3. Fence operation leases for the whole external sequence

- Derive the operation lease from the maximum bounded external sequence, not a
  fixed 120 seconds. It must exceed the refresh plus inspection timeout budget
  and local processing margin, or be safely renewed with compare-and-set fencing.
- The account refresh claim and idempotency operation must have compatible
  ownership/lifetimes. Neither may be reclaimed while the valid owner can still
  complete an allowed attempt.
- Every operation transition and renewal requires the current opaque lease token
  and status. A stale token cannot complete, fail, or renew newer work.
- Add controlled-time/barrier PostgreSQL tests where work exceeds the old
  120-second lease and a concurrent request still cannot make a second provider
  call.

### 4. Represent provider outcome uncertainty explicitly

- Add durable phases sufficient to distinguish at least: claimed before provider
  call, provider attempt started/outcome unknown, and locally committed terminal
  outcome. Use explicit closed state/phase constraints.
- Persist the `provider_attempt_started` transition before the external refresh
  call using a fenced short transaction. If the process disappears after that
  point without committing the new credential/account, expiry must not blindly
  call the rotating-token endpoint again.
- Recovery of an outcome-unknown refresh must use a safe, provider-supported
  reconciliation/inspection route if it can establish the authoritative result.
  Otherwise move the account/operation to a safe review/reauthorization state
  with a stable safe error code. Never guess success and never repeat the
  non-idempotent provider call automatically.
- Preserve the happy path: provider result, encrypted credential rotation,
  account state/evidence, audit, refresh claim, and operation terminal outcome
  must be committed atomically or in a recoverable fenced sequence.
- Add failure injection immediately before provider call, after attempt-start
  commit, after provider success but before DB commit, and after DB commit before
  HTTP response. Assert exact provider-call, rotation, mutation, and audit counts
  across retry/recovery.

### 5. Durable asynchronous supported revocation

- Threads remains `unsupported` and disconnects locally without decrypting or
  invoking a provider.
- For a supported future/test adapter, atomically disconnect the account and
  hand off only the minimum token material to a durable revocation job. Store it
  encrypted using the existing protector with exact resource-bound AAD and a
  composite tenant/account relationship. Delete the active credential in that
  same transaction.
- Return the authoritative local disconnected state immediately; never await the
  remote revoke call in the HTTP request.
- Process revocation through the existing worker runtime with claim/lease/fence,
  bounded timeout/attempt policy, safe terminal codes, and explicit pending/
  succeeded/failed/unsupported UI truth. Wipe encrypted staged token material on
  terminal completion; define a bounded retention/recovery policy for failures.
- Mark the provider attempt before calling externally. An outcome-unknown revoke
  must not be blindly called twice unless the provider contract explicitly
  proves idempotency. Tests must not assume undocumented idempotency.
- Add barrier/crash tests proving local disconnection is already committed while
  revoke is blocked, API response does not wait, worker restart recovers safe
  pre-call work, post-call crash does not duplicate calls, and failure never
  reactivates the account.

### 6. Structural tenant integrity and safe persisted diagnostics

- Add a forward-only migration `0018_threads_operation_fencing.sql`; do not edit
  migrations `0015`-`0017`.
- Enforce `(workspace_id, social_account_id)` references the matching composite
  key on `social_accounts`. Add/retain the required unique parent key and use
  composite relationships for revocation rows as well.
- Constrain operation/revocation statuses/phases, terminal response/error
  consistency, bounded safe error codes/messages, request-hash/token sizes,
  timestamp/lease ordering, attempts, and useful due-work indexes.
- Persist only an allowlisted internal error code and a fixed safe user-facing
  message. Never persist raw exception/provider response/message text.
- Migration tests must prove cross-workspace substitution and invalid state
  combinations fail at the database boundary.

### 7. Fail-closed worker composition

- Distinguish explicit social maintenance disablement from invalid/missing
  configuration when maintenance/social integration is enabled.
- A deliberately disabled feature may omit its runtime. An enabled feature with
  invalid origin/version/app credential/protector/adapter configuration must
  fail worker startup visibly; do not catch all configuration errors and silently
  disable it.
- Keep kill-switch behavior fail closed between polls and before claimed work.
  Add worker composition/startup tests for disabled, enabled-valid, and
  enabled-invalid cases without logging secrets.

## Expected files

Threads adapter/config/transport redaction; application mutation/idempotency and
refresh ports/services; PostgreSQL operation, refresh, disconnect, and new
revocation repositories/statements; migration `0018`; API schemas/controllers
and generated OpenAPI if needed; worker composition/runtime; focused unit,
integration, concurrency, failure-injection, and clean-E2E tests.

Preserve unrelated untracked files and user plans. Do not stage them.

## Database changes

Forward-only migration `0018_threads_operation_fencing.sql` owns new operation
phases, tenant composite constraints, durable revocation handoff, safe diagnostic
constraints, and indexes. Validate all 18 migrations twice from a clean database.

## API changes

Permit only the smallest truthful addition required for `operation_in_progress`
and asynchronous revocation status. Preserve opaque public IDs and normal
tenant-scoped serialization. No lease token, operation row ID, credential,
provider payload, or raw provider error crosses the boundary.

## Frontend changes

Handle accepted/in-progress refresh and pending external revocation truthfully if
those states are user-visible. Local disconnection must render immediately.
Preserve accessibility and existing secret-safe behavior.

## Backend changes

Official Meta `/debug_token` inspection, truthful pending semantics, compatible
leases, explicit provider-outcome uncertainty, durable asynchronous revocation,
composite tenant integrity, safe diagnostics, and fail-closed worker startup.

## Security requirements

- Official documented provider endpoints only.
- No external call inside a database transaction.
- No automatic repeat of a non-idempotent call after its outcome becomes unknown.
- No plaintext/staged token outside process memory; at rest it is encrypted with
  exact resource AAD and removed on terminal completion.
- No raw exception or provider message in persistence, logs, audit, API, or UI.
- Stale lease tokens and cross-workspace references fail closed.

## Edge cases

- Concurrent same-key request while owner is active beyond polling and beyond the
  old operation lease.
- Crash before provider call, during provider call, after provider success, after
  account commit, and before HTTP response.
- Debug-token app/user mismatch, invalid token, partial/removed scopes, malformed
  expiry, provider timeout, and secret-bearing error URL.
- Disconnect/revocation process crash before call and after call, worker restart,
  terminal failure, and kill switch between claim and execution.
- Enabled worker with missing Meta app credential or invalid debug origin/version.

## Acceptance criteria

1. Threads permission/capability inspection uses only the official documented
   Meta `/debug_token` contract; `/me/permissions` is absent.
2. Active in-flight operations never return stale-account HTTP success. They
   return a typed accepted/conflict outcome and later converge on the completed
   authoritative resource.
3. Operation and account leases cannot expire during one allowed external
   sequence; stale owners cannot mutate terminal state.
4. A crash after provider-attempt start cannot trigger an automatic duplicate
   refresh or revocation call. Outcome uncertainty is explicit and safe.
5. Supported revocation is a durable encrypted worker handoff; disconnect API is
   local-first and non-blocking. Threads unsupported path never decrypts/calls.
6. Database constraints reject cross-workspace operation/revocation linkage and
   invalid phase/result/error combinations.
7. Persisted failures use allowlisted safe codes/messages only.
8. Enabled-invalid worker configuration fails startup; explicit disablement is
   the only silent omission path.
9. All TASK-016/TASK-017 and prior remediation behavior remains green.

## Test plan

Run and report:

- focused Threads adapter/application/API/frontend/worker tests;
- controlled PostgreSQL concurrency, lease, composite-FK, revocation, and crash
  failure-injection tests with exact provider/mutation/audit counts;
- `pnpm check`;
- `pnpm test:integration`;
- `pnpm db:migrate:validate` twice;
- `pnpm test:e2e:clean`;
- `git diff --check 2924e50..HEAD`;
- changed-diff scans for secrets, raw provider diagnostics, undocumented
  `/me/permissions`, unsafe DTO/OpenAPI fields, and migration mutation.

Commit and push only after all gates pass. Report every deviation.

## Out of scope

Publishing/scheduling, TikTok, analytics, production KMS vendor selection, live
Meta mutations, provider-independent job platform redesign, and microservices.
