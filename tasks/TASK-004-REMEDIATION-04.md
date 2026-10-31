# TASK-004 Remediation 04 - In-Flight Transaction Queries and Tainted Database Errors

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-004`, all three approved TASK-004 remediation specifications, and reviewed commit `cd216aa2b1a40fc130b17d31bdcf4d8bd866fec9`

## Objective

Close the two remaining HIGH findings from the Codex review of TASK-004 at commit `cd216aa2b1a40fc130b17d31bdcf4d8bd866fec9`:

1. prevent an unawaited transaction query from completing after `COMMIT`, release, or successful `withTransaction()` resolution; and
2. ensure a genuine but subsequently tainted `DatabaseError` thrown by callback code is re-sanitized and cannot expose an arbitrary cause or unexpected metadata.

This remediation is intentionally limited to transaction query lifecycle tracking, callback rejection routing, and focused regression tests.

## Context

PR #4 remains open from `agy/task-004-workspace-tenancy-core` into `main`. At specification time, local HEAD and the remote branch both resolve to `cd216aa2b1a40fc130b17d31bdcf4d8bd866fec9`, and the working tree is clean.

Remediation 03 correctly restored query-level database-error sanitization, made observed query failures sticky, removed raw constraint inspection, used an explicit slug-conflict result path, and fixed strict nullable timestamp handling. The new adversarial review found two lifecycle gaps:

- the callback can start `tx.query()` without awaiting it, return, and allow `withTransaction()` to inspect failure state before the query settles; and
- callback sanitization treats a genuine `DatabaseError` as a generic callback value, allowing a branded error mutated after construction with a raw `cause` to survive by identity.

All prior TASK-003, TASK-004, and TASK-004 remediation requirements remain binding. This specification only clarifies the missing asynchronous ownership rule and the sanitizer routing rule.

Relevant sources:

- `AGENTS.md`;
- `tasks/TASK-003.md` and `tasks/TASK-003-REMEDIATION-01.md`;
- `tasks/TASK-004.md`;
- `tasks/TASK-004-REMEDIATION-01.md` through `TASK-004-REMEDIATION-03.md`;
- relevant `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, and `docs/DECISIONS.md` sections;
- the complete latest Codex findings; and
- the actual `origin/main...HEAD` implementation and surrounding tests.

## Required implementation

### 1. Register every transaction query before driver execution

Every query accepted while the transaction executor is active becomes work owned by that transaction, regardless of whether callback code awaits the returned promise.

Required behavior:

- After confirming the executor is active, register the query as in flight before or atomically with starting `client.query()`.
- Maintain an internal completion record for every accepted query. The record must settle for both query success and query failure and must not expose raw driver values.
- The caller-facing promise retains the existing result and safe-error behavior.
- Internal observation must prevent an unawaited rejected query from becoming an unhandled rejection, without converting the caller-facing rejection into success.
- Query rejection must be sanitized and recorded as the first safe query failure before the internal completion record settles.
- Successful query results retain the existing immutable row/result mapping.
- Do not permit a query to register after the executor has been deactivated.
- Do not add timers, background workers, global registries, detached promises, or cross-transaction state.

The implementation may use a transaction-local set of non-rejecting completion promises or an equivalent bounded mechanism. It must not retain completed query results, parameters, raw errors, or clients beyond transaction cleanup.

### 2. Quiesce the executor before commit or rollback decisions

The transaction callback settling does not mean all transaction work is complete.

Required sequence:

1. run `BEGIN`;
2. invoke the callback;
3. when the callback settles, immediately deactivate the executor so no new query can start;
4. await settlement of every query registered before deactivation;
5. only then evaluate query failure, callback failure, client failure, and commit eligibility;
6. perform at most one `COMMIT` or one rollback attempt as required; and
7. release exactly once after all registered query work and transaction cleanup settle.

Required outcomes:

- If any registered query rejects, never issue `COMMIT`, never resolve successfully, attempt rollback once, and reject with the first safe query failure.
- Query failure remains primary even if the callback returned normally, threw another value, or settled before the query rejected.
- If all registered queries succeed and the callback succeeds, do not issue `COMMIT` until every query has completed.
- If all registered queries succeed and the callback fails, wait for them, then preserve the existing safe callback failure and rollback behavior.
- Client, rollback, and release errors must follow the existing precedence rules and must not replace a first safe query failure.
- Release must never happen while a registered query is pending.
- Escaped executor references remain unusable immediately after callback settlement, including while the transaction is waiting for previously registered queries.
- Multiple concurrent query failures use the first safely recorded rejection as the primary failure. Tests must control settlement order rather than rely on wall-clock timing.

Do not treat a callback's failure to await its query as permission to detach that query. `withTransaction()` owns every query it accepted.

