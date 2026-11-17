# TASK-014-REMEDIATION-02 — Close remaining compliance freshness and settlement gaps

## Objective

Close the remaining HIGH-severity gaps in Checkpoint D after commit `cd60e6f`. Make the three-phase compliance flow genuinely exact-revision, context-fresh, lease-fenced, budget-safe, and provably tied to the report used for human acceptance.

## Context

Codex reviewed the actual remediation diff. The main worker now calls the provider outside a transaction, but post-provider settlement rechecks only the artifact revision/content hash and code policy. It does not recheck content-brief/planning/evidence state. The exported compatibility function still invokes the provider inside its caller's transaction and the integration tests continue using that unsafe path. The enqueue payload does not capture `contentHashHex`, invalid-payload failure leaks the reservation and leaves related records non-terminal, several terminalizers omit lease-expiry checks, provider cost above the reservation is silently truncated, and acceptance only checks that a report artifact exists rather than proving its immutable content matches the evaluation/revision/policy.

## Required implementation

### 1. One production three-phase path only

- Remove or redesign `settleComplianceReviewJobAtomic` so no exported production/test path can call the provider while a database transaction or row lock is held.
- Update all integration tests to exercise `prepareComplianceReviewExecution` -> provider call outside a transaction -> `settleComplianceReviewExecutionAtomic`, or the real worker processor. Do not keep an unsafe compatibility wrapper merely for tests.
- The provider input hash created during prepare must be carried into settlement and verified/recomputed from the exact prepared input; do not compute and discard it.

### 2. Durable exact input snapshot and post-provider freshness

- At enqueue, read and validate the exact script revision and persist its 32-byte content hash as part of the durable compliance evaluation/job contract. Include a required 64-hex `contentHashHex` in the job payload and validate it strictly.
- During prepare, capture canonical hashes/fingerprints for the exact script content, current code policy, script lineage content-brief hash/version and planning revision set, authoritative context package, allowed/revoked evidence state, and provider input.
- Carry those bounded snapshots to settlement through trusted worker memory plus durable identifiers/hashes. At settlement, reload and compare all of them after acquiring the lease fence: current artifact revision/hash, evaluation version/hash, content brief, planning revisions, context package, allowed/revoked evidence, and provider input hash.
- Any post-provider difference must use the drift terminalizer: no valid report/findings, no approval eligibility, and reservation release exactly once.
- Add deterministic tests for post-provider brief drift, planning drift, context/evidence revocation/removal, policy drift, and provider-input mismatch, not only a changed artifact revision.

### 3. Complete lease and row-count fencing

- `settleCompliancePreflightBlockerAtomic`, `settleComplianceBudgetExhaustedAtomic`, and `settleComplianceDriftAtomic` must validate non-null unexpired lease, owner, job version, and running status under `FOR UPDATE`, exactly like success settlement.
- Every expected evaluation/operation/AI-run/job/work-item/assignment state transition must use appropriate prior-state/version predicates and verify affected row counts. A missing or already-transitioned related row must roll back rather than return success.
- Repeated delivery after a terminal result may return the already-persisted terminal outcome without changing budget, report, findings, or charges.

### 4. Invalid payload and failure cleanup

- Replace the worker's direct invalid-payload `UPDATE job_executions` with an atomic safe terminalization that releases the exact reservation once and terminalizes the linked operation, AI run, evaluation, work item, and assignment consistently where trusted job columns provide the linkage.
- Never leave a queued evaluation/operation or reserved budget behind after malformed payload handling. Do not trust payload fields during this cleanup.
- Add an integration test starting from a real enqueued job with a corrupted payload and assert zero provider calls, zero leaked reservation, and truthful terminal records.

### 5. Budget overage must fail closed

- If provider-reported cost is negative, non-finite, invalid, or greater than the reserved maximum, do not silently clamp and accept the result. Terminalize as a safe non-approvable accounting/provider error, release the reservation exactly once, and persist no valid report.
- For a valid cost, charge exactly the reported amount and release the entire reservation atomically; prove current spend/reserved spend with tests.

