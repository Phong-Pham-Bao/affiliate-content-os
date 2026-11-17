# TASK-014-REMEDIATION-01 — Checkpoint D correctness, fencing, and fail-closed approval

## Objective

Fix the Checkpoint D implementation at commit `c4a0d3b` so compliance execution and human decisions satisfy `TASK-014` under drift, budget exhaustion, provider failure, retries, and concurrent decisions. Preserve the approved Checkpoint A–C behavior and the current tenant-scoped API/UX.

## Context

Codex reviewed the actual implementation and found release-blocking correctness gaps. The route shape and accepted lifecycle are correct, but the compliance worker currently queries the current artifact revision without comparing it, passes identical values as both sides of the content/brief drift checks, may call the provider when no budget was reserved, performs the external provider call while holding a database transaction and row locks, and permits acceptance after a failed advisory review. Evidence membership also fails open when the authoritative set is empty, and the decision layer does not prevent conflicting terminal decisions for one exact revision.

This is a remediation of Checkpoint D only. Do not begin Checkpoint E or Sprint 4.

## Required implementation

### 1. Real pre-provider and post-provider drift fencing

- Rework compliance execution into a safe prepare/call/settle flow consistent with the repository's established worker patterns. Do not hold a PostgreSQL transaction or row locks across the network provider call.
- Before any provider call, validate the claimed job lease/version/owner/status and the exact tenant/product/work-order/artifact/revision relationships.
- Compare the artifact's actual current revision to the requested revision; compare the persisted revision content hash to the hash captured for the evaluation/job; compare the evaluation policy version and policy hash to the current code-owned policy; and validate the frozen content-brief/planning lineage and authoritative evidence state.
- Capture a bounded immutable provider input snapshot/hash during prepare. After the call, open a settlement transaction and repeat the lease/version, exact revision/hash, current policy hash, lineage/context, and evidence checks before persisting findings, report, usage, or spend.
- If drift is detected before the provider, make zero provider calls. If detected after the provider, do not persist stale findings/report as valid and do not make the stale evaluation approvable. Terminalize honestly and settle/release any reservation exactly once.
- Duplicate delivery, expired lease, stale worker version, or repeated settlement must not create another report revision, finding set, charge, or terminal state transition.

### 2. Budget and provider-failure correctness

- A deterministic blocker must skip the provider and release the full reservation exactly once.
- If deterministic checks pass but the workspace cannot reserve the required bounded maximum provider spend, do not call the provider. Persist an honest non-approvable budget/error state that the API and UI can display and retry safely.
- Never charge more than the reserved maximum. Settle actual usage once and release the unused portion once. All budget mutations require fenced row-count checks and full rollback on partial failure.
- A provider error, invalid/failed structured output after the one allowed repair, or advisory execution failure must result in a non-approvable failed/error evaluation. Do not mark it `completed/passed` with `ai_advisory_status = failed`.
- Keep provider secrets, raw prompts, and raw provider error bodies out of persistence, logs, audit events, reports, and browser responses.

### 3. Fail-closed deterministic validation and lineage

- Stop passing tautological expected/actual values into deterministic compliance.
- Read the expected content-brief hash and planning revision set from the exact script revision lineage. Compare them with the current authoritative content brief and the current three planning artifact revisions.
- Load revoked/superseded evidence and pass it to the deterministic policy. A referenced `product_fact` or `analysis` must be a member of its authoritative allowed set even when that set is empty. Empty authoritative sets must therefore reject references, not disable validation.
- Block unknown evidence source kinds and references that cross workspace/product/context boundaries.
- Validate the exact artifact/product/work-order/revision/hash relationships in persistence, not from client/provider assertions.
- Add focused domain and integration tests proving empty-set fail-closed behavior, superseded evidence, brief/planning drift, content/current-revision drift, policy drift, and pre/post-provider races.

### 4. Approval validity and competing decisions

- Accept only an exact current `script_package` revision whose evaluation is terminal-successful, has no blockers, has a successful advisory status when advisory execution was required, points to the exact immutable compliance report, and matches both the current policy version and the freshly computed current policy hash.
- A provider/budget/error/stale evaluation is never approvable.
- Prevent conflicting terminal human decisions for the same exact revision. Concurrent or later accept-versus-reject attempts must fail safely with no second terminal decision or lifecycle reversal. Idempotent replay of the original command must still return the original persisted response.
- Enforce lifecycle and optimistic update preconditions in SQL and verify affected row counts for artifact, work order, and Chief of Staff transitions. Do not silently succeed if any expected state was not updated.
- Keep request-changes history immutable and exact-base-bound; a resulting new revision invalidates old approval only through exact revision/hash semantics.
- Add database uniqueness/constraints or transaction locking as appropriate, plus race tests for accept/accept, accept/reject, and reject/accept.