### 3. Route genuine `DatabaseError` callback rejections through the database sanitizer

Callback rejection handling must distinguish branded database errors from application/business failures.

Required behavior:

- When callback code rejects with a genuine/branded `DatabaseError`, route it through `sanitizeDatabaseError()` rather than the generic recursive callback sanitizer.
- Preserve identity only when the complete observable error surface already satisfies the closed `DatabaseError` invariant.
- If the branded error has an own or inherited `cause`, unexpected own key, accessor, hostile prototype state, modified unsafe field, or any other ambiguous surface, return a fresh cause-free safe `DatabaseError`.
- The fresh error must retain only approved safe classification needed by the existing contract; it must not copy arbitrary properties.
- Continue using the existing callback sanitizer for non-database application/business rejection values so their approved identity and semantics are preserved where safe.
- Detection and validation must not execute getters, proxy traps, coercion, `toJSON`, `toString`, custom inspection, logging, or prototype hooks.
- A proxy or ambiguous value must fail closed without exposing the target.
- Do not modify or delete properties from the caller-owned error in place.

Add focused tests for a genuine `DatabaseError` that is mutated after construction through assignment or `Object.defineProperty`, including raw cause, constraint, SQL, bind, credential, stack, accessor, symbol, and unexpected-key cases.

### 4. Preserve all completed Remediation 03 behavior

The implementation must retain:

- safe query errors for awaited transaction queries;
- sticky first-query-failure precedence;
- no commit after any query rejection;
- exactly-once cleanup;
- explicit `ON CONFLICT (slug) DO NOTHING RETURNING id` slug handling;
- no raw constraint classification or storage;
- strict `joined_at` null handling; and
- all existing hostile-error and credential-leak protections.

Do not reopen or redesign these completed areas unless a focused change is strictly necessary for the two findings above.

## Expected files

Expected focused changes include:

- `tasks/TASK-004-REMEDIATION-04.md`;
- `packages/infrastructure/src/database/database.ts`;
- `packages/infrastructure/src/database/errors.ts` or `sanitization.ts` only if required to validate branded errors safely;
- `packages/infrastructure/test/unit/database.unit.test.ts`;
- focused adversarial/child-process error tests if placed separately; and
- `packages/infrastructure/test/integration/database.integration.test.ts`.

Do not modify tenancy SQL, migration files, domain/application contracts, API/web/worker composition, CI policy, dependency pins, or unrelated planning artifacts.

## Database changes

None.

- Do not add or edit migrations, tables, constraints, indexes, extensions, or seed data.
- The real-PostgreSQL tests may create temporary test rows only through the existing isolated test lifecycle.

## API changes

None.

- Do not add or change routes, payloads, status codes, OpenAPI, authentication, authorization, cookies, sessions, CORS, or CSRF behavior.

## Frontend changes

None.

- Do not modify the web application.

## Backend changes

Only transaction-local in-flight query tracking, callback rejection routing, and their focused tests may change.

Preserve all runtime process startup, liveness, shutdown, database configuration, tenancy adapter, and migration behavior.

## Security requirements

- Raw driver failures and caller-mutated errors are untrusted and potentially secret-bearing.
- No raw cause, constraint, SQL, parameter, bind value, credential, URL, host, database name, stack, symbol value, or unexpected metadata may escape.
- Never execute hostile accessors, proxy traps, coercion, serialization, inspection, logging, or prototype hooks during detection or sanitization.
- A returned safe error must never reference the original unsafe value directly or indirectly.
- In-flight tracking must not retain SQL parameters or raw errors after cleanup.
- An unawaited query must not outlive transaction release or be allowed to race a commit decision.
- No test-only bypass, production debug export, global unhandled-rejection suppression, or weakened security gate is allowed.

## Edge cases

- Callback starts one delayed successful query and returns immediately.
- Callback starts one delayed failing query, attaches its own catch, and returns immediately.
- Callback starts a query without attaching a catch and returns immediately.
- Several concurrent queries settle in a controlled order with success and failure mixtures.
- Callback throws before an in-flight query succeeds or fails.
- Executor is reused while `withTransaction()` is waiting for registered queries after callback settlement.
- Client error occurs while registered queries are settling.
- Rollback or release fails after a late query failure.
- Genuine `DatabaseError` is mutated with an enumerable cause, non-enumerable cause, accessor-backed cause, symbol metadata, hostile stack, or unexpected own key.
- Safe genuine `DatabaseError` remains closed and may preserve identity.
- Safe non-database business rejection retains the existing approved callback semantics.

## Acceptance criteria

