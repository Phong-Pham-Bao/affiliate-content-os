# TASK-017-REMEDIATION-01 — Correct Threads provider truth, lifecycle concurrency, and API semantics

## Objective

Remediate the blocking findings from Codex's actual-code review of TASK-017
commit `f5c29e0`. Make the official Threads adapter factually correct and
fail-closed, make refresh concurrency prevent duplicate provider calls, enforce
real mutation idempotency, align partial callback/account state, and add the
missing durable maintenance/concurrency evidence.

## Context

TASK-017 is not approved. Existing green tests encode several incorrect or
incomplete assumptions. Review compared the approved task specification with
the actual migration, adapter, application services, API handlers, UI, and
tests.

Blocking findings:

1. **CRITICAL — wrong official hosts.** Configuration, adapter defaults, tests,
   and `.env.example` use `threads.net` / `graph.threads.net`. Current official
   Meta documentation/sample cited by TASK-017 uses `https://www.threads.com`
   for authorization and `https://graph.threads.com` for API calls.
2. **HIGH — fabricated grant.** `ThreadsSocialAuthAdapter.exchangeCode()` adds
   `threads_content_publish` when `/me/permissions` is unavailable or throws.
   Requested permissions are not proof of granted permissions.
3. **HIGH — identity is not actually verified.** A failed profile lookup returns
   a fabricated display name (`Threads User ...`), and a successful `/me`
   response is not required to contain an ID matching the token-exchange user
   ID before the exchange can become complete.
4. **HIGH — refresh lease permits duplicate provider calls.** Claim SQL always
   overwrites the lease and does not atomically require an absent/expired lease.
   The transaction lock ends before the provider call, so two claimers can both
   call Meta for the same account/version; CAS only rejects the second write.
5. **HIGH — refresh/disconnect idempotency is nominal only.** The handlers call
   `extractSocialIdempotencyKey()` but do not persist request hashes, replay the
   same response, or reject key reuse with a different request.
6. **HIGH — partial callback truth is inconsistent.** A recoverable post-token
   partial exchange persists a degraded account, but
   `executeCompleteOAuthCallbackTransaction()` always creates a callback result
   with status `success` while the application returns `isSuccess=false`.
7. **HIGH — lifecycle policy can lie.** It does not enforce a capability
   freshness window and can return `active` while required grants are missing.
8. **HIGH — durable maintenance is absent.** There is an index, but no bounded
   due-work selector/claim port or worker-compatible execution integration.
9. **HIGH — redirect contract can diverge.** Reconnect constructs its callback
   from application base URL instead of using the exact validated configured
   Threads redirect URI used for provider registration/exchange.
10. **MEDIUM — provider transport/validation is too permissive.** It reads the
    full body before checking character length, does not validate content type
    or response schema/string bounds, and error wrapping retains raw causes that
    may contain sensitive request URLs. Provider URL query secrets must never
    reach application logging/telemetry/errors.
11. **MEDIUM — disconnect revocation sequencing is unsafe for future adapters.**
    It calls `revokeToken('')` before local disablement. Local disconnect must
    not wait on an unbounded provider operation, and an adapter that claims
    revocation support must receive a real narrowly decrypted token or the
    operation must be explicitly separated/deferred. Threads remains
    `unsupported`; do not invent an endpoint.

Read `AGENTS.md`, `tasks/TASK-017.md`, the Sprint plan, official references in
TASK-017, and the actual `39cf414..HEAD` diff before changing code.

## Required implementation

### 1. Correct official provider facts and fail-closed discovery

- Change defaults and production allowlists to the current official hosts:
  authorization `https://www.threads.com`, API `https://graph.threads.com`.
- Update `.env.example`, configuration tests, adapter tests, and documentation.
  Production must reject legacy `.net`, lookalikes, credentials, query/fragment,
  custom ports, and path-prefix/base URL tricks.
