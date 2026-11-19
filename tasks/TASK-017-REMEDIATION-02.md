# TASK-017-REMEDIATION-02 — Close remaining lifecycle atomicity and worker gaps

## Objective

Fix the remaining blocking defects found by Codex in actual commit `cf9a154`.
This remediation is narrowly scoped to mutation idempotency atomicity, a working
maintenance execution path, refresh evidence/eligibility, disconnect ordering,
strict grant discovery, and tests that prove provider-call counts.

## Context

TASK-017 remains `STATUS: CHANGES REQUIRED`. Remediation 01 corrected official
hosts, partial callback truth, basic claim fencing, URL redaction, and several
state-policy issues. The following defects remain in actual code:

1. `executeSocialAccountMutationWithIdempotency()` holds an idempotency lock in
   one DB transaction but invokes `executeMutation()`, whose repositories commit
   in separate transactions, before inserting the idempotency record. If the
   mutation commits and cache insert/outer transaction fails, a retry can mutate
   and audit again.
2. `maintainDueSocialAccounts()` claims a due account, then calls
   `refreshSocialAccount()`, which tries to claim the same account again. The
   second claim returns null, so maintenance increments `processedCount` without
   any provider call. No runtime worker composition invokes the maintenance use
   case.
3. Successful refresh sets `capabilitiesCheckedAt=now` and derives state from
   stored scopes without re-inspecting current identity/grants. This converts old
   evidence into falsely fresh evidence.
4. Manual claim ignores `social_credentials.earliest_refresh_at`. The fixed
   60-second lease can expire while the configured provider timeout is also up
   to 60 seconds, allowing a second provider call before the first completes.
5. Disconnect still decrypts and remotely revokes before the authoritative local
   disconnect transaction, so a supported adapter can delay/hang local safety.
6. The Threads adapter initializes granted scopes with `threads_basic`. If the
   inspection response contains only `threads_content_publish`, it can complete
   as though both grants were proven. Empty authorize scope input is also
   accepted instead of requiring the exact server scope set.
7. The concurrency test asserts one claim but never invokes the application
   refresh path with a barrier/mock adapter and never asserts exactly one
   provider call. No maintenance test proves a claimed account is actually
   refreshed.

Read `AGENTS.md`, TASK-017, both remediation tasks, and the actual
`f5c29e0..cf9a154` code/diff before implementation.

## Required implementation

### 1. Atomic or recoverably fenced mutation idempotency

- Redesign refresh/disconnect mutation idempotency so the durable operation
  state is claimed before side effects and cannot be lost after the mutation
  commits. Do not hold a database transaction open across a provider call.
- Use a durable state machine such as `pending -> completed/failed` with an
  opaque operation/lease token, request hash, expiry, and recoverable resource
  outcome. Concurrent same-key callers converge on one operation; different
  request hash returns `409`.
- For refresh, the idempotency operation must own/reference the exact refresh
  claim. Only its winner may call the provider. After provider/account commit,
  completion of the idempotency response must be recoverable if the process
  crashes; replay must read authoritative account/operation state and must not
  call the provider again.
- For disconnect, local mutation and idempotency completion should be in one DB
  transaction where practical. If staged, persist the operation claim first and
  make replay recognize the already-disconnected authoritative outcome without
  duplicate audit/revocation.
- Never deserialize cached JSON directly as a trusted `SocialAccountSnapshot`.
  Runtime-validate a safe response or reload the workspace/account by opaque ID
  and serialize through the normal boundary.
- Add failure-injection PostgreSQL tests for crash/failure after mutation commit
  but before response completion, concurrent same key, conflict hash, replayed
  safe failure, exact mutation/audit count, and exact provider-call count.

### 2. One refresh execution primitive and working maintenance path

- Refactor refresh into one internal execution primitive that accepts an already
  acquired `ClaimedSocialAccountRefresh` and performs decrypt -> provider
  refresh/inspection -> encrypt -> fenced completion/failure/release.
