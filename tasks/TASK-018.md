# TASK-018 — Sprint 4 Checkpoint C: Durable scheduling and publication core

## Objective

Implement the provider-neutral, durable publication core that turns one accepted
Sprint 3 content approval into one destination-bound human approval and one
scheduled Threads publication. Persist immutable approval/consent evidence,
schedule truth, fenced execution leases, stable attempts, audit/outbox evidence,
and truthful terminal or gated outcomes. Prove the complete flow with a
deterministic fake publication adapter; do not call Meta in this checkpoint.

## Context

Sprint 4 Checkpoints A and B are complete and Codex-approved through `b7206d0`.
The repository now has:

- immutable `content_approval_snapshots` bound to exact Sprint 3 artifact
  revision/content/policy evidence;
- owner-controlled Threads accounts, capability snapshots, encrypted
  credentials, health/reauthorization states, and lifecycle fencing;
- workspace roles/capabilities including `content.approve`,
  `publications.read`, and `publications.manage`;
- shared PostgreSQL idempotency, audit, outbox, job/lease, API Problem Details,
  worker composition, fake-adapter, OpenAPI, and clean-E2E conventions.

This checkpoint must extend that modular monolith. It must not create a parallel
`content_items`/`content_revisions` approval system from the older conceptual
documentation. The authoritative creative input is the accepted
`content_approval_snapshots` row and its exact `content_artifact_revisions`
binding.

Read before implementation:

- `AGENTS.md`;
- `docs/SPRINT-4-SOCIAL-PUBLISHING-PLAN.md`;
- `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`,
  and `docs/DECISIONS.md` (especially ADR-007 through ADR-010 and ADR-021);
- `tasks/TASK-013.md`, `TASK-014.md`, `TASK-015.md`, `TASK-016.md`, `TASK-017.md`,
  and their remediation tasks;
- migrations `0013` through `0020`, the actual workforce approval persistence,
  social lifecycle ports/persistence, HTTP idempotency/audit helpers, worker
  loop, outbox schema, API composition, and fake social adapter.

## Required implementation

### 1. Provider-neutral publication domain and state policy

- Add domain types and pure transitions for destination approval snapshots,
  publications, attempts, normalized publication outcomes, and safe errors.
- Publication states must distinguish at least:
  `scheduled`, `queued`, `publishing`, `processing_remote`, `published`,
  `retry_wait`, `outcome_unknown`, `failed`, `rejected`, and `canceled`.
- Define legal transitions centrally. Terminal states are immutable. Never map
  request acceptance, queue delivery, a container/operation ID, timeout, or
  local worker completion to `published`.
- `published` requires a nonempty normalized remote post ID and confirmed
  provider outcome. `outcome_unknown` forbids automatic or user blind retry.
- Keep provider DTOs, endpoints, numeric codes, and raw error bodies out of
  domain/application/API contracts.
- Validate all identifiers, enums, text/JSON sizes, counts, timestamps, URLs,
  and pagination inputs with explicit finite bounds.

### 2. Immutable destination-bound human approval and consent snapshot

- Add one authoritative immutable publication approval snapshot derived from an
  existing accepted `content_approval_snapshots` row.
- Creation is an explicit authenticated human editor/owner command requiring
  `content.approve` and `publications.manage`; workers, AI actors, service
  principals, and viewers cannot approve or consent.
- In one transaction, lock and revalidate the source content approval, exact
  artifact/revision/content hash, completed passing compliance evaluation,
  policy hash, disclosure state, destination social account, provider identity,
  account version/status, granted scope/capability snapshot, capability
  freshness, and platform kill switches.
- Freeze canonical, hash-bound evidence including:
  source content approval ID and snapshot hash; artifact/revision/content hash;
  workspace/platform/social-account/provider-account identity; account version;
  capability version/fingerprint and observed time; exact rendered text/preview
  hash; disclosure and platform settings; human actor/time; consent type and
  policy version. Store no credential or provider payload.
- The preview used for approval must be deterministically derived from the exact
  approved revision and bounded platform settings. A client-supplied preview
  hash is only an optimistic precondition and must match the server result.
- Snapshot rows are immutable at the PostgreSQL layer. Material content,
  destination, disclosure/settings, identity, or capability drift requires a
  new snapshot; never mutate the old evidence.
- Use `Idempotency-Key` with canonical request hashing. Same-key replay returns
  the original snapshot; different request bytes under the same key conflict.

