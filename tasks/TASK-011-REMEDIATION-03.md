# TASK-011-REMEDIATION-03 — Valid PostgreSQL Isolation and Clock-Skew Evidence

Status: Changes required by Codex review of commit `46ed162` on 2026-11-08

Owner: Antigravity (Implementation Engineer)

Reviewer: Codex (Lead Architect / CTO / Final Reviewer)

## Objective

Repair the remaining PostgreSQL integration tests so they create schema-valid fixtures and genuinely exercise the transaction boundary required by TASK-011.

## Context

The production remediation in `46ed162` correctly creates a transaction-owned persistence snapshot and uses PostgreSQL `transaction_timestamp()` for expiry. `pnpm check` passes with 1,699 tests.

Codex found that the PostgreSQL isolation fixtures cannot reach the workforce transaction:

- The cross-workspace test inserts an analysis in workspace 2 while referencing the product and fact set from workspace 1. Migration `0007_intelligence.sql` enforces `(workspace_id, product_id)` and `(workspace_id, product_id, fact_set_id)` foreign keys, so fixture insertion fails first.
- The same-workspace/wrong-product test creates another product but references the original product's fact set. The composite fact-set foreign key rejects that fixture before kickoff.
- The database-time integration test claims application clock skew but does not actually change `params.idempotency.createdAt`.

## Required implementation

1. Build schema-valid fixture graphs for both isolation tests.
2. For the cross-workspace case, create or reuse valid workspace-2 product, confirmed fact set, operation/AI run where required, and accepted analysis whose composite foreign keys all belong to workspace 2. Then submit that analysis ID to a workspace-1 kickoff and assert rejection occurs in the kickoff transaction.
3. For the same-workspace/wrong-product case, create a second product and its own confirmed fact set in workspace 1, then create an accepted analysis bound to that product/fact set. Submit it to the original product kickoff and assert transaction-boundary rejection.
4. Use collision-safe deterministic IDs and values so the full integration suite remains order-independent.
5. Make the database-time integration test actually poison application `createdAt` by constructing a cloned command with a far-future or far-past timestamp. Prove the result follows PostgreSQL time, not that value.
6. Verify rollback/no workforce residue for rejected kickoff commands.
7. Do not weaken foreign keys, edit migrations, or replace integration assertions with mocks.

## Expected files

- `packages/infrastructure/test/integration/workforce-kickoff-atomic.integration.test.ts`
- `packages/infrastructure/test/integration/workforce-idempotency-concurrency.integration.test.ts`
- fixture helpers only if a small reusable schema-valid graph builder is justified

No production-code change is expected.

## Database changes

None. Do not edit migrations.

## API and frontend changes

None.

## Security requirements

- Tests must reach and prove the workforce transaction's workspace/product checks.
- Do not bypass or disable composite foreign keys.
- Preserve zero-residue rollback assertions.

## Acceptance criteria

1. Both isolation fixtures satisfy all migration `0007` foreign keys before kickoff is called.
2. Cross-workspace and same-workspace/wrong-product kickoff calls reject with `WorkforceAnalysisNotAcceptedError`.
3. Rejected calls leave no context package, work order, idempotency row, or audit event for the attempted command.
4. The database-time integration test supplies a deliberately skewed application `createdAt` and still follows PostgreSQL time.
5. Focused tests and `pnpm check` pass.
6. `pnpm test:integration` and migration validation are run if Docker becomes available; otherwise report the exact environmental blocker once.
7. `git diff --check 46ed162..HEAD` passes and unrelated `plans/` files remain untouched.

## Test plan

- Review migration `0007_intelligence.sql` composite foreign keys while constructing fixtures.
- Run focused workforce unit tests.
- Run `pnpm check` once.
- Attempt Docker/PostgreSQL once; if available, run focused workforce integration tests, full integration, and migration validation twice.
- Commit and push only the remediation files.

## Out of scope

- Production architecture changes
- New migrations
- Checkpoint B, HTTP, UI, provider execution, reporting, publishing, or analytics

## Implementation handoff

Antigravity must implement this task on `agy/task-011-sprint3-checkpoint-a`, commit and push, and report the final SHA and exact evidence. Do not modify or stage unrelated untracked `plans/` files.