- Manual refresh performs authorization/idempotency then claims and passes the
  claim into the primitive. Maintenance selects/claims due work and passes that
  exact claim into the same primitive; it must not claim twice.
- `processedCount` means a claim was actually processed to a recorded outcome.
  Return separate counts for claimed/refreshed/deferred/failed if useful; never
  report phantom work.
- Wire maintenance into the existing worker runtime/composition behind explicit
  social/Threads enablement and kill switches. Use the existing worker polling/
  batch conventions; no new service. It may be disabled by default in config,
  but the runtime execution path must exist and be integration-testable.
- A claimed item must always be completed, failed, or fenced-release attempted.
  Individual failures must be safely observed/counted, not silently swallowed
  with a stranded lease.

### 3. Genuine capability inspection on refresh

- Extend the provider-neutral adapter with a typed inspect-current-account/grants
  operation, or make refresh return verified identity/grant observations when
  the official flow can provide them. Infrastructure owns Meta payloads.
- A token refresh alone updates credential expiry but does not update
  `capabilitiesCheckedAt` and cannot turn stale capabilities fresh.
- To mark active/review-gated with fresh capability evidence, verify the current
  profile ID matches the stored provider account ID and prove both required
  grants from the official inspection response. Unknown/unavailable inspection
  yields degraded/stale capability with bounded retry, while preserving the
  valid rotated token if safely committed.
- Persist the new actual granted scopes/capabilities/checked timestamp atomically
  with the fenced credential rotation. Removed permissions take effect
  immediately and cannot remain in stored scopes.
- Add tests for refresh success + inspection success, token success + inspection
  failure, identity mismatch, grant removal, and no false freshness.

### 4. Refresh eligibility and lease duration

- Claim SQL must join credentials safely and reject automated/manual provider
  refresh before `earliest_refresh_at` unless a documented explicit inspection-
  only command is used. Owner clicks must not bypass provider refresh limits.
- Derive lease duration from a bounded configuration greater than provider total
  request timeout plus processing margin, or renew/fence the lease safely while
  work runs. A lease cannot expire during one allowed provider attempt.
- The due selector must apply the same credential eligibility and active
  workspace/kill-switch rules, bounded batch size, and deterministic order.
- Add controlled-time tests for too-early refresh, boundary eligibility, long
  provider call not double-called, stale reclaim after genuine crash, and kill
  switch between polls.

### 5. Local-first disconnect with staged remote revocation

- Threads remains revocation `unsupported` and should locally disconnect in one
  fast atomic transaction without decrypting/calling provider.
- For a future/test adapter that supports revocation, local disconnect and
  credential removal must commit first. If remote revocation is required, stage
  a bounded durable operation while retaining only the minimum encrypted token
  material needed for that operation, or explicitly document/implement a safe
  atomic handoff. The provider call occurs after local disablement and cannot
  roll it back or reactivate the account.
- Do not block local disconnect on provider network response. Update external
  revocation status afterward with a fenced transition. UI remains truthful.
- Add a barrier test proving the account is already disconnected and unusable
  while supported test revocation is blocked, then prove timeout/failure keeps it
  disconnected and records the safe external result.

### 6. Strict scope observation and provider validation

- Start `grantedScopes` empty. Add only permissions explicitly returned with
  `status=granted` and within the server allowlist. Require both
  `threads_basic` and `threads_content_publish` before exchange stage is
  `completed`.
- Authorization URL creation must require the exact two server scopes—missing,
  empty, duplicate, or unexpected scopes fail closed.
- Runtime-bound token exchange/profile/permission fields, including provider
  account ID length/control characters and permission item count/string length.
  Validate expiry is a safe positive bounded integer.
- Add adapter tests: only publish returned, only basic returned, empty list,
  duplicate/unknown items, empty authorize scopes, oversized/control IDs, and
  no inferred scope persisted.

### 7. Evidence tests

- Add an application + PostgreSQL controlled barrier test where two concurrent
  refresh HTTP/use-case requests share one account and the mock adapter counter
  is asserted exactly `1` before either completes.
