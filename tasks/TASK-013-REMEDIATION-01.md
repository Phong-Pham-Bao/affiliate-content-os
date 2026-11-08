# TASK-013 REMEDIATION 01 — Checkpoint C correctness and security hardening

## Objective

Fix the Checkpoint C review findings so script settlement, targeted regeneration, immutable revisions, tenant lineage, evidence validation, and mutation replay are safe under retries, stale leases, concurrent edits, and hostile input.

## Context

Checkpoint C implementation commit `93090d4` is not approved. Codex reviewed the actual implementation against `TASK-013.md` and found HIGH-severity gaps not covered by the current passing tests. Preserve the modular-monolith architecture and the existing PostgreSQL job, lease, budget, idempotency, authorization, and artifact contracts.

## Required implementation

1. Fence every script settlement outcome before any durable side effect.
   - For success, transient failure, repair, and terminal failure, require the exact job `workspace_id`, claimed `version`, `status = 'running'`, and `lease_owner = workerId`.
   - Check affected-row counts and throw so the surrounding transaction rolls back on stale/duplicate settlement.
   - A stale worker must not release/resettle budget, alter a unit, fail a change request/work item/order, or change operation/AI-run state.
   - Budget updates must prevent reserved spend from becoming negative and must affect exactly one policy row.

2. Make manual revision and request-changes mutations genuinely idempotent.
   - Require, validate, hash, and persist `Idempotency-Key` using the repository's established advisory-lock/request-hash pattern.
   - Same principal/route/key/request must return the original persisted result and status without another revision, change request, job, unit, or reservation.
   - Same key with different input must return the established safe idempotency conflict.
   - Align Fastify schemas, handlers, application ports/use cases, PostgreSQL transactions, web clients, and OpenAPI.

3. Prevent stale targeted regeneration from overwriting newer content.
   - At final change-request assembly, lock the artifact and require its current revision/hash to still equal the change request's exact base revision/hash.
   - If a manual edit or another change request completed first, create no artifact revision or lineage row and do not move the current revision backwards or merge onto stale content.
   - Persist an honest terminal conflict/failure state and safe reason for polling; keep the newer revision current/readable.
   - Ensure repeated/duplicate assembly remains idempotent.

4. Fail closed on authoritative context and lineage.
   - Request-changes must fail if its content brief is missing; never substitute an all-zero hash.
   - Initial and change-request assembly must verify every source unit uses the expected identical brief hash and that the exact planning revisions recorded by the brief are still the artifact current revisions for the same workspace/order/product.
   - Persist the real planning revision lineage for change-request revisions rather than `{}`.

5. Validate all evidence used anywhere in a manual package.
   - Validate the union of package-level and every video's evidence references against confirmed/allowed facts and accepted analyses scoped to the artifact workspace/product and authoritative context.
   - Reject unvalidated, cross-product, cross-workspace, missing, duplicate-count-bypass, or structurally inconsistent references.
   - Enforce that package-level evidence and video-level evidence have a coherent canonical relationship so a client cannot hide unsupported video evidence by omitting it at package level.

6. Harden database tenant and uniqueness guarantees with a new forward-only migration (do not rewrite an already-applied migration checksum).
   - Add composite workspace foreign keys from `script_generation_units` to operations, AI runs, and jobs.
   - Add database uniqueness sufficient to prevent duplicate initial video units and duplicate change-request video units, including PostgreSQL-null semantics for the initial set.
   - Add any minimal tenant-bound constraints needed to guarantee referenced brief/unit/lineage data cannot cross workspaces, products, orders, artifacts, or revisions.

7. Preserve exact provider provenance and accounting.
   - Persist the actual prompt template/version, provider/model, usage, and costs represented by successful source units/package lineage; do not hard-code a provider/model that can disagree with the gateway result.
   - Do not expose prompts, secrets, or raw provider error bodies.

## Expected files

