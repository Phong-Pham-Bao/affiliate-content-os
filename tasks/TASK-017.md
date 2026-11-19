# TASK-017 — Sprint 4 Checkpoint B: Threads account lifecycle

## Objective

Implement the real, official Threads account lifecycle behind the social
connection ports approved in TASK-016: OAuth authorization and staged token
exchange, verified provider identity and granted-capability discovery, safe
credential rotation, refresh/reconnect/disconnect, truthful account-health
states, owner-facing recovery actions, and provider contract tests. Keep real
Threads behavior feature-gated until deployment credentials, Meta review, and
production key management are actually ready.

## Context

TASK-016 / Checkpoint A is complete and Codex-approved at `39cf414`. It provides
the provider-neutral domain/application boundary, PostgreSQL account and OAuth
persistence, encrypted credential boundary, fake adapter, owner-only authorize
flow, safe callback results, Connections UI, and full-stack fake evidence.

Read before implementation:

- `AGENTS.md`
- `docs/SPRINT-4-SOCIAL-PUBLISHING-PLAN.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/DECISIONS.md`
- `tasks/TASK-016.md` and its three remediation tasks
- the actual social domain, application ports/use cases, migration `0014`,
  repositories, crypto boundary, API routes/bootstrap, and Connections UI

Provider facts were revalidated against official Meta sources on 2026-11-18:

- [Threads API documentation index](https://developers.facebook.com/documentation/threads/llms.txt)
- [Threads API get started](https://developers.facebook.com/documentation/threads/get-started)
- [Create a Threads app](https://developers.facebook.com/documentation/threads/get-started/create-an-app.md)
- [Threads profiles](https://developers.facebook.com/documentation/threads/threads-profiles)
- [Official Meta Threads API sample](https://github.com/fbsamples/threads_api)
- [Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [Graph API error handling](https://developers.facebook.com/docs/graph-api/guides/error-handling)

Current official behavior relevant to this task:

- Threads uses a distinct app ID/secret. `threads_basic` is required for API
  access and `threads_content_publish` is required for later publishing.
- Authorization uses the official Threads authorization host. Token and profile
  calls use the official Threads Graph host. Provider base URLs and the tested
  API version are configuration facts owned by the infrastructure adapter.
- Authorization-code exchange yields a short-lived token; the documented
  long-token exchange uses `grant_type=th_exchange_token`; refresh uses
  `GET /refresh_access_token` with `grant_type=th_refresh_token`.
- Public-profile grants and private-profile grants have materially different
  extension/reauthorization behavior. Do not promise that every token can be
  extended.
- Normal CI must never call Meta. Live smoke is explicit, opt-in, read-only,
  non-destructive, and secret-redacted.

The current repository intentionally has no production managed-KMS integration.
Do not weaken TASK-016's production fail-closed behavior or pretend the local
key is production-ready. This task makes the real adapter and lifecycle correct
and testable; production release remains gated.

## Required implementation

### 1. Provider-neutral lifecycle contracts

- Evolve the existing social auth contract without leaking Meta DTOs, endpoint
  paths, error bodies, SDK types, or numeric provider codes into domain or API
  contracts.
- Represent exchange as explicit stages. Once a syntactically valid provider
  token and provider user ID have been observed, a later timeout/failure during
  long-token exchange, grant inspection, or profile lookup must return a typed
  recoverable partial result that can be durably encrypted and recovered. It
  must not be flattened into a terminal exchange failure that loses the token.
- A timeout/network failure where issuance is unknown must be classified
  `outcome_unknown`; the application must not blindly replay the authorization
  code. The safe recovery action is a new authorization/reconnect flow unless
  provider evidence proves an idempotent retry is permitted.
- Separate requested scopes, provider-reported granted scopes, derived
  capabilities, app-review eligibility, credential validity, and freshness.
  Requested scopes are never evidence that a grant was awarded.
- Add explicit adapter features/capabilities for refresh support and external
  revocation support. Unsupported revocation is a truthful result, not a fake
  success and not a call to an invented endpoint.
- Keep the platform-specific token lifecycle, provider errors, rate-limit
  interpretation, and raw provider response validation inside infrastructure.

### 2. Official Threads auth adapter

- Implement a real Threads adapter using official documented endpoints only.
  Use an injectable, timeout-bounded HTTP transport so tests are deterministic.
- Production/default official hosts must be strict HTTPS allowlisted values.
  Reject credentials in URLs, fragments, unexpected ports, path-prefix tricks,
  redirects to unapproved origins, and insecure/custom provider hosts outside
  explicit test composition.
- Keep the tested Threads API version and endpoint construction in validated
  configuration. Pin the tested version (`v1.0` at task authoring time) but do
  not make it a permanent domain promise.
- Use only the Sprint 4 least-privilege scopes: `threads_basic` and
  `threads_content_publish`. Do not request insights, replies, search, delete,
  or unrelated permissions.
- Continue using TASK-016's one-time high-entropy state fence. Do not claim PKCE
  validation unless the official Threads flow actually supports and validates
  it; this adapter must not fabricate a verifier.
- Exchange the code with the exact stored redirect URI and configured app
  credentials, then attempt the documented long-token exchange. Validate every
  provider payload at runtime with bounded sizes and closed/allowlisted fields.
- Fetch/verify identity through the official `me` profile endpoint and map only
  safe bounded fields. Never trust a browser-provided provider account ID.
- Determine granted scopes from an official token/grant inspection response
  when available. If current official APIs cannot prove a grant, mark the
  capability unknown/unavailable rather than copying requested scopes.
- Follow redirects only when required by documented provider behavior and only
  to the same allowlisted provider origin; otherwise reject them.
- Send client secrets only in the documented request body/header. Never place
  app secrets or access tokens in logs, URLs recorded by app telemetry, thrown
  messages, snapshots, audit metadata, or response DTOs.

### 3. Staged exchange and durable recovery

- Extend OAuth transaction/account persistence so callback completion records
  the exact exchange stage and safe recovery state.
- If code exchange fails before any token is observed, fail the transaction
  using the safe callback-result behavior from TASK-016.
- If a valid token and provider user ID are observed but a later provider call
  fails, encrypt the credential and upsert the verified provider identity in a
  single database transaction, mark the account `degraded` (or
  `reauth_required` when provably invalid/unrefreshable), store a safe closed
  reason, create the callback result, and emit audit evidence. Do not mark it
  active and do not discard the recoverable credential.
- Only mark `active` when credential validity, verified identity, required
  granted capabilities, current app-review state, and freshness all satisfy the
  state policy.
- Preserve TASK-016's provider-identity serialization and transaction fencing.
  Concurrent completion/reconnect cannot overwrite a different account's
  credential or create duplicate active identities.

### 4. Capability and account-health policy

- Add a centralized, tested state/capability derivation policy. Persistence may
  store observations, but repositories must not invent business state.
- `active`: verified identity, valid credential, fresh capability evidence,
  required grants, enabled kill switches, and approved runtime app-review gate.
- `review_gated`: credential/identity can be valid for configured testers, but
  deployment configuration says the app/access is not approved for release.
- `reauth_required`: credential or grant is expired, invalid, revoked,
  unrefreshable, or private-profile grant renewal requires user authorization.
- `degraded`: a bounded transient provider/inspection/refresh failure occurred
  while a usable durable credential may still exist; expose a safe retry action.
- `disconnected`: local use is disabled and no workflow may select the account.
- `canPublishText` requires an enabled platform feature, currently valid
  credential, fresh evidence for `threads_content_publish`, verified identity,
  and satisfied review gate. Keep `canPublishMedia=false` until TASK-019
  verifies and implements the selected media mode.
- Unknown/new provider scopes and capabilities are preserved only in bounded
  internal observations where useful and otherwise fail closed. They do not
  silently enable product behavior.
- Add explicit freshness/expiry/next-action metadata to the safe account DTO:
  timestamps, closed status reason, and allowed action names only. No token
  values, hashes, ciphertext details, provider raw errors, or app-review secret.

### 5. Refresh and credential rotation

- Implement per-account refresh orchestration behind the application service.
  Serialize using a PostgreSQL advisory lock keyed by the exact account identity
  and add compare-and-swap/version protection for the final update.
- Keep database transactions short: claim/inspect work, decrypt narrowly, call
  Meta outside the database transaction, then atomically rotate the encrypted
  credential and update observations/status only if the claimed version still
  matches.
- Encrypt every replacement token with a new nonce and the existing resource-
  bound AAD/key-version rules. Never retain plaintext old/new tokens after the
  adapter call boundary. Rotation failure must leave the last committed
  credential intact and produce a safe degraded/reauth state.
- Respect documented earliest refresh behavior, token/grant expiry, private
  profile limitations, provider rate limits, `Retry-After`, and bounded jitter.
- Provide a durable, bounded maintenance selector/lease or equivalent existing
  worker-compatible claim mechanism for accounts due for refresh/inspection.
  It must be restart-safe and safe under multiple workers. This task need not
  introduce a new service; it should fit the modular monolith worker pattern.
- Implement an owner-triggered refresh/recheck command for explicit recovery.
  Duplicate idempotent requests and concurrent worker/manual refresh must
  converge to at most one provider refresh for the same claimed version.

### 6. Reconnect

- Implement reconnect as a new one-time OAuth transaction linked to the target
  account and expected provider identity, not as a mutation that accepts a
  browser-provided identity/token.
- Reconnect start is owner-only, workspace-scoped, origin/CSRF protected, and
  requires `Idempotency-Key`.
- Callback must reject account substitution: if Meta returns a different
  provider user ID, do not overwrite or silently create/activate another account
  through this reconnect transaction. Return a safe mismatch result and retain
  the existing credential/state.
- Successful reconnect rotates credentials atomically, refreshes verified
  identity/grants/capabilities, increments versions, clears only eligible safe
  failure metadata, and audits the change without secret values.

### 7. Disconnect and revocation truthfulness

- Implement owner-only, workspace-scoped disconnect with application session,
  origin/CSRF, authorization, idempotency, and optimistic-concurrency controls
  consistent with existing mutation patterns.
- Locally disable the account and remove/cryptographically erase the usable
  encrypted credential atomically before or independently of best-effort remote
  revocation. A failed/unsupported remote revocation must never leave the local
  account selectable for publishing.
- Current official Threads documentation used for this task does not establish
  a supported client token-revocation endpoint. Do not invent one. The Threads
  adapter must report `unsupported` unless implementation cites and contract-
  tests a current official endpoint.
- Persist/audit separate allowlisted facts for local disconnection, whether
  remote revocation was supported/attempted, and its safe result. When remote
  removal is unsupported, the UI explains the manual provider-settings action
  without claiming the external grant was revoked.
- Disconnect is safe to retry and race-safe with callback/refresh. After local
  disconnect wins, a stale refresh/callback CAS cannot reactivate the account.

### 8. Configuration and kill switches

- Add validated Threads app ID/secret, redirect URI, official base URLs/API
  version, app-review state, request/connect/read timeouts, and feature flags.
  `.env.example` contains placeholders/descriptions only.
- The real adapter is explicit opt-in. Missing/invalid credentials, redirect
  mismatch, unsafe URLs, fake adapter in production, or local encryption in
  production fail closed during composition.
- Add global social and Threads-specific connection/refresh kill switches.
  A switch stops new starts/provider work and yields a truthful safe state; it
  never bypasses auth, preserves existing encrypted records, and does not claim
  the user disconnected.
- App review is explicit validated runtime configuration such as
  `development`/`approved`; do not infer approval from requested/granted scope.
- Configuration diagnostics must report only safe booleans/classifications,
  never secret values or lengths that materially disclose them.

### 9. Persistence

- Add forward-only migration `0015_threads_account_lifecycle.sql`; never edit
  `0014` or earlier migrations.
- Add only normalized fields/tables needed for: reconnect target/expected
  identity, exchange stage, credential token kind/issue/refresh/expiry metadata,
  capability observation/freshness, status reason, refresh scheduling/claim/
  attempt metadata, optimistic versions, disconnection, and external revocation
  result.
- Use the repository's UUIDv7-compatible ID, UTC timestamp, version, composite
  workspace FK, bounded string/JSON, closed-value, and timestamp-ordering rules.
- Add indexes for bounded due-work selection, stale-lease recovery, account
  status lookup, and cleanup. Prevent cross-workspace account/OAuth/credential
  substitution structurally.
- General reads must not select credential ciphertext. Plaintext credentials
  remain accessible only through the narrow protector repository path.
- Migration must pass the repository validator twice from a clean PostgreSQL
  database and from the supported upgrade path.

### 10. API and OpenAPI

Preserve TASK-016 routes and add under `/api/v1`:

- `POST /workspaces/{workspaceId}/social-accounts/{accountId}/reconnect`
- `POST /workspaces/{workspaceId}/social-accounts/{accountId}/refresh`
- `DELETE /workspaces/{workspaceId}/social-accounts/{accountId}`

Requirements:

- All mutations are owner-only, require `Idempotency-Key`, validate origin/
  session CSRF, and use the existing idempotency request-hash semantics.
- Disconnect requires an exact current account version (`If-Match` or a runtime-
  validated equivalent consistent with repository conventions). Stale versions
  return safe `409`/`412` behavior rather than winning silently.
- Refresh returns a durable accepted/current safe result. Do not keep the HTTP
  request open for unbounded provider polling or claim success before the state
  transition commits.
- Use runtime schemas, multiplicity/size limits, workspace-scoped opaque IDs,
  RFC 9457 Problem Details, stable allowlisted error codes, and accurate
  `401/403/404/409/410/422/429/503` responses.
- Generate and commit OpenAPI. No token, secret, provider body, ciphertext,
  state/code, or internal lease fields may appear in schemas.

### 11. Frontend

- Extend the integrated Connections experience; do not create a provider demo.
- Show real Threads identity, environment, health/freshness, capability state,
  app-review gate, last checked/expiry where safe, and plain next actions.
- Owner can reconnect, retry refresh/recheck, and disconnect. Viewer/editor
  retain only the approved safe read behavior from TASK-016.
- Destructive disconnect requires a clear confirmation naming the destination
  and its effect. Disable duplicate submits, restore focus, announce results,
  and remain keyboard/screen-reader/reduced-motion accessible.
- If external revocation is unsupported/failed, distinguish “disconnected in
  Affiliate Content OS” from “removed from Threads” and present a manual
  provider-settings instruction. Never display false external success.
- Handle loading, stale, review-gated, degraded, reauth-required, kill-switched,
  provider-rate-limited, unsupported-revocation, and retryable errors without
  losing the previously known safe account state.
- Browser URL, storage, telemetry, DOM, state snapshots, and rendered errors
  must never contain provider token/code/state, app secret, or raw provider
  response.

### 12. Audit and observability

- Audit reconnect started/completed/rejected, refresh claimed/completed/
  deferred/failed, status transitions, credential rotation, local disconnect,
  and external revocation support/result with allowlisted metadata only.
- Correlate by opaque internal account/operation IDs. Do not log OAuth state,
  code, token, authorization header, ciphertext, provider body, app secret, or
  raw provider error.
- Add bounded counters/status hooks for adapter stage, safe error class,
  refresh deferral/rate limiting, CAS loss, reconnect mismatch, disconnect, and
  unsupported revocation using the existing observability boundary.
- Sanitize HTTP client diagnostics and traces before they reach repository
  logging. Tests must prove redaction for both success and adversarial errors.

## Expected files

Expected changes are primarily in:

- `packages/domain/src/social/**` and exports/tests
- `packages/application/src/social/**` and tests
- `packages/infrastructure/src/social/**`, PostgreSQL repositories, composition,
  configuration, and tests
- `packages/infrastructure/migrations/0015_threads_account_lifecycle.sql`
- `packages/config/**` and `.env.example`
- `apps/api/src/social/**`, worker/bootstrap wiring, route/OpenAPI tests
- `apps/web/src/components/connections/**`, API client/types/tests
- `openapi/openapi.json`
- relevant canonical documentation and operations notes

Keep changes cohesive. Do not stage or modify unrelated untracked `plans/`
content or `packages/application/src/workforce/affiliate-content-os.code-workspace`.

## Database changes

Forward-only migration `0015` only. Preserve migration `0014` exactly. Include
strong constraints, tenant-safe composite foreign keys, version/CAS data, due-
work indexes, and twice-run validation evidence.

## API changes

Add reconnect, refresh/recheck, and disconnect endpoints above; enrich safe
account/list/callback-result DTOs with allowlisted lifecycle/freshness/action
facts. Preserve all existing TASK-016 contracts unless a documented compatible
extension is required. No publication APIs.

## Frontend changes

Extend Connections for real Threads lifecycle and recovery actions with honest
status/revocation wording, role awareness, and accessibility. No Calendar or
publishing composer in this checkpoint.

## Backend changes

Real Threads auth/token/profile adapter, staged exchange recovery, capability
policy, refresh/reconnect/disconnect application services, PostgreSQL lifecycle
persistence and worker-compatible claims, configuration/kill switches, audit/
metrics, API wiring, and comprehensive mocked-provider tests.

## Security requirements

- Only official Meta endpoints and documented grants are allowed. No browser
  automation, scraping, private APIs, or fabricated provider success.
- App secret, access/refresh token, OAuth code/state, authorization header,
  ciphertext, raw provider body/error, and secret-derived values never cross
  DTO/log/audit/telemetry/queue/snapshot/Problem Details boundaries.
- Protect against SSRF, unsafe redirect following, DNS/base-URL confusion,
  query pollution, hostile provider strings, oversized JSON, content-type
  confusion, decompression abuse, timeout/resource exhaustion, and log
  injection.
- Protect reconnect identity substitution, cross-tenant IDOR/relational swaps,
  OAuth replay, refresh races, stale lease/CAS writes, callback-vs-disconnect,
  refresh-vs-disconnect, and duplicate remote calls with explicit tests.
- Decryption remains narrow; new tokens use fresh nonce and exact resource AAD.
  Production remains fail-closed without production-approved key integration.
- Provider error classification is allowlisted. Numeric/raw Meta details stay
  inside infrastructure and cannot influence authorization directly.
- Owner-only mutation enforcement must exist in application policy as well as
  route middleware. Never rely only on hidden UI controls.

## Edge cases

- User denial, missing/duplicate code or state, expired transaction, replay,
  wrong platform, or callback after disconnect/newer reconnect.
- Code-exchange timeout before issuance is known; token issued but long-token
  exchange/profile/grant inspection later times out or returns malformed data.
- Provider returns a different user during reconnect, missing/oversized/hostile
  identity fields, unknown scope, or duplicate identity already connected.
- Short token cannot be upgraded, public/private profile grant behavior differs,
  refresh is too early, token is expired/revoked, or provider omits expiry.
- Two workers/manual commands refresh simultaneously; worker crashes after
  claim, provider call, encryption, or before CAS; stale lease is reclaimed.
- Disconnect races callback or refresh; unsupported/failed external revocation;
  idempotent disconnect repeats; stale account version is submitted.
- Provider rate limit with/without valid `Retry-After`, transient `5xx`, invalid
  JSON/content type, redirect, slow body, connection reset, or auth error.
- Kill switch changes while work is claimed; app review changes from development
  to approved or back; capability evidence becomes stale.
- Encryption fails, unknown key version, AAD mismatch, database commit aborts,
  or credential rotation CAS loses. Last safe committed state must remain true.

## Acceptance criteria

1. Migration `0015` adds tenant-safe, constrained lifecycle/refresh/reconnect/
   disconnect persistence without modifying earlier migrations and validates
   twice on real PostgreSQL.
2. With mocked official transport, an owner completes official Threads staged
   OAuth into one correctly derived account state; requested scopes alone never
   enable a capability.
3. A post-token failure durably preserves the encrypted recoverable credential
   in a truthful non-active state; a pre-token or outcome-unknown exchange never
   fabricates success or blindly retries the code.
4. Refresh uses per-account serialization, provider calls outside DB
   transactions, version/CAS rotation, fresh authenticated encryption, bounded
   rate-limit deferral, and safe crash/stale-lease recovery.
5. Reconnect is identity-bound and rejects provider-account substitution;
   disconnect wins races, removes local usability, is idempotent, and never
   falsely claims unsupported external revocation.
6. Account health/capabilities derive centrally from verified identity, actual
   grants, credential validity, freshness, kill switches, and explicit app-
   review configuration. Media publishing remains disabled.
7. Owner-only reconnect/refresh/disconnect APIs, runtime schemas, idempotency,
   optimistic concurrency, Problem Details, and generated OpenAPI match actual
   behavior and expose no secrets.
8. Connections UI clearly and accessibly represents active, degraded,
   reauth-required, review-gated, disconnected, stale, rate-limited,
   kill-switched, and unsupported-revocation outcomes with correct actions.
9. Real provider URLs/version/scopes/app credentials/review state/timeouts and
   switches are validated configuration; unsafe/missing production composition
   and local key/fake adapter paths fail closed.
10. Unit, provider-contract, adversarial HTTP, PostgreSQL concurrency/recovery,
    API, frontend accessibility, and full-stack fake regression tests pass. No
    normal CI test or browser test makes a live Meta call.
11. Optional live smoke, when explicitly enabled, reads only safe identity/
    token metadata, never publishes/revokes, never prints secrets, and is not a
    prerequisite for deterministic CI.
12. TASK-016 flows remain green and this checkpoint introduces no schedules,
    publications, analytics, TikTok behavior, unofficial API, autonomous action,
    or infrastructure redesign.

## Test plan

Antigravity must add and run:

- domain/application unit tests for lifecycle derivation, partial exchange,
  authorization, idempotency, reconnect identity binding, refresh claims/CAS,
  disconnect races, and every closed state transition;
- real adapter contract tests with sanitized fixtures and mocked/injected HTTP
  for authorization URL, short/long exchange, refresh, profile/grant inspection,
  rate limits, auth/transient errors, redirects, malformed/oversized/hostile
  bodies, timeouts at every stage, and comprehensive redaction;
- crypto/repository tests for rotation, fresh nonce, exact AAD, prior-credential
  preservation, unknown key, and no general-read ciphertext selection;
- real PostgreSQL migration/isolation/constraint tests plus controlled barriers
  proving one refresh per version, stale-lease recovery, CAS loss, reconnect
  mismatch, duplicate identity convergence, and disconnect winning races;
- API/runtime-schema/OpenAPI tests for role/tenant/origin/CSRF/idempotency/
  optimistic concurrency/query pollution/Problem Details and secret absence;
- frontend tests for every lifecycle state/action, confirmation/focus/keyboard/
  screen-reader/reduced-motion behavior, duplicate submits, and truthful external
  revocation wording;
- full-stack fake OAuth regression and real-adapter-disabled behavior. Add an
  optional explicit non-destructive Threads smoke command only if it can be
  secret-safe and skipped by default.

Required gates before handoff:

- `pnpm check`
- `pnpm test:integration`
- `pnpm db:migrate:validate` twice
- `pnpm test:e2e:clean` (or the repository's exact clean full-stack command)
- `git diff --check 39cf414..HEAD`
- secret scan of the changed diff plus token/ciphertext/OpenAPI/browser-response
  boundary scans

Report exact commands, exit codes, test counts where available, final commit,
changed areas, and every deviation. Do not claim a gate passed unless it ran.

## Out of scope

- Threads post/container creation, publishing, polling, reconciliation, remote
  post deletion, publication scheduling, destination approval/consent, or
  Calendar/List publishing UI (TASK-018/TASK-019).
- Any TikTok integration, analytics synchronization, AI learning loop, media
  generation/editing/upload, replies, insights, search, engagement automation,
  scraping, moderation bypass, unofficial API, or browser automation.
- Selecting/implementing a cloud KMS vendor, obtaining Meta app review, changing
  provider-side settings on behalf of the operator, or claiming production
  readiness without those external prerequisites.
- Microservices, Kafka, Kubernetes, CQRS, event sourcing, or a second database.