- Add maintenance execution tests proving: due claim -> exactly one provider
  call -> fenced rotation/status; two workers do not double call; failure records
  state/releases claim; no due work returns zero.
- Replace the current idempotency test's in-memory counter-only mutation with an
  actual database mutation/audit and failure-injection proof.
- Add worker composition/startup test showing maintenance can be enabled and is
  disabled/fail-closed when social config, kill switch, or protector/adapter is
  unavailable.

## Expected files

Application refresh/maintenance/idempotency services and ports; PostgreSQL
idempotency/refresh/disconnect repositories and statements; forward-only
migration `0017_threads_lifecycle_atomicity.sql` if schema is required; worker
composition/runtime/config; Threads adapter contracts; API handlers; focused
unit/integration/worker tests; generated OpenAPI only if public schemas change.

Do not modify migrations `0015` or `0016`. Preserve unrelated untracked files.

## Database changes

Use forward-only migration `0017` for operation-state/fenced revocation or other
schema support. Constrain closed statuses, tokens, timestamps, tenant FKs, and
indexes. Migration validation must cover all 17 migrations twice.

## API changes

No route shape expansion unless required for a truthful accepted operation
state. Preserve safe idempotent response semantics and generated OpenAPI. No
internal claim/operation token may cross the API boundary.

## Frontend changes

Only update UI if the backend operation/revocation state requires truthful
wording. Preserve accessibility and no-secret guarantees.

## Backend changes

Atomic/recoverable idempotency, shared claimed-refresh executor, real worker
wiring, fresh provider inspection, eligibility/lease correctness, local-first
disconnect, strict grant parsing, and barrier/failure-injection tests.

## Security requirements

- No external call inside a DB transaction.
- No token in idempotency JSON, operation payload, logs, audit, errors, queue, or
  browser. Any staged revocation secret remains encrypted with exact resource AAD.
- Crash recovery cannot duplicate provider calls or silently report success.
- Stale operation/lease tokens cannot complete newer work.
- Cross-workspace/account/operation substitution fails closed.

## Edge cases

- Process dies after provider success, account commit, idempotency claim, local
  disconnect, or before response completion.
- Provider call outlives nominal timeout/lease; two manual calls; manual + worker;
  two workers; earliest refresh boundary.
- Token rotates but inspection fails; identity changes; publish/basic grant
  removed; permission response contains only one required grant.
- Remote revoke hangs while local disconnect completes; retry/recovery updates
  only external revocation result.

## Acceptance criteria

1. Mutation/idempotency crash windows cannot cause a second account mutation,
   provider refresh, credential rotation, disconnect audit, or revocation call.
2. Maintenance uses its existing claim and actually executes/records provider
   work; it is wired into the worker runtime behind fail-closed config.
3. Token refresh alone never refreshes capability evidence. Active state after
   refresh requires a matching inspected identity and both actual grants.
4. `earliest_refresh_at` and lease duration/renewal prevent early or overlapping
   provider calls.
5. Local disconnect commits before any supported remote revocation call and
   remains authoritative through timeout/failure.
6. Granted scopes start empty and contain only explicitly proven allowlisted
   grants; exact authorize scopes are mandatory.
7. Controlled tests assert exactly one provider call for concurrent manual and
   worker scenarios, plus actual mutation/audit counts and crash recovery.
8. All previous TASK-016/TASK-017/remediation tests remain green.

## Test plan

Run and report:

- focused adapter/application/API/worker tests;
- controlled PostgreSQL concurrency and failure-injection tests;
- `pnpm check`;
- `pnpm test:integration`;
- `pnpm db:migrate:validate` twice;
- `pnpm test:e2e:clean`;
- `git diff --check cf9a154..HEAD`;
- changed-diff secret and DTO/OpenAPI scans.

Commit and push after all gates pass. Report every deviation.

## Out of scope

Publishing/scheduling, TikTok, analytics, production KMS vendor selection, live
Meta mutations, and infrastructure redesign.