- Keep API version configurable/pinned as TASK-017 specifies. Do not confuse the
  general Graph API current version with the documented Threads API version.
- Adapter authorization accepts only the exact server scope set
  `threads_basic threads_content_publish`; reject unexpected/missing caller
  scopes rather than forwarding arbitrary values.
- Remove every fallback that promotes requested scopes to granted scopes. If a
  current official endpoint cannot prove grant state, return a typed unknown/
  partial observation, disable publication capability, and derive a truthful
  non-active state.
- Require a runtime-validated profile response with bounded `id`, `username`,
  and name fields. The profile `id` must match the token-exchange `user_id`.
  Mismatch is terminal for that callback and must not persist/overwrite an
  account. A failed profile lookup may preserve the encrypted token as degraded,
  but must not fabricate a verified display identity.
- Parse all provider responses with explicit schemas and byte/string/count
  bounds. Validate content type. Do not let unknown shapes, non-finite expiry,
  empty IDs, hostile Unicode/control strings, or oversized values become domain
  data.
- Add contract tests for current `.com` URLs, strict scopes, unavailable grant
  inspection, profile ID mismatch, malformed/bounded fields, and no fabricated
  publish capability.

### 2. Secret-safe HTTP transport

- Enforce response byte limits while streaming or before unbounded buffering;
  do not call `res.text()` and only afterward apply a character-count limit.
- Keep redirects disabled. Sanitize errors without retaining a raw provider
  error/cause that can carry app secret, code, access token, authorization
  header, or full secret-bearing URL.
- Where the official API requires query credentials/tokens, contain URL
  construction and use inside the adapter/transport and prove that diagnostics,
  error messages, audit, telemetry, and thrown causes are redacted for both
  `access_token` and `client_secret` (plus code/state where applicable).
- Add adversarial transport tests for oversized chunked bodies, content type,
  abort/timeout, redirect, fetch errors containing full secret URLs, and
  malformed JSON. Never print fixture secrets.

### 3. Real exclusive refresh claim and durable due-work selection

- Make claim a single atomic eligibility transition that succeeds only when:
  account is refreshable, credential exists, due/manual conditions are valid,
  and lease is absent or expired. A live lease returns no claim.
- Fence each claim with a unique opaque lease/operation token (or an equivalent
  monotonic claim version). Completion/failure must match the exact claim token
  plus account/credential versions; a stale worker cannot release or complete a
  newer lease.
- Ensure two simultaneous manual/worker attempts for the same account/version
  cause at most one provider call. CAS-after-the-call alone is insufficient.
- Add a bounded `FOR UPDATE SKIP LOCKED` (or equivalent repository-consistent)
  due-account selector/claimer ordered deterministically, with limit bounds,
  next-refresh eligibility, stale-lease recovery, kill-switch behavior, and
  workspace-safe joins.
- Wire a worker-compatible maintenance command into the existing modular
  monolith worker composition. It may be explicitly disabled by default, but it
  must be callable/testable and restart-safe; do not create a service.
- If decrypt/adapter/config throws after claim, record/release the exact claim
  into a safe degraded/reauth transition. Do not strand a live lease until
  timeout unnecessarily.
- Add controlled PostgreSQL barrier tests proving: two claimers -> one claim;
  only one mock provider call; stale lease reclaim; old claim cannot complete a
  new lease; disconnect wins; and due selector does not double-claim across two
  workers.

### 4. Full API idempotency and exact redirect binding

- Reconnect, refresh, and disconnect must all use the repository idempotency
  mechanism, not merely require a header.
- Persist normalized request hashes and safe response data. Same key + same
  request returns the stored response without a second OAuth transaction,
  provider refresh, credential rotation, disconnect mutation, or audit event.
  Same key + different request returns `409`.
- Scope keys by workspace/actor/route using existing conventions. Validate
  bounded key syntax and expiry. Concurrent first submissions converge.
