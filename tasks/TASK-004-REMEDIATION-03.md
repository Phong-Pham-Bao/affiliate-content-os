# TASK-004 Remediation 03 - Transaction Failure Safety and Error Surface Closure

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-004`, `TASK-004-REMEDIATION-01`, `TASK-004-REMEDIATION-02`, and reviewed commit `7eb32bb07cae1e95a71e62278246784eda119079`

## Objective

Close the three findings from the Codex re-review of TASK-004 at commit `7eb32bb07cae1e95a71e62278246784eda119079`:

1. remove arbitrary public causes from `DatabaseError`;
2. restore a credential-safe transaction query boundary and prevent a caught failed query from producing a commit or successful transaction result; and
3. reject `undefined` for nullable membership timestamps while continuing to accept exactly `null`.

This remediation is limited to those defects and their regression tests. It must not add product behavior, change the database schema, or redesign the public application/domain contracts.

## Context

PR #4 remains based on `main` from branch `agy/task-004-workspace-tenancy-core`. At the start of this specification, local HEAD and `origin/agy/task-004-workspace-tenancy-core` both resolve to `7eb32bb07cae1e95a71e62278246784eda119079`, and the working tree is clean.

Remediation 02 correctly removed the public raw PostgreSQL `constraint` property and began validating timestamp strings in their original canonical form. However, the implementation removed query-level sanitization from `TransactionExecutor.query()` so the tenancy adapter could inspect a raw PostgreSQL constraint. This made raw driver errors observable to every transaction callback. If a callback catches that raw error and returns normally, the transaction executor attempts `COMMIT`; PostgreSQL may report the command as rolled back without throwing, while `withTransaction()` incorrectly resolves successfully.

The same review found that `DatabaseError` still accepts and publicly serializes arbitrary `cause` values, and that `joined_at: undefined` is incorrectly normalized to `null`.

All requirements in TASK-003, TASK-004, and the first two TASK-004 remediation specifications remain binding except where this remediation explicitly replaces the Remediation 02 raw-error classification design.

Relevant sources:

- `AGENTS.md`;
- `tasks/TASK-003.md` and `tasks/TASK-003-REMEDIATION-01.md`;
- `tasks/TASK-004.md`;
- `tasks/TASK-004-REMEDIATION-01.md`;
- `tasks/TASK-004-REMEDIATION-02.md`;
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, and `docs/DECISIONS.md` where relevant;
- the complete latest Codex findings; and
- the actual `origin/main...HEAD` implementation and tests.

## Required implementation

### 1. Remove arbitrary causes from `DatabaseError`

Make `DatabaseError` a closed, credential-safe public value.

Required behavior:

- Remove the arbitrary `cause` option from the `DatabaseError` constructor contract.
- A `DatabaseError` must not own, inherit, retain, serialize, inspect, or otherwise expose a raw cause supplied by database drivers or callers.
- `toJSON()`, custom inspection, `String(error)`, stack output, logger arguments, thrown output, and child-process stdout/stderr must contain only the approved safe name, message, and optional safe code.
- `sanitizeDatabaseError()` must always create or return a credential-safe error without attaching the inspected input as `cause` or metadata.
- Existing genuine, already-safe `DatabaseError` identity behavior may remain only if all its observable fields already satisfy this contract.
- Do not solve this with recursive sanitization of an arbitrary object. Omit arbitrary causes entirely.
- Preserve application/business errors thrown directly by transaction callbacks according to the existing callback-error contract; do not wrap them in `DatabaseError` merely to remove database causes.

Add tests that construct `DatabaseError` and invoke `sanitizeDatabaseError()` with raw objects containing hostile constraints, PostgreSQL URLs, credentials, SQL, bind values, getters, proxies, `toJSON`, `toString`, and custom inspection hooks. Tests must prove no hook execution and no sentinel through direct access, keys, JSON, string conversion, inspection, logging, stack, thrown output, or child-process output.

### 2. Restore the safe transaction query boundary

`TransactionExecutor.query()` is a public infrastructure boundary. A raw `pg` rejection must never reach its callback consumer.

Required behavior:

- Wrap every `client.query()` performed through `TransactionExecutor.query()` in an exception-safe boundary.
- On rejection, immediately create a fresh credential-safe `DatabaseError` using the existing database sanitizer and throw only that safe error to callback code.
- Never expose the original driver error, its `constraint`, query, bind parameters, URL, connection data, stack, or object identity.
- Do not call untrusted getters, proxy traps, coercion, serialization, inspection, or logging hooks while sanitizing.
- Preserve the existing immutable query result mapping for successful queries.

### 3. Make transaction query failure sticky

Every rejected transaction query permanently marks that transaction as failed, even when callback code catches the safe error.

Required behavior:

- Record the first safe query failure inside the transaction executor before rejecting the query promise.
- Once any transaction query has failed, `withTransaction()` must not issue `COMMIT` and must not resolve successfully.
- After the callback settles, roll back and reject with that first safe query failure.
- A later callback return, callback error, client error, rollback error, or release error must not replace the first safe query failure.
- Rollback is attempted at most once and the client is released exactly once.
- If no query failed, preserve the existing primary callback-error, client-error, commit-error, rollback, and release precedence required by TASK-003.
- The transaction executor remains inactive after the callback settles, and escaped executor references remain unusable.
- Do not infer success from PostgreSQL's `COMMIT` command result after an aborted transaction. A failed query is sufficient to prohibit the commit attempt.

Tests must cover at least:

- a query rejection that is not caught by the callback;
- a callback that catches the safe query error and returns normally;
- a callback that catches the safe query error and throws another error;
- rollback failure after a query failure;
- release failure after a query failure;
- a client error after a query failure;
- multiple query failures, proving the first safe failure remains primary;
- command order and absence of `COMMIT` after any query rejection; and
- exactly-once release and bounded cleanup.

At least one real-PostgreSQL integration test must execute a statement error inside a transaction, catch the error inside the callback, return normally, and prove that `withTransaction()` still rejects with a safe `DatabaseError`, performs no effective commit, and persists no transaction writes.

### 4. Classify workspace slug conflict without raw-error exposure

Remove the need for the tenancy adapter to inspect raw PostgreSQL errors.

Use the existing unique `workspaces.slug` contract as the explicit conflict target:

- Change the workspace insert to use parameterized PostgreSQL conflict handling equivalent to `ON CONFLICT (slug) DO NOTHING RETURNING id`.
- If and only if that workspace insert returns zero rows, throw the existing typed `SlugConflictError` for the normalized slug.
- If it returns exactly one row, continue with membership insertion in the same transaction.
- Any other query/connection/driver failure arrives at the adapter only as a credential-safe `DatabaseError` and must remain generic.
- Remove the adapter's raw `code`/`constraint` inspection predicate and related imports.
- Do not store raw constraint data in a public property, private property, symbol, `WeakMap`, closure, module cache, or any other delayed-classification mechanism.
- Do not use `ON CONFLICT DO NOTHING` without the explicit `(slug)` conflict target.
- Do not pre-check slug availability; concurrency correctness must come from the unique constraint and single insert statement.

Tests must prove:

- exact same-slug and normalized concurrent collisions yield at most one workspace and one typed `SlugConflictError`;
- primary-key, membership, identity, foreign-key, check, connection, and unknown database failures never map to `SlugConflictError`;
- the slug conflict path creates no orphan workspace or membership and preserves transaction cleanup; and
- no raw driver object or constraint is needed or observable at the adapter boundary.

### 5. Reject `undefined` membership timestamps

For `mapMembershipRow()`:

- accept exactly `null` for `joined_at` and map it to `joinedAt: null`;
- accept canonical string and valid `Date` values according to Remediation 02;
- reject `undefined` and every other non-string/non-`Date` non-null value with the existing credential-safe `DatabaseError`; and
- do not include the rejected value or row in any error surface.

Update the row type and tests only as needed to exercise hostile runtime inputs without weakening the production contract.

## Expected files

Expected focused changes include:

- `tasks/TASK-004-REMEDIATION-03.md`;
- `packages/infrastructure/src/database/errors.ts`;
- `packages/infrastructure/src/database/database.ts`;
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`;
- `packages/infrastructure/src/tenancy/mappers.ts`;
- focused database, adversarial rejection, tenancy adapter, and mapper unit tests;
- focused real-PostgreSQL transaction and tenancy integration tests; and
- package exports/types only if directly required to keep the existing public contract type-safe.