### 6. Report/evaluation binding and acceptance freshness

- Persist and expose a durable binding from the evaluation to the exact compliance report revision and report content hash, not only a mutable report artifact container. Add tenant-bound relational constraints where possible.
- Acceptance must load that exact immutable report revision and verify its evaluation identity, script artifact/revision/content hash, policy version/hash, result/counts, advisory success, and report hash against the evaluation. A mere artifact existence check is insufficient.
- Before inserting a human accept decision, rerun/reuse the authoritative freshness checks for lineage/context/evidence and current policy. Evidence revoked, removed, superseded, or made unaccepted after evaluation must make the evaluation stale and non-approvable.
- AI-advisory finding evidence IDs must be restricted to the exact allowed/package evidence snapshot. Strip or reject untrusted provider evidence IDs; never expose arbitrary cross-tenant IDs as evidence chips.
- Add acceptance tests for a mismatched report, advanced report container revision, and evidence/brief/planning drift after a previously successful evaluation.

## Expected files

- Compliance migration/schema, enqueue payload, worker processor/validator, prepare/settlement/failure helpers, acceptance transaction and report DTO/domain type.
- Infrastructure/worker/application/API tests and documentation affected by the corrected contracts.

## Database changes

Correct migration 0013 in place with the minimum fields/composite constraints needed to bind evaluations to exact script content and exact report revision/hash. Keep tenant isolation and terminal immutability intact.

## API changes

No new routes. Preserve safe typed error contracts and update schemas/OpenAPI only if persisted DTO fields change.

## Frontend changes

No redesign. Preserve truthful non-approvable state gating and evidence display; only adjust types/rendering if the corrected report contract requires it.

## Backend changes

Finish durable snapshot/freshness validation, remove the unsafe wrapper, add invalid-payload cleanup, enforce lease/row-count fencing, and bind acceptance to the exact immutable report.

## Security requirements

- Never call a provider while holding an open database transaction/row lock on any path.
- Never accept stale context/evidence or an unbound/mismatched report.
- Never trust payload/provider evidence identifiers without tenant/context validation.
- Never under-report provider cost to turn an over-budget result into an approvable success.

## Edge cases

- Brief/planning/context/evidence changes during provider call.
- Provider input object differs from its prepared hash.
- Malformed payload on a job with an active reservation.
- Lease expires before deterministic-only, budget, or drift terminalization.
- Provider reports negative, non-finite, or above-reservation cost.
- Compliance report artifact receives later revisions before acceptance.
- Evidence becomes revoked after a successful evaluation but before acceptance.

## Acceptance criteria

1. There is no code/test path that invokes compliance provider IO inside a database transaction.
2. Enqueued jobs durably bind exact script hash; prepare and settlement verify identical revision/policy/brief/planning/context/evidence/provider-input snapshots.
3. Every terminalizer enforces live lease/version/owner/status and checked state transitions.
4. Corrupt job payloads leak no reservation and leave no related queued/running records.
5. Invalid or above-reservation provider cost is non-approvable and never silently clamped.
6. Evaluation binds an exact immutable report revision/hash, and acceptance verifies that binding plus current authoritative freshness.
7. Provider-supplied evidence IDs cannot create arbitrary/cross-context evidence links.
8. All regression and repository gates pass.

## Test plan

- Add focused unit/integration/worker tests for every acceptance criterion with controlled barriers, counters, and exact database assertions.
- Run `pnpm check`.
- Run `pnpm test:integration`.
- Run `pnpm db:migrate:validate` twice.
- Run `git diff --check a0df855..HEAD`, OpenAPI sync, and a diff-scoped secret scan.

## Out of scope

- Checkpoint E, Sprint 4, publishing, social integrations, media generation, and infrastructure redesign.
