# TASK-012 Remediation 01 — Checkpoint B correctness and production wiring

## Objective

Fix the HIGH-severity correctness, fencing, tenant-integrity, concurrency, retry, and UI-wiring defects found by Codex in commit `ab740a927c04cc2ce5a7d2bfed9c5683ec3c6266`. Preserve the TASK-012 architecture and complete its original acceptance criteria without expanding into Checkpoints C, D, or E.

## Context

The initial Checkpoint B implementation compiles and its current tests pass, but review of the actual implementation found paths that are broken or insufficiently fenced in production. Passing the existing suite is not evidence that these paths are correct because the missing behavior is not covered by the current tests.

## Required implementation

### 1. Repair the real PostgreSQL retry path

- In `retry-work-order-transaction.ts`, use the actual `job_executions.ai_run_id` column. The current `ai_runId` identifier is invalid PostgreSQL schema usage.
- Build retry job payloads with every field required by `parseAndValidateWorkforcePlanningPayload`, including the authoritative `contextPackageId` from the locked work order.
- Keep prompt template names, role/task/artifact mappings, reservation values, and linkage consistent with initial kickoff.
- Ensure a retry-created job can be claimed, reconstructed, executed, settled, and persisted end to end.
- Preserve concurrency-safe repeated retry behavior: only genuinely failed recoverable planning items may be retried and two racing retry requests must not double-reserve or double-enqueue.

### 2. Restore complete lease and structural fencing

- Before any artifact write, state transition, or charge, compare database time with `lease_expires_at`; an expired or missing lease must fail closed with `JobLeaseExpiredError`.
- Under the same settlement transaction, lock and verify the linked job, operation, AI run, work item, assignment, work order, product, task key, role, artifact type, workspace, and IDs. Do not trust payload linkage alone.
- Scope all mutation and lookup predicates by the appropriate workspace/work-order identifiers even where UUID primary keys are globally unique.
- Make state transitions conditional on the expected non-terminal state and verify affected-row counts. A stale, duplicated, or mismatched worker must create no artifact, revision, evidence row, spend, or projection transition.
- Make reservation settlement exact and non-negative. Verify the policy update succeeded. Reject unsafe/invalid actual cost and prevent silent spend beyond the reserved bounded amount or policy contract.
- Preserve atomic rollback when any artifact/evidence/state/budget operation fails.

### 3. Implement PostgreSQL-backed per-workspace provider concurrency

- Enforce a maximum of three simultaneously running `workforce_planning` provider jobs per workspace in the durable claim path.
- The limit must be decided atomically in PostgreSQL and remain correct with multiple worker processes. An in-memory counter is not acceptable.
- Do not reduce or break existing analysis-job claim/reclaim semantics.
- Expired leases must stop counting as live concurrency, while non-expired running jobs count.
- Add a multi-connection integration test proving three claims succeed for one workspace, the fourth does not claim while those leases are live, and a different workspace can still claim its own job.

### 4. Make exhausted/expired workforce jobs settle workforce projections correctly

- The generic exhausted-job sweep currently only terminalizes job/operation/AI-run records and emits an analysis-oriented audit event. For `workforce_planning`, atomically release its exact reservation and transition the linked work item, assignment, and work order to honest failed/recoverable state with an allowlisted workforce audit event.
- Do not leave a workforce work item queued/running while its job is terminally failed.
- Keep existing analysis behavior unchanged.

### 5. Implement the structured-output repair attempt

- Invalid structured planning output must receive at most one durable repair attempt using the existing `repair_attempt` / `max_repair_attempts` contract and repair feedback.
- The first invalid output must not immediately become terminal when a repair is available.
- The repair must not double-charge, double-reserve, create a partial artifact, or make more than one provider call per leased attempt.
- A second invalid result becomes terminal and releases the reservation exactly once.

### 6. Fix tenant integrity in migration 0009

- Bind `artifact_evidence_refs.workspace_id` to the referenced exact artifact revision using a composite foreign key. Add the required matching unique key on the revision table if necessary.
- Retain immutable revision/evidence behavior.
- Add PostgreSQL tests proving a cross-workspace evidence row cannot reference another workspace's artifact revision.
- Because migration 0009 is not merged/released yet, correct it in place and keep migration validation/idempotency green.

