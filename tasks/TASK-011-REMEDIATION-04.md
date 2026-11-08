# TASK-011-REMEDIATION-04 — PostgreSQL Integration Failures

Status: Changes required by Codex PostgreSQL run on 2026-11-08

Owner: Antigravity (Implementation Engineer)

Reviewer: Codex (Lead Architect / CTO / Final Reviewer)

## Objective

Fix the five real-PostgreSQL test failures exposed after Docker became available, without changing correct production behavior or weakening database constraints.

## Evidence

`pnpm test:integration` on commit `77a394f` produced 33 test files, 207 tests, with 5 failures:

1. Two idempotency expiry tests update only `expires_at` into the past and violate `idempotency_keys_timestamp_check`, which requires `expires_at > created_at`.
2. Three workforce TOCTOU tests expect `StaleVersionConflictError`, but the approved workforce transaction correctly throws the workforce-specific `WorkforceStaleContextError` with code `WORKFORCE_STALE_CONTEXT`.

## Required implementation

1. In both expiry integration tests, create a schema-valid expired row by updating `created_at` and `expires_at` together so `created_at < expires_at < PostgreSQL transaction time`.
2. Keep the clock-skew proof intact: application `createdAt` must remain deliberately far past/future while database timestamps determine expiry.
3. Update the three product/fact-set/analysis TOCTOU assertions to expect `WorkforceStaleContextError` and, where useful, verify its expected/actual version fields.
4. Do not change production error types, database constraints, or migrations merely to satisfy tests.
5. Run focused workforce PostgreSQL integration tests first, then the full integration suite.
6. If all integration tests pass, run `pnpm db:migrate:validate` twice and `pnpm check` once.
7. Commit and push only remediation files; leave unrelated `plans/` files untouched.

## Expected files

- `packages/infrastructure/test/integration/workforce-idempotency-concurrency.integration.test.ts`
- `packages/infrastructure/test/integration/workforce-kickoff-atomic.integration.test.ts`

## Acceptance criteria

1. Expired-row setup satisfies `idempotency_keys_timestamp_check` while remaining expired relative to PostgreSQL time.
2. All workforce TOCTOU tests assert the approved workforce-specific error contract.
3. Focused and full PostgreSQL integration suites pass.
4. Migration validation passes twice.
5. `pnpm check` and `git diff --check 77a394f..HEAD` pass.
6. No production code, migration, or unrelated artifact is changed.

## Out of scope

- Production redesign
- New migrations
- HTTP, UI, provider execution, reporting, publishing, or analytics

## Implementation handoff

Implement autonomously on `agy/task-011-sprint3-checkpoint-a`, commit, push, and report exact commands, counts, and exit codes.