Do not modify migration SQL, domain/application behavior, API/worker/web runtime composition, CI policy, dependency pins, or unrelated files.

## Database changes

None.

- Do not add, remove, or edit migrations.
- Continue relying on the existing unique `workspaces.slug` constraint.
- SQL text in the tenancy adapter may change only to add the explicit slug conflict target and required `RETURNING` clause.

## API changes

None.

- Do not add or change routes, payloads, status codes, OpenAPI, authentication, authorization, cookies, sessions, CORS, or CSRF behavior.

## Frontend changes

None.

- Do not modify the web application or expose infrastructure errors to it.

## Backend changes

Only the infrastructure database error surface, transaction state machine, tenancy slug insert behavior, membership timestamp mapper, and their focused tests may change.

Preserve all existing API and worker lifecycle behavior. Do not wire tenancy into a runtime process in this remediation.

## Security requirements

- Raw database errors are untrusted and potentially secret-bearing.
- No raw cause, constraint, SQL, bind value, credential, database URL, host, database name, driver field, or raw stack may cross the database boundary.
- Sanitization and classification must not execute untrusted getters, proxy traps, coercion, serialization, inspection, logging, or prototype hooks.
- A safe error must never attach the original error directly or indirectly.
- Adapter conflict classification must use only the safe result of the explicit SQL conflict target; it must not inspect a raw error.
- A transaction cannot be reported as successful after any query rejects.
- Cleanup errors must not replace the first safe transaction query failure or leak their raw values.
- Rejected timestamp values and database rows must not appear in errors or logs.
- No test-only bypass, debug export, secret fixture resembling production credentials, or weakened security gate is allowed.