### 7. Wire the web command center to real product state

- Do not default `aiEnabled` to `true` or available budget to an invented large value in production UI.
- Load or pass real accepted analyses for the current product. The current product detail integration omits `acceptedAnalyses`, which makes the assignment dialog permanently disabled.
- Use real confirmed-fact status, real AI policy enablement, and real available/reservable budget or show an honest unknown/loading state that does not permit an unsafe optimistic submission.
- Reset selected analyses correctly when the product/workspace or fetched analysis set changes.
- Ensure the command center list is product-scoped. A product detail page must not display unrelated work orders from the same workspace.
- Preserve accessible loading, disabled-reason, error, partial-success, retry, and keyboard behavior.

### 8. Close the API and integration test gaps

- Add API tests for unauthenticated access, viewer/read vs `catalog.manage`, mutation origin, idempotency replay/conflict, validation, tenant mismatch/not-found behavior, no-store headers, pagination, retry races, and safe Problem Details.
- Add real PostgreSQL retry execution tests rather than only mocked route tests.
- Add lease-expiry, stale-version/owner, structural-linkage mismatch, settlement row-count, cross-tenant artifact/evidence, budget race/accounting, repair-once, exhausted workforce projection, and per-workspace concurrency tests.
- The controlled fake-provider test must exercise the production worker processor/validator path, not manually bypass validation by calling settlement directly.

## Expected files

Primarily the existing TASK-012 worker, workforce infrastructure, migration, API tests, web product/workforce components, and their focused tests. Keep changes scoped to the defects above.

## Database changes

Correct migration 0009 tenant constraints. No new migration number is required because 0009 is unreleased. Do not weaken existing constraints.

## API changes

No new endpoint family. Existing Checkpoint B contracts may be extended only where needed to expose real readiness/policy/budget data safely.

## Frontend changes

Connect the existing command center to real accepted analyses, confirmed context, AI policy, budget/readiness, and product-scoped work orders. Remove optimistic fake defaults.

## Backend changes

Repair retry payload/SQL, settlement fencing/accounting, durable repair, workspace concurrency, and exhausted workforce handling.

## Security requirements

- Fail closed on missing/expired leases, linkage mismatch, unknown readiness/policy data, cross-workspace references, and failed conditional updates.
- Never expose provider secrets, raw prompts, directive/source content in logs/audit events, or unsafe provider error detail.
- Preserve authorization and origin protections.

## Edge cases

- Lease expires between provider response and transaction settlement.
- Two retry requests race for the same failed item.
- A fourth workforce job exists while three live jobs are running in the same workspace.
- Another workspace has capacity while the first is saturated.
- First and second structured outputs are invalid.
- Policy reservation row is unexpectedly smaller than the job reservation.
- Product/workspace switches while web requests or polling are in flight.
- Accepted analyses refresh after the dialog has mounted.

## Acceptance criteria

1. A retry-created workforce job executes successfully through the production worker path.
2. Expired/stale/mismatched workers cannot persist artifacts or charge.
3. PostgreSQL enforces at most three live workforce provider jobs per workspace across worker processes.
4. Exhausted workforce jobs leave all workforce projections and reservation accounting honest.
5. Invalid output gets exactly one repair opportunity and then succeeds or fails terminally without duplicate accounting.
6. Cross-workspace evidence-to-revision references are rejected by the database.
7. The real product page can assign a valid mission when prerequisites exist and cannot rely on fake AI/budget/readiness defaults.
8. Work-order display is product-scoped.
9. All focused regression tests and all repository quality gates pass.

## Test plan

- Run focused unit/API/web tests while iterating.
- Run the PostgreSQL integration suite, including new multi-connection concurrency, retry execution, fencing, tenant-integrity, repair, accounting, and exhausted-job tests.
- Run `pnpm check`.
- Run `pnpm test:integration`.
- Run `pnpm db:migrate:validate` twice.
- Run `git diff --check fcaa0225acb66dcf670d996426867ac590991097..HEAD`.
- Inspect staged files and exclude all unrelated untracked `plans/` content.

## Out of scope

- Scriptwriter execution, compliance review, human approval (Checkpoint C).
- Media generation (Checkpoint D).
- Animated office/release polish (Checkpoint E).
- New provider integrations or infrastructure architecture.