- For async/claimed refresh, persist a safe accepted/current operation result;
  do not rerun Meta on replay.
- Reconnect must use the exact validated `THREADS_REDIRECT_URI` from social
  configuration. Authorization and code exchange must use the same stored exact
  value. Do not derive it independently from `appBaseUrl`.
- Add API/application/PostgreSQL tests for same-key replay, hash conflict,
  concurrent duplicates, provider-call count, audit count, and redirect exactness.

### 5. Truthful callback and lifecycle state

- Extend callback completion persistence so recoverable partial completion
  records a safe non-success callback result (for example a closed `partial` or
  existing safe error status/code selected consistently across domain, DB,
  schemas, UI, and OpenAPI) while retaining the degraded account reference and
  encrypted credential. API `isSuccess`, stored result, landing UI, and audit
  result must agree.
- Only mark the exchange `completed` after verified matching identity and actual
  grant observation required by the chosen current official inspection flow.
- Add an explicit capability freshness policy with a tested maximum age/config.
  Missing, invalid, future-skewed, or stale `capabilitiesCheckedAt` cannot yield
  active or publish capability.
- `active` requires the configured required grants (`threads_basic` and
  `threads_content_publish`) plus fresh evidence, valid token, verified identity,
  approved review gate, and no kill switch. Missing/unknown publish grant must
  yield a truthful closed non-active state and recovery action.
- Do not automatically treat `capabilitiesCheckedAt=now` as genuine inspection
  evidence when the adapter never proved the grants.
- Add tests for missing basic/publish grants, unknown inspection, stale/future
  freshness, partial callback result consumption, UI landing wording, and audit
  agreement.

### 6. Refresh error typing and scheduling correctness

- Replace `err.message.includes(...)` auth-terminal detection with typed adapter
  error classes/safe classifications. Preserve rate-limit retry metadata from
  current official headers/body where available and bound it.
- Respect documented refresh eligibility/earliest-refresh and private-profile
  limitations. Store proven token/grant lifecycle observations; do not attempt
  refresh early merely because an owner clicked repeatedly.
- On unsupported refresh, terminal auth error, transient error, encryption
  failure, or CAS/claim loss, transition/release safely with no leaked token and
  no false `lastRefreshedAt`/fresh capability evidence.
- Rotation must update token kind/issued/expiry/earliest-refresh/attempt metadata
  introduced by migration `0015`; do not leave those columns as unused schema.

### 7. Disconnect and revocation ordering

- Threads continues to report external revocation `unsupported`; do not call a
  fake endpoint and do not claim provider removal.
- Make local disablement and credential erasure authoritative and fast. External
  best-effort revocation for any future supported adapter must occur through a
  safe bounded staged operation that has a real token obtained through the
  narrow protector path, cannot reactivate the account, and cannot block/roll
  back local disconnect indefinitely.
- Remove `revokeToken('')`. Add tests that a supported test adapter receives the
  real token only inside the narrow call, timeout/failure leaves local state
  disconnected, and API/UI accurately distinguish local disconnect from remote
  revocation.

## Expected files

Changes are expected across the TASK-017 adapter/config, application lifecycle
services/ports, PostgreSQL statements/repositories/migration follow-up,
API handlers/schemas/OpenAPI, worker wiring, UI callback/status handling, and
tests. Because migration `0015` is already committed/pushed, do not rewrite it
silently: add forward-only `0016_threads_lifecycle_remediation.sql` for schema
changes. Existing `0015` may only receive a comment-only correction if the
repository policy explicitly permits it; prefer no modification.

Preserve unrelated untracked `plans/` and
`packages/application/src/workforce/affiliate-content-os.code-workspace`.

## Database changes

Add forward-only migration `0016` if claim fencing, callback status, capability
observation, idempotency operation results, or scheduling metadata needs schema
support. Strongly constrain claim tokens, status values, timestamps, and tenant
relationships. Validate all 16 migrations twice.

## API changes