## Edge cases

- A caller passes a raw driver-like object as a requested `DatabaseError` cause.
- A raw error contains accessor-backed or proxy-backed `code`, `constraint`, `message`, `query`, or parameters.
- A transaction callback catches a failed query and returns a successful-looking value.
- A callback catches a failed query and attempts another query.
- Multiple transaction queries fail with different raw secrets.
- Callback, client, rollback, and release failures occur after the first query failure.
- PostgreSQL accepts `COMMIT` after an aborted transaction by returning a rollback command rather than throwing.
- Two concurrent inserts use the same normalized slug.
- A non-slug constraint fails during workspace or membership creation.
- `joined_at` is exactly `null`, `undefined`, canonical string, valid `Date`, invalid `Date`, or another primitive/object.

## Acceptance criteria

1. `DatabaseError` exposes only an approved safe name, message, and optional code; arbitrary causes cannot be supplied or observed.
2. The cause-focused sentinel reproduction emits no constraint, SQL, bind, credential, driver, or hook sentinel through any required surface.
3. `TransactionExecutor.query()` returns only a credential-safe `DatabaseError` for driver failures and never the original object.
4. Any rejected transaction query becomes a sticky primary failure: no `COMMIT`, no successful `withTransaction()` result, one rollback attempt, and exactly one release.
5. A callback that catches a query error cannot hide it by returning normally or throwing a replacement error.
6. Exact workspace slug collision still maps to `SlugConflictError` using explicit `ON CONFLICT (slug) DO NOTHING RETURNING id`, including under concurrency.
7. No other database failure maps to `SlugConflictError`, and no raw constraint-classification mechanism remains.
8. Real PostgreSQL proves that a caught statement failure cannot report transaction success or persist writes.
9. `joined_at: null` maps to `null`; `joined_at: undefined` and every other invalid non-null value fail with a credential-safe `DatabaseError`.
10. All prior TASK-003/TASK-004 unit, integration, migration, tenant-isolation, security, boundary, typecheck, build, audit, Trivy, runtime, and clean-checkout gates remain passing.
11. No schema, API, frontend, authentication, authorization, audit, product, AI, scheduling, publishing, analytics, social, or unrelated functionality is introduced.
12. Final local HEAD, remote branch head, and PR #4 head match; the worktree is clean.

## Test plan

### Focused unit and adversarial tests

- Closed `DatabaseError` observable-surface matrix with hostile cause-like inputs.
- Transaction query raw-error sentinel reproduction from the Codex finding.
- Sticky transaction failure precedence and command-order matrix.
- Exactly-once rollback/release behavior.
- Adapter slug conflict result-path tests without raw error inspection.
- Mapper matrix proving exact-null handling for `joined_at`.
- Child-process stdout/stderr sentinel checks for hostile error hooks and metadata.

### Real PostgreSQL tests

- Run migrations from an empty isolated database and verify the second run is a no-op.
- Reproduce a statement failure caught inside a callback and prove `withTransaction()` rejects safely and commits no writes.
- Run concurrent normalized-slug creation and verify one success, one typed conflict, and no orphan rows.
- Run the full tenancy schema and tenant-isolation integration suites.

### Required verification

Run and report every command required by TASK-004 and all remediation specifications, including:

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

Also run exact-image pin inspection, both required Trivy scans, the no-ignore negative control, runtime smoke tests, exact-SHA GitHub checks, and a clean-checkout verification. Report actual outcomes; do not claim a skipped or unavailable check passed.

## Out of scope

- Any requirement not needed to close these three findings.
- Schema or migration changes.
- Public raw-error metadata, generic constraint registries, ORM/query builders, repository frameworks, or broad refactors.
- Domain/application redesign, timestamp representation changes, timezone behavior, or `aiEnabled` changes.
- OIDC, sessions, HTTP tenancy APIs, frontend, invitations, membership mutation, audit, products, AI, scheduling, publishing, analytics, social functionality, queues, or caches.
- Dependency upgrades or security-policy relaxation.

## Implementation handoff requirements

This remediation is approved by the Product Owner. Antigravity may implement it on the existing TASK-004 branch.

After approval and before coding, Antigravity must read `AGENTS.md`, TASK-003, TASK-004, all three TASK-004 remediation files, the relevant approved documentation, the complete Codex findings, and the actual `origin/main...HEAD` diff.

Before declaring implementation ready for review, Antigravity must report:

- how `DatabaseError` was closed to arbitrary causes;
- how transaction query failures are sanitized and recorded before callback observation;
- the sticky-failure precedence and exact command sequence;
- the explicit SQL slug-conflict result design and concurrency proof;
- the `joined_at` exact-null test matrix;
- focused sentinel and child-process results;
- every required verification command and exact-SHA GitHub result;
- changed files, final local/remote/PR SHA, and clean worktree status; and
- every skipped check, failure, deviation, or limitation.

Codex will re-review the approved specifications, actual base-to-head diff, surrounding code, adversarial reproductions, transaction semantics, real-PostgreSQL behavior, and all required gates before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