### 5. Terminal immutability and relational integrity

- Make completed/failed compliance evaluation meaning immutable after terminal settlement while still permitting the intended queued/running-to-terminal transition.
- Ensure evaluation uniqueness binds the exact policy version and hash and that an evaluation's report relationship is tenant-bound and relationally valid. Add any missing composite foreign key/unique/check constraints required by `TASK-014`.
- Fix the immutability test that currently updates a nonexistent `affiliate_disclosure_text` column; it must update a real snapshot column so the test proves the trigger, not a PostgreSQL undefined-column error.
- Prove terminal evaluation rows, findings, decisions, and snapshots cannot be mutated or deleted.

### 6. API/UI error truthfulness

- Map stale, budget, provider, policy, and conflicting-decision outcomes to safe typed Problem Details/statuses rather than message-substring-dependent 500s where practical within the existing architecture.
- Ensure Content Studio shows persisted budget/provider/stale/error states and keeps Accept disabled for every non-approvable state. Do not add fake progress or timer success.
- Keep authentication, `catalog.manage`, origin, idempotency, rate limits, no-store, viewer read-only behavior, and tenant isolation intact.

## Expected files

- Compliance orchestration/processor, enqueue/prepare/settlement, deterministic policy inputs, approval/rejection transactions.
- Migration `0013_compliance_human_approval.sql` (the branch is not approved/merged, so correct it in place) and relevant database documentation.
- Application error/result contracts, API handlers/schemas/OpenAPI, Content Studio state where needed.
- Domain, infrastructure, worker, API, and web regression tests.

## Database changes

Correct migration 0013 with terminal immutability, exact policy version/hash uniqueness, report linkage, and terminal-decision conflict protection. Keep all records tenant-bound and forward-only. Do not introduce publishing/social tables.

## API changes

Keep the existing tenant-scoped Checkpoint D routes. Only refine typed error/state contracts required for truthful drift, budget, provider, and decision-conflict behavior, updating committed OpenAPI and clients together.

## Frontend changes

Keep the current Content Studio design. Correct gating and persisted error rendering only where backend state changes require it.

## Backend changes

Implement two-phase provider execution, real pre/post drift validation, exact budget fencing, fail-closed evidence/lineage checks, immutable terminal evaluations, and conflict-safe human decisions.

## Security requirements

- All tenant, revision, context, evidence, policy, lease, budget, and decision checks fail closed.
- No network call while a database transaction holds orchestration row locks.
- No stale provider result can authorize acceptance.
- No AI/service/background path can create a human decision or approval snapshot.
- Never hard-code secrets or expose provider/raw-prompt details.

## Edge cases

- Current revision changes immediately before or during provider execution.
- Content brief/planning/evidence/policy changes before call or before settlement.
- Empty allowed fact/analysis set with referenced evidence.
- No available budget, actual usage below reservation, and reported usage above reservation.
- Provider error after reservation and malformed output after repair.
- Lease expires or is reclaimed during provider execution.
- Duplicate settlement after success/failure/drift.
- Two humans accept/reject the same exact revision concurrently or sequentially with refreshed versions.

## Acceptance criteria

1. Pre-provider drift makes zero provider calls; post-provider drift persists no valid stale report/evaluation and cannot be accepted.
2. No-budget state makes zero provider calls; provider failure is non-approvable; spend never exceeds and never settles more than once from its reservation.
3. Empty authoritative evidence sets, revoked evidence, and context/planning/brief drift fail closed with stable deterministic findings or safe terminal drift outcomes.
4. Acceptance verifies exact current revision/hash, current policy version/hash, successful evaluation/advisory/report, and zero blockers.
5. Exactly one terminal accept-or-reject decision can win for one exact revision; losing concurrent/conflicting commands roll back cleanly while same-key replay remains idempotent.
6. Terminal evaluation meaning, findings, decisions, and approval snapshots are database-immutable and tests exercise real columns.
7. API/UI expose safe truthful persisted states, and no Checkpoint E/Sprint 4 behavior is added.
8. All repository quality gates pass.

## Test plan

- Add focused unit/integration tests for every acceptance criterion, including provider-call counters and budget row assertions.
- Include controlled barriers/hooks in tests for post-provider drift and concurrent human decisions; do not use timing-only flaky races.
- Run `pnpm check`.
- Run `pnpm test:integration`.
- Run `pnpm db:migrate:validate` twice from clean migration validation state.
- Run `git diff --check a0df855..HEAD`.
- Run a diff-scoped secret scan and confirm committed OpenAPI is synchronized.

## Out of scope

- Checkpoint E visual office polish.
- Publishing, scheduling, OAuth, social APIs, media generation, analytics, or Sprint 4.
- Compliance overrides or additional infrastructure outside the modular monolith.
