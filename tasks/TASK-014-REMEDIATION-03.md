# TASK-014-REMEDIATION-03 — Final lease ownership and transition audit

## Objective

Close the final Checkpoint D concurrency and verification gaps found in commit `fa06de6`, then prove the production worker and human acceptance paths are fully fenced.

## Context

The malformed-payload terminalizer accepts `workerId` but ignores it, receives no claimed `jobVersion`, does not inspect `lease_expires_at`, and updates a job by ID/workspace alone. A stale worker can therefore fail and release the reservation of a job that has expired and been reclaimed by another worker. The same function and several provider failure/cost branches do not verify all expected affected row counts despite the task contract. Acceptance also iterates a nonexistent `video.evidenceIds` field instead of the actual `evidenceReferences` structure, and its report equality check omits `infoCount` and `deterministicPassed`.

## Required implementation

### 1. Fence malformed-payload cleanup

- Require `workerId` and the claimed `jobVersion` in `SettleComplianceMalformedJobParams`.
- Lock the job and verify `status = running`, exact version, exact lease owner, non-null lease, and unexpired lease before releasing budget or changing any state.
- If the fence is stale, throw/return the standard lease-expired outcome and make zero mutations. The processor must pass the snapshot version and handle this identically to other lease loss.
- Update the job using the same owner/version/running predicates and verify exactly one affected row.
- Verify expected row counts for the linked operation, AI run, compliance evaluation, work item, and assignment. Roll back on partial/missing state instead of silently committing an inconsistent cleanup.
- Add controlled integration tests showing an expired/reclaimed stale worker cannot release reservation or mutate the new owner's job, evaluation, or linked state.

### 2. Complete transition row-count audit

- Audit every Checkpoint D settlement branch (preflight blocker, budget exhausted, drift, provider failure, invalid/over-reservation cost, successful settlement, malformed payload) and every report-container update.
- Add correct prior-state/lease/version predicates and require the expected row count for operation, AI run, job, evaluation, work item, assignment, report artifact, and budget updates.
- Budget release/settlement must include a fail-closed predicate that the workspace reserved amount is at least the job's reservation; do not use `GREATEST` to hide an accounting invariant violation.
- Optional linked rows may be skipped only when the trusted job relationship is genuinely null; a non-null linked ID must update exactly one row.

### 3. Finish acceptance contract checks

- Validate script video evidence using the real `evidenceReferences` entries (`sourceKind`, `sourceId`), not `video.evidenceIds`.
- Compare the immutable compliance report's `infoCount` and `deterministicPassed` as well as all already-checked fields against the evaluation.
- Bind/persist the evaluated `context_package_id` (and a canonical authoritative evidence snapshot hash if needed) so acceptance proves the work order still points to the same frozen context package used by the successful evaluation, not merely a different package containing similar IDs.
- Keep all new evaluation/report/snapshot fields tenant-bound, immutable, and documented.

## Expected files

- Compliance settlement/worker params and processor, migration 0013/evaluation mapper, acceptance transaction, focused integration/worker tests, and affected documentation/types.

## Database changes

Correct migration 0013 in place only if an evaluated context binding field is required. Preserve exact report/revision/hash foreign keys and terminal immutability.

## API changes

No new routes. Update DTO/OpenAPI only if a new persisted field is intentionally exposed.

## Frontend changes

None expected beyond type synchronization if necessary.

## Backend changes

Fence malformed cleanup, complete affected-row enforcement, enforce exact reservation predicates, and finish acceptance evidence/report/context verification.

## Security requirements

- A stale or wrong worker must never release another worker's reservation or terminalize its records.
- Accounting inconsistencies must fail closed and roll back.
- Acceptance must use the exact evaluated context and actual evidence-reference schema.

## Edge cases

- Payload parse fails after lease expiry and another worker reclaims the job.
- Linked assignment/work item is missing or already terminal.
- Workspace reserved amount is unexpectedly less than the job reservation.
- Work order context package changes after evaluation.
- Report `infoCount` or `deterministicPassed` differs from evaluation.

## Acceptance criteria

1. Malformed cleanup requires and verifies live owner/version/lease fencing before all mutations.
2. Every non-null linked state transition and budget transition checks predicates and affected row count.
3. A reclaimed-job race test proves the stale worker makes zero mutations.
4. Acceptance uses `evidenceReferences`, verifies all report counts/deterministic status, and rejects a changed context package.
5. All repository gates pass and no Checkpoint E/Sprint 4 behavior is added.

## Test plan

- Add focused integration/worker tests for stale malformed cleanup, missing linked rows, reservation invariant failure, context-package drift, and report-field mismatch.
- Run `pnpm check`, `pnpm test:integration`, and `pnpm db:migrate:validate` twice.
- Run `git diff --check a0df855..HEAD`, OpenAPI sync, and a diff-scoped secret scan.

## Out of scope

- Checkpoint E, Sprint 4, publishing, social integrations, and UI redesign.