1. Every query accepted by `TransactionExecutor` is registered and awaited by `withTransaction()` before commit, rollback decision, release, or return.
2. An unawaited delayed rejection produces no `COMMIT`, no successful result, one rollback attempt, exactly one release, and the first safe `DatabaseError`.
3. An unawaited successful query completes before `COMMIT`; release occurs only after commit completes.
4. Callback settlement immediately deactivates the executor, so no new query can start while earlier registered queries drain.
5. Query failure remains primary across callback, client, rollback, and release failures, including when the query settles after the callback.
6. No unhandled rejection, raw driver value, query parameter, or secret is emitted by the internal tracking mechanism.
7. A tainted genuine `DatabaseError` thrown by callback code emerges as a fresh, cause-free, credential-safe `DatabaseError`.
8. A completely safe genuine `DatabaseError` may preserve identity only after exception-safe validation of its complete observable surface.
9. Non-database application/business callback errors preserve the existing approved behavior.
10. Mock and real-PostgreSQL tests prove delayed success and delayed failure ordering, no early release, and no persisted write after failure.
11. All prior TASK-003/TASK-004 unit, integration, migration, tenancy, security, boundary, typecheck, build, audit, Trivy, runtime, and clean-checkout gates remain passing.
12. No schema, API, frontend, authentication, authorization, audit, product, AI, scheduling, publishing, analytics, social, or unrelated functionality is introduced.
13. Final local HEAD, remote branch head, and PR #4 head match, and the worktree is clean.

## Test plan

### Focused unit and adversarial tests

- Deferred-promise mock proving unawaited success completes before commit.
- Deferred-promise mock proving unawaited failure prohibits commit and becomes primary.
- Fire-and-forget rejection with and without a caller catch, monitored for unhandled rejection.
- Multiple registered query settlement-order matrix.
- Callback failure plus pending query success/failure precedence.
- Client, rollback, and release failure combinations after a late query failure.
- Executor deactivation while registered queries drain.
- Tainted branded `DatabaseError` observable-surface matrix.
- Hostile getter/proxy/custom-hook and child-process sentinel checks.
- Existing awaited-query, slug conflict, timestamp, and transaction cleanup regression suites.

### Real PostgreSQL tests

- Start a write or harmless delayed success without awaiting it; prove `COMMIT` and resolution occur only after it completes.
- Start a statement that fails after callback return; prove `withTransaction()` rejects safely, commits nothing, and leaves no test data.
- Run the full database and tenancy integration suites through the existing isolated database harness.

### Required verification

Run and report all verification required by TASK-004 and all prior remediation specifications, including:

```text
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
docker compose config --quiet
corepack pnpm verify:infrastructure-pins
corepack pnpm infra:up
corepack pnpm db:migrate:validate
corepack pnpm test:integration
corepack pnpm format:check
corepack pnpm lint:boundaries
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
corepack pnpm audit --prod --audit-level high
corepack pnpm verify:trivy-exception
corepack pnpm infra:down
git diff --check
git status --short --branch
```

Also run exact-image pin inspection, both required Trivy scans, the no-ignore negative control, runtime smoke tests, exact-SHA GitHub checks, and clean-checkout verification. Report unavailable or skipped checks honestly.

## Out of scope

- Any requirement not needed to close these two findings.
- Schema, migration, slug-conflict, mapper, domain, application, API, or frontend changes.
- OIDC, sessions, invitations, role mutation, audit, products, AI, scheduling, publishing, analytics, social functionality, queues, caches, or background processing.
- ORM/query builder adoption, generic repository frameworks, dependency upgrades, broad refactors, or security-policy relaxation.
- Adding automatic cancellation of PostgreSQL queries; ownership and settlement are required, cancellation is not part of this remediation.

## Implementation handoff requirements

This remediation is approved by the Product Owner. Antigravity may implement it on the existing TASK-004 branch.

After approval and before coding, Antigravity must read `AGENTS.md`, TASK-003, TASK-004, all four TASK-004 remediation files, relevant documentation, the complete Codex findings, and the actual `origin/main...HEAD` diff.

Before declaring implementation ready for review, Antigravity must report:

- the transaction-local in-flight registration and quiescence design;
- proof that unawaited successful and failing queries settle before commit/release decisions;
- first-query-failure precedence and exact command sequences;
- branded `DatabaseError` routing and tainted-surface validation;
- focused sentinel, unhandled-rejection, and child-process results;
- real-PostgreSQL delayed success/failure results;
- every required verification and exact-SHA CI result;
- changed files, final local/remote/PR SHA, and clean worktree status; and
- every skipped check, failure, deviation, or limitation.

Codex will re-review the approved specifications, actual base-to-head diff, surrounding code, adversarial reproductions, asynchronous transaction ordering, branded-error handling, real-PostgreSQL behavior, and required gates before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