- `tasks/TASK-013-REMEDIATION-01.md` (read-only implementation specification)
- New forward-only infrastructure migration after `0010`
- Script settlement, assembly, request-changes, manual revision, and query adapters
- Workforce application ports/use cases and API handlers/schemas/OpenAPI
- Web revision mutation clients where required for idempotency
- Focused unit and PostgreSQL integration tests
- Relevant architecture/database/API documentation if contracts change

## Database changes

Add a forward-only migration for composite tenant constraints and unit uniqueness. Reuse `idempotency_keys`; do not introduce a parallel idempotency store. Any new persisted provenance must be minimal, normalized where appropriate, bounded, and tenant-scoped.

## API changes

Both Checkpoint C mutation routes must require and actually enforce `Idempotency-Key`. Replay returns the persisted original result; key reuse with different input uses the existing Problem Details mapping. Stale assembly is visible through the existing change-request polling contract without leaking internals.

## Frontend changes

Generate a stable idempotency key per user submission and reuse it for transport retries. Do not silently generate a new key for the same in-flight save/request. Show persisted success only after the server response and show stale/conflict states honestly.

## Backend changes

Apply lease/version/owner fences, atomic budget checks, idempotent mutation transactions, authoritative-context revalidation, evidence-union validation, stale-base assembly rejection, tenant constraints, and real provenance persistence.

## Security requirements

- No stale or duplicate worker may charge/release budget or mutate state.
- No cross-tenant/product/order/artifact linkage is accepted at either SQL or application boundaries.
- Unsupported claims cannot enter a manual revision via nested video evidence.
- Idempotency records and audit data remain allowlisted; prompts, secrets, and sensitive errors remain server-only.
- AI still cannot approve, publish, accept policy, or execute Compliance Review.

## Edge cases

- Lease expires after provider response and a second worker reclaims the job.
- Duplicate terminal failure arrives twice.
- Two identical mutation requests arrive concurrently with the same idempotency key.
- A key is reused with a different request body.
- Manual edit completes while targeted regeneration is running.
- Two change requests from the same base finish in either order.
- Content brief or one planning revision is missing/superseded before assembly.
- Nested video evidence is absent from package evidence or belongs to another product.
- Null `change_request_id` attempts to bypass unit uniqueness.

## Acceptance criteria

1. Stale lease/version/owner settlement in every outcome changes zero durable state and rolls back fully.
2. Budget reserved/current amounts settle or release exactly once and never become negative.
3. Mutation replay creates exactly one result and one reservation; mismatched key reuse is rejected safely.
4. A regeneration whose base is no longer current creates no revision and cannot overwrite the newer revision.
5. Missing/changed authoritative context fails closed before assembly.
6. Every nested and package evidence reference is authoritative and tenant/product scoped.
7. Database constraints reject cross-workspace operation/run/job linkage and duplicate initial/change-request video units.
8. Persisted provenance reflects the actual gateway outcome rather than hard-coded values.
9. Existing Checkpoint C UX remains readable and honest; no fake success/progress is introduced.
10. All repository quality gates pass.

## Test plan

- Add focused unit tests for idempotency parsing/hashing, nested evidence validation, and safe conflict mapping.
- Add PostgreSQL integration tests for all four stale settlement outcomes and atomic budget rollback.
- Add concurrent same-key replay/different-payload tests for both mutation routes.
- Add races: manual edit versus regeneration and two regenerations from one base.
- Add context drift, missing brief, mixed brief hashes, tenant FK, and null-aware unit uniqueness tests.
- Verify actual provider/prompt/model/usage lineage persistence.
- Run `pnpm check`, `pnpm test:integration`, `pnpm db:migrate:validate` twice, `git diff --check 93090d4..HEAD`, and a secret scan.

## Out of scope

- Compliance Reviewer execution or approval decisions.
- Media generation, publishing, scheduling, social OAuth, or analytics.
- Redesigning the content studio or replacing the existing job/idempotency architecture.