### 3. Durable schedule, reschedule, cancel, and reads

- Create a publication only from one valid destination approval snapshot. One
  snapshot may create at most one publication; retries are attempts of that
  publication, never another publication row.
- Scheduling is an editor/owner human command requiring
  `publications.manage` and `Idempotency-Key`. It never calls a provider inline.
- Persist all three schedule facts: UTC instant, original offset-free local
  value, and canonical IANA timezone. Reject nonexistent or ambiguous local
  times unless the request unambiguously identifies the exact instant and the
  triple round-trips exactly. Reject past/too-soon and excessive-horizon values
  using centralized configurable bounds with safe documented defaults.
- Store a version for compare-and-swap. Reschedule is allowed only from
  `scheduled` before any execution lease/attempt; require expected version,
  exact schedule validation, idempotency, audit, and a replacement/superseding
  outbox wakeup without allowing the old wakeup to execute.
- Cancel is allowed only before an execution lease or provider-attempt phase;
  require expected version and idempotency. Replays are stable. Once a provider
  attempt may have started, reject cancellation rather than claiming remote
  cancellation.
- List/detail reads require `publications.read`, are workspace-scoped, bounded,
  cursor-paginated, and return safe status, exact schedule context, version,
  destination display facts, approval summary, attempt summaries, and actionable
  safe error/recovery state. Never expose credentials, provider payloads, raw
  errors, internal lease tokens, or secret-bearing outbox data.
- Cross-workspace IDs fail closed using the repository's established
  non-enumerating semantics.

### 4. Forward-only PostgreSQL persistence and constraints

- Add migration `0021_durable_publication_core.sql`; do not edit migrations
  `0001`–`0020`.
- Add normalized tables (names may follow repository conventions) for:
  immutable destination publication approval snapshots, publications, and
  publication attempts. Reuse `outbox_events`, `idempotency_keys`, and
  `audit_events` rather than duplicating them.
- Every relationship must be workspace-bound with composite foreign keys where
  available. Enforce exact source approval/revision/account lineage in the DB,
  not only application code.
- Add checks for statuses/phases, version/attempt bounds, timestamps, schedule
  context, hash lengths, safe text/JSON shapes, lease token/owner/expiry
  consistency, terminal completion, published remote identity, retry timing,
  and outcome/error combinations.
- Enforce one publication per destination approval snapshot, unique attempt
  numbers and stable attempt idempotency keys, and uniqueness of a confirmed
  `(social_account_id, remote_post_id)`.
- Approval snapshots cannot update/delete. Attempt structural/request fields
  cannot update/delete; only fenced lifecycle settlement fields may transition
  once according to the state machine. Terminal publications/attempts cannot
  regress.
- Add claim indexes for due schedules/retries and workspace list/detail indexes.
  Migrations must apply from empty DB, validate twice, and preserve all earlier
  checksums.

### 5. Outbox-compatible due scheduling and fenced execution

- Scheduling/rescheduling must atomically write publication state, a safe audit
  event, idempotency response, and a durable outbox wakeup with `available_at`
  no earlier than the selected instant. The outbox payload contains only IDs,
  versions, and correlation/causation data.
- Extend the existing worker composition with bounded polling for due
  publications. PostgreSQL remains authoritative; no in-memory timer or queue
  delivery is authoritative.
- Claim due rows using `FOR UPDATE SKIP LOCKED` or equivalent atomic CAS, a
  random lease token, worker ID, bounded lease expiry, and expected version.
  Duplicate/stale outbox delivery must be harmless.
- Before any provider call, revalidate in one fenced preparation transaction:
  exact approval/source revision and hashes, destination identity/account
  version, active connection, capability freshness and text-publish capability,
  granted scope/review gate, disclosure/settings/consent, schedule/cancellation,
  credential presence where the adapter requires it, and global/platform kill
  switches.
- Gating drift must produce a truthful safe state (`rejected`, `failed`, or a
  documented recoverable gate) with audit evidence and no provider call. Never
  silently substitute another revision/account/settings/capability.
- Persist a stable attempt ID, attempt number, request hash, adapter version,
  correlation ID, and phase before the provider call. Mark
  `provider_attempt_started` with checked fencing before leaving the transaction.
- Execute the adapter outside all database transactions with an application
  timeout shorter than the compatible lease budget. Every mark/settle/fail CAS
  must require exactly one row or raise a typed fence-lost error; a stale owner
  cannot call the provider or update dependent state.
