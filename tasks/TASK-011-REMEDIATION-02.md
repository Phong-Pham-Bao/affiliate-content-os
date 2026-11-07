# TASK-011-REMEDIATION-02 — Verified Persistence Snapshot and Database-Time Expiry

Status: Changes required by Codex review of commit `56d87c1` on 2026-11-08

Owner: Antigravity (Implementation Engineer)

Reviewer: Codex (Lead Architect / CTO / Final Reviewer)

## Objective

Close the remaining Sprint 3 Checkpoint A correctness gaps so the values persisted by kickoff are exactly the immutable values verified under transaction locks, and idempotency expiry is decided with PostgreSQL transaction time.

## Context

Codex reviewed `35294ef..56d87c1`. The remediation passes `pnpm check` (118 test files, 1,693 tests), but cannot be approved because `executeKickoffWorkOrderTransaction` verifies defensive copies and one analysis collection, then `insertKickoffEntities` rereads mutable values and a separate analysis collection from the original command. The expiry decision also uses application time instead of PostgreSQL transaction time.

## Required implementation

1. At transaction entry, create one immutable persistence snapshot containing every byte array and collection that will be verified or inserted.
2. Use the same copied key hash for advisory locking, lookup, and idempotency insertion.
3. Use the same copied request hash for live-row comparison and idempotency insertion.
4. Use the same copied context hash for canonical comparison and context-package insertion.
5. Normalize/copy the source-analysis descriptor once. Lock and verify that exact collection, then insert links from the verified collection. Do not trust a second caller-controlled `sourceAnalysisIds` collection. Remove the redundant field if this can be done without unnecessary expansion; otherwise fail closed when the collections differ.
6. Ensure a crafted or concurrently mutated command cannot link an analysis from another product, change persisted hashes, or make the persisted context differ from the canonical descriptor.
7. Query PostgreSQL transaction time inside the transaction and compare `expires_at <= transaction_time`. Do not use `Date.now()`, a newly constructed application date, or caller-supplied `createdAt` for the expiry decision.
8. Keep replay, conflict, advisory-lock, version-lock, rollback, and sanitized-error behavior intact.
9. Keep fault injection test-only/infrastructure-local and do not add production flags or partial commits.

## Expected files

- `packages/application/src/workforce/*` if the redundant source-ID contract is removed
- `packages/infrastructure/src/workforce/kickoff-work-order-transaction.ts`
- `packages/infrastructure/src/workforce/kickoff-work-order-row-inserts.ts`
- focused unit and PostgreSQL integration tests

Do not modify unrelated `plans/` artifacts.

## Database changes

No migration is expected. Do not edit migrations `0001` through `0008` unless a previously undocumented schema defect makes the fix impossible; report that before changing schema.

## API changes

None. No HTTP or OpenAPI changes.

## Frontend changes

None.

## Backend changes

- Persist only the transaction-owned verified snapshot.
- Use PostgreSQL transaction time for expiry.
- Remove or fail closed on duplicate analysis-list representations.

## Security requirements

- Preserve workspace and product isolation at the transaction boundary.
- No unverified analysis ID may be inserted.
- No mutable caller-owned bytes may be reread after asynchronous work begins.
- Do not expose directive text, hashes, SQL, row payloads, or tenant data in errors or logs.

## Edge cases

- Mutation of key, request, and context hashes while a lock query is pending.
- Mutation or replacement of either analysis collection while persistence is pending.
- A valid verified descriptor paired with a same-workspace analysis belonging to a different product.
- Application clock ahead of or behind PostgreSQL.
- Expiry exactly equal to PostgreSQL transaction time.

## Acceptance criteria

1. Inserted context hash, idempotency hashes, and analysis links come only from the immutable transaction-owned snapshot that was verified.
2. A mismatched duplicate analysis collection fails before any insert, or the duplicate contract no longer exists.
3. Same-workspace/wrong-product analysis injection cannot be persisted.
4. Expiry uses authoritative PostgreSQL transaction time.
5. Deterministic tests prove mutation during asynchronous persistence cannot alter stored state.
6. Real PostgreSQL tests cover database-time expiry and same-workspace/wrong-product rejection.
7. `pnpm check`, `pnpm test:integration`, and `pnpm db:migrate:validate` twice pass when Docker/PostgreSQL is available.
8. `git diff --check 56d87c1..HEAD` passes and no unrelated files are committed.

## Test plan

- Add focused unit tests that pause the first asynchronous query, mutate caller-owned hashes/collections, resume, and assert inserts receive the original verified values.
- Add a crafted inconsistent-command test for descriptor analyses versus link analyses if the redundant field remains.
- Add PostgreSQL integration coverage for same-workspace/wrong-product rejection and database-time expiry.
- Run `pnpm check` serially.
- Run all PostgreSQL integration tests and migration validation twice when Docker is available.
- Scan the remediation diff for secrets and run `git diff --check 56d87c1..HEAD`.

## Out of scope

- Checkpoint B provider execution
- HTTP routes, UI, reporting, scheduling, publishing, or analytics
- New infrastructure or schema redesign

## Implementation handoff

Antigravity must implement this task on `agy/task-011-sprint3-checkpoint-a`, commit and push the result, and report the final SHA, changed files, deviations, and exact test evidence. Do not stage or modify unrelated untracked `plans/` files.