Keep TASK-017 route shapes unless a compatible status/result extension is
needed. Correct idempotency, redirect binding, safe partial result semantics,
and Problem Details/OpenAPI. No secret or internal claim token is public.

## Frontend changes

Update only what is required for truthful partial/unknown-grant/stale state,
idempotent action feedback, and external revocation wording. Preserve accessible
focus, keyboard, announcement, reduced-motion, and role behavior.

## Backend changes

Correct official adapter/config, strict provider validation, exclusive refresh
claims/due worker, typed errors, mutation idempotency, callback truth, freshness
policy, redirect binding, scheduling metadata, disconnect ordering, and tests.

## Security requirements

- No app secret, token, code, state, authorization header, ciphertext, secret
  URL, raw provider body/error, or lease token in logs, errors, audit, telemetry,
  DTOs, OpenAPI, snapshots, or browser state.
- No requested-scope-to-granted-scope inference and no fabricated identity.
- SSRF/redirect/query secret/cause-chain redaction tests must exercise the real
  default transport, not only a mock that returns sanitized data.
- Concurrent refresh/idempotency tests must use controlled barriers and assert
  exact provider-call/mutation/audit counts.
- Cross-workspace claim/idempotency/account substitution remains structurally
  and behaviorally rejected.

## Edge cases

- Grant inspection unavailable/empty/malformed/unknown, profile ID mismatch,
  long-token success followed by failed profile, and secret-bearing fetch error.
- Two simultaneous manual refreshes, worker + manual refresh, stale worker after
  lease reclaim, disconnect during provider call, and encryption failure after
  provider success.
- Same idempotency key concurrent, replay after completion, hash conflict, and
  replay after safe failure/partial result.
- Capability timestamp absent/stale/future, required grant removed, review gate
  changes, early refresh, private profile, kill switch during claimed work.

## Acceptance criteria

1. Official current `.com` hosts are defaults/production allowlists and adapter
   contract tests assert exact URL construction.
2. Requested scopes never become granted evidence; identity/profile mismatch or
   inspection uncertainty cannot yield active/publish capability.
3. Exactly one refresh claim and at most one provider call occur for concurrent
   attempts on one account/version; stale claims cannot complete newer work.
4. A bounded durable due selector and worker-compatible maintenance execution
   are implemented and proven restart/concurrency safe.
5. Reconnect/refresh/disconnect have real persisted idempotency replay/conflict/
   concurrency semantics, not header-only validation.
6. Recoverable partial exchange persists an encrypted degraded account and a
   matching non-success safe callback/audit/UI result.
7. Active/publish capability requires fresh proven grants and verified identity;
   missing/stale/future evidence fails closed.
8. Reconnect uses the exact validated configured redirect URI for authorize and
   exchange.
9. Provider HTTP parsing is bounded/schema-validated and secret-safe through
   error cause chains; no raw secret URL survives.
10. Disconnect never passes an empty token, local disablement wins all races,
    and unsupported Threads revocation remains truthful.
11. Migration `0016` (if needed), runtime schemas, generated OpenAPI, UI, audit,
    and tests agree.
12. All TASK-016/TASK-017 regression gates pass with no live Meta call.

## Test plan

Add the focused tests required above, then run and report exact exit codes/counts:

- focused domain/application/provider/transport/API/UI unit tests;
- controlled PostgreSQL concurrency tests with exact call-count barriers;
- `pnpm check`;
- `pnpm test:integration`;
- `pnpm db:migrate:validate` twice;
- `pnpm test:e2e:clean`;
- `git diff --check f5c29e0..HEAD`;
- changed-diff secret scan and OpenAPI/browser-response token/ciphertext scan.

Commit and push only after all gates pass. Report deviations honestly.

## Out of scope

Publication/scheduling/reconciliation (TASK-018/TASK-019), TikTok, analytics,
production KMS vendor selection, live Meta mutation, or architecture redesign.