- On confirmed fake success, atomically settle attempt and publication as
  `published` with remote ID/permalink/published time. On definitely-safe
  transient failure, use bounded exponential backoff/jitter and a configurable
  maximum attempt/time horizon. On permanent rejection, settle without retry.
  On timeout or possible acceptance, settle `outcome_unknown` and never enqueue
  a republish.
- Recovery of an expired lease whose phase says a provider attempt started must
  become `outcome_unknown`; it must not repeat the call. Expired pre-call claims
  may be safely reclaimed with a new fence.
- Worker-loop failures must be observed through secret-safe structured logging
  while the loop remains alive where safe.

### 6. Deterministic fake publication adapter

- Add a provider-neutral `SocialPublicationAdapter` port separate from OAuth
  lifecycle concerns.
- Implement a deterministic local/test fake adapter selected only by the
  established fake-adapter configuration. It must support confirmed success,
  safe transient failure/rate limit, permanent rejection, processing/unknown,
  timeout/hang, and exact call-count observation without real network access.
- Stable attempt identity/request hash must make duplicate delivery observable
  without creating a second fake remote post. Do not fake production success or
  enable fake mode in production.
- Real Threads publication remains unimplemented and feature-gated until
  TASK-019.

### 7. API contracts and composition

Add versioned `/api/v1` routes using repository auth, origin/CSRF, rate-limit,
idempotency, validation, audit, Problem Details, and safe-response conventions:

- `POST /workspaces/{workspaceId}/publication-approvals` — human editor/owner;
  create/replay an immutable destination approval snapshot.
- `POST /workspaces/{workspaceId}/publications` — human editor/owner; create a
  schedule from a snapshot; return `201 scheduled` and never publish inline.
- `GET /workspaces/{workspaceId}/publications` — viewer+ bounded filters/cursor.
- `GET /workspaces/{workspaceId}/publications/{publicationId}` — viewer+ detail.
- `PATCH /workspaces/{workspaceId}/publications/{publicationId}` — editor/owner
  reschedule with expected version and idempotency.
- `POST /workspaces/{workspaceId}/publications/{publicationId}/cancel` —
  editor/owner cancel with expected version and idempotency.

Exact request/response schemas must be documented and generated in OpenAPI.
Use `201` for new resources, stable replay semantics, `409` for state/version or
idempotency conflicts, `422` for approval/capability/schedule gates, `429` for
rate limits, and safe `5xx` Problem Details. Do not expose a generic retry route
for `outcome_unknown` in this checkpoint.

### 8. Documentation and release boundary

- Update architecture, database, API, security/threat, configuration/example
  environment, and Sprint 4 plan documentation with the implemented contracts,
  bounds, state machine, lease/retry/unknown semantics, and operational checks.
- Clearly preserve TASK-019 boundaries: no real Threads publish request,
  container/status/reconciliation implementation, media publish, Calendar UI,
  release approval, analytics, or TikTok.

## Expected files

Expected changes span:

- `packages/domain/src/publication/**` and exports/tests;
- `packages/application/src/publication/**` and ports/tests;
- `packages/infrastructure/migrations/0021_durable_publication_core.sql`;
- PostgreSQL publication persistence/transactions and integration tests;
- fake publication adapter and contract tests;
- `apps/api/src/publication/**`, schemas/routes/composition, OpenAPI and tests;
- `apps/worker/src/**` composition/loop and tests;
- relevant configuration, docs, and clean full-stack E2E fixtures/tests.

Do not modify unrelated user-owned untracked files under `plans/` or the
workspace file under `packages/application/src/workforce/`.

## Database changes

Forward-only migration 0021 for immutable destination approval snapshots,
publications, attempts, constraints, triggers, indexes, and workspace-bound
lineage. Reuse existing audit/outbox/idempotency tables.

## API changes

Add destination approval, schedule, reschedule, cancel, list, and detail routes
under `/api/v1`, plus generated OpenAPI contracts and typed safe errors.

## Frontend changes

No production Calendar/List experience in this checkpoint. Only minimal fake
full-stack test support may be added when needed to prove the API/worker flow.
User-facing scheduling/calendar UX belongs to TASK-019.

## Backend changes

Add publication domain/application modules, PostgreSQL persistence, outbox-aware
due execution, fake publication adapter, API composition, and worker processing.

## Security requirements

- Human-only destination approval, consent, scheduling, rescheduling, and
  cancellation with server-side workspace authorization.
- Exact immutable content/destination/settings/capability binding; drift fails
  closed before provider access.
- No token, credential, provider payload, signed URL, raw transport error,
  request body, or sensitive preview content in browser errors, logs, audit,
  outbox, metrics, or attempt metadata.
- No provider call in HTTP or database transactions.
- No provider call after failed/stale pre-call fencing.
- No blind retry after possible provider acceptance.
- Production cannot select fake adapters or local-only credential protection.
- Only official APIs may be implemented later; no browser automation/private
  endpoints/fake engagement/moderation or rate-limit bypass.

## Edge cases

- Cross-tenant source approval, social account, publication, or cursor ID.
- Source approval exists but exact revision/compliance/policy evidence drifts.
- Account disconnect/reconnect, provider identity change, version change,
  capability expiry, scope loss, review gate, or kill switch after approval.
- Same idempotency key same/different body; concurrent approval or schedule.
- DST nonexistent/ambiguous local time, timezone alias, offset mismatch, past,
  too-soon, and excessive-horizon schedule.
- Reschedule racing old outbox delivery; cancellation racing worker claim.
- Duplicate worker/outbox delivery and two workers claiming the same due row.
- Lease expiry before call versus after `provider_attempt_started`.
- Provider success followed by process crash; timeout/unknown outcome; stale
  completion/failure owner; rate-limit retry-after beyond horizon.
- Missing/corrupt credential, malformed fake result, duplicate remote ID,
  attempt exhaustion, and worker restart.
- Published/result reads remain truthful and secret-safe after every failure.

## Acceptance criteria

1. An editor/owner can derive one immutable destination approval from one exact
   accepted Sprint 3 content snapshot and active capable Threads account.
2. A human can schedule it with an exact timezone triple; the HTTP transaction
   makes no provider call.
3. The worker produces exactly one stable fake provider attempt and reaches
   confirmed `published` only with a remote post ID, or a truthful gated/failure/
   unknown state.
4. Duplicate delivery/concurrency cannot create a second remote post or corrupt
   attempts; every stale CAS fails closed.
5. Approval, account, capability, consent, kill-switch, or content drift blocks
   before the adapter call with safe audit evidence.
6. Reschedule and cancellation obey version/state/lease boundaries and cannot
   allow an obsolete wakeup to publish.
7. PostgreSQL enforces workspace lineage, immutable evidence, valid states,
   leases, attempts, timestamps, uniqueness, and terminal/published truth.
8. Viewer reads are accessible, bounded, tenant-safe, and contain no secrets;
   mutations are human editor/owner-only and idempotent.
9. Fake adapter is deterministic/test-only; no real Meta/TikTok call or TASK-019
   implementation is introduced.
10. Existing TASK-016/TASK-017 flows and all repository quality gates remain
    green.

## Test plan

Antigravity must run and report exact counts/results for:

- domain transition, validation, timezone, hashing, retry, and authorization
  unit/property tests;
- application use-case tests for approval/schedule/read/reschedule/cancel and
  every execution revalidation gate;
- fake adapter contract/call-count/timeout tests;
- controlled PostgreSQL integration tests for tenant lineage, immutability,
  idempotency, exact schedule round-trip, concurrent schedule, duplicate
  delivery, claim/fence/lease recovery, cancel/reschedule races, stable attempts,
  unknown outcome, retry exhaustion, audit/outbox atomicity, and migration
  constraints with exact side-effect counts;
- API composition/Problem Details/OpenAPI tests;
- worker integration and one clean full-stack fake flow:
  `accepted revision -> destination approval -> schedule -> worker -> confirmed
  fake post`, plus gated/unknown variants;
- `pnpm check`;
- `pnpm test:integration`;
- `pnpm db:migrate:validate` twice;
- `pnpm test:e2e:clean`;
- `git diff --check` and a diff-scoped secret scan.

## Out of scope

- Real Threads create-container/publish/status/reconciliation calls.
- Media upload or media publication.
- Calendar/List production UX and final Sprint 4 release polish.
- Manual or automatic retry of `outcome_unknown` without reconciliation.
- TikTok, analytics/learning loop, engagement/moderation automation, scraping,
  browser automation, unofficial APIs, microservices, Kafka, or a second DB.

Antigravity implements this task. Codex will review the user requirement, this
specification, the actual diff/code/migrations, and independently executed
evidence before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
