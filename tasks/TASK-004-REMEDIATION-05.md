# TASK-004 Remediation 05 - Complete Query Boundary and Trusted DatabaseError Invariants

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-004`, all four approved TASK-004 remediation specifications, and reviewed commit `fcab00b3e35d2405db732b7dd1a58ee6f004c187`

## Objective

Close the two remaining HIGH findings from the Codex review of TASK-004 at commit `fcab00b3e35d2405db732b7dd1a58ee6f004c187`:

1. make the transaction query boundary cover driver invocation, asynchronous rejection, and complete query-result mapping; and
2. make `DatabaseError` safety depend on trusted construction invariants rather than mutable observable fields or merely shape-compatible prototype methods.

This remediation is limited to those two defects and their focused regression tests.

## Context

PR #4 remains open from `agy/task-004-workspace-tenancy-core` into `main`. At review time, local HEAD, remote branch head, and PR head were all `fcab00b3e35d2405db732b7dd1a58ee6f004c187`; the worktree was clean and all exact-SHA GitHub checks succeeded.

Remediation 04 correctly registered and drained accepted transaction queries before commit/release and routed branded database callback failures through `sanitizeDatabaseError()`. The adversarial review found two remaining gaps:

- the success callback of `driverPromise.then()` maps `res.rows`, `res.rowCount`, and `res.command` outside the rejection handler attached to that same `then()`. An exception during mapping therefore rejects the caller promise with the raw value, does not record `firstQueryFailure`, and permits `COMMIT`; and
- branded-error validation trusts current mutable stack content when it lacks a sensitive URL and trusts prototype methods when their property names and descriptor shapes remain allowed. Replaced serialization/inspection methods and non-URL stack payloads can therefore survive sanitization.

All prior TASK-003, TASK-004, and TASK-004 remediation requirements remain binding.

Relevant sources:

- `AGENTS.md`;
- `tasks/TASK-003.md` and `tasks/TASK-003-REMEDIATION-01.md`;
- `tasks/TASK-004.md` and `tasks/TASK-004-REMEDIATION-01.md` through `TASK-004-REMEDIATION-04.md`;
- relevant architecture, database, security, API, and decision documentation;
- the complete latest Codex findings and exact reproductions; and
- the actual `origin/main...HEAD` implementation and tests.

## Required implementation

### 1. Put the complete query lifecycle inside one safe failure boundary

Every failure after `TransactionExecutor.query()` accepts a query must become a sanitized sticky query failure.

The safe boundary must include:

- copying supplied parameters;
- synchronous `client.query()` invocation;
- awaiting the driver promise;
- reading `rows`, `rowCount`, and `command`;
- iterating/copying the rows collection; and
- constructing and freezing the public `DatabaseQueryResult`.

Required behavior:

- Use one transaction-local query operation whose `try/catch` covers the entire lifecycle above.
- Any thrown or rejected value from any stage must pass through `sanitizeDatabaseError()` before callback code observes it.
- Record the first resulting safe `DatabaseError` as `firstQueryFailure` before the caller-facing promise rejects or the internal completion record settles.
- Never return or attach the raw thrown value.
- Retain the Remediation 04 in-flight registration and non-rejecting completion observer so unawaited failures cannot become unhandled rejections.
- Preserve immutable copied rows and the existing successful result contract.
- Do not read a query-result field a second time after a first access fails.
- Do not log, stringify, inspect, coerce, or enumerate the thrown value to classify it.
- A mapping failure is a transaction query failure: prohibit `COMMIT`, attempt rollback once, release exactly once, and reject with the first safe failure.

The implementation must not rely on the second callback of the same `.then(success, failure)` to catch exceptions thrown by `success`; JavaScript does not route those exceptions to that sibling rejection callback.

### 2. Add adversarial query-result mapping coverage

Add focused tests using controlled driver doubles for at least:

- a `rows` getter that throws a raw error containing constraint, SQL, bind, URL, credential, and stack sentinels;
- a rows iterator that throws a raw error;
- accessor-backed `rowCount` and `command` values that throw;
- a proxy-backed query result or rows value whose trap throws;
- caller-awaited and caller-unawaited variants;
- caller-attached `.catch()` and no-catch variants; and
- a prior successful write followed by a mapping failure.

For every case, prove:

- callback code receives only a safe `DatabaseError`;
- raw identity and sentinels are unreachable through all required output surfaces;
- `firstQueryFailure` becomes sticky;
- `COMMIT` is absent;
- rollback is attempted at most once;
- release occurs exactly once and only after registered work settles; and
- no unhandled rejection is emitted.

The production implementation may necessarily access normal driver result fields to map a successful result. The security requirement is that any failure caused by that access is caught and sanitized without leaking or reporting transaction success.

### 3. Establish trusted construction state for genuine `DatabaseError`

Do not decide that a branded `DatabaseError` is safe solely by reading its current mutable fields or checking that prototype properties have familiar names.

Required behavior:

- Record only credential-safe construction-time state in a module-private mechanism not observable through the error object.
- Construction state may contain only the approved safe message, approved safe code, and other minimum data required to create a fresh safe error. It must never retain a raw cause, constraint, SQL, bind value, row, driver object, or caller object.
- A branded error presented to `sanitizeDatabaseError()` must be validated against trusted construction state without executing its current accessors or hooks.
- If current observable state, own keys, property descriptors, prototype chain, serialization methods, inspection methods, string conversion behavior, or stack cannot be proven unchanged and safe, return a fresh safe `DatabaseError` built only from trusted safe state or a generic safe fallback.
- Never rebuild a safe error from a tainted current stack, current unexpected property, or current hook result.
- Do not mutate the caller-owned error in place.
- A safe branded error may preserve identity only if its complete observable surface and behavior are proven to match the trusted invariant. Identity preservation is optional; safety is mandatory.
- If trusted state is absent or ambiguous, fail closed to a fresh generic `DatabaseError`.

A module-private `WeakMap` keyed by genuine errors is permitted only for credential-safe construction snapshots. It must not be used to retain raw errors, constraints, causes, driver metadata, or delayed classification data.

### 4. Close mutable prototype and stack behavior

Required behavior:

- Replacing `DatabaseError.prototype.toJSON`, custom inspection, `toString`, constructor-related behavior, or any other observable method must not pass validation merely because the key and descriptor shape are allowed.
- Compare allowed behavior against trusted original function identities/descriptors, or otherwise make those behaviors immutable and demonstrably safe.
- A stack changed after construction must not be trusted because it lacks a URL. Non-URL SQL, bind, password, token, constraint, newline, and stack-frame sentinels must also be rejected.
- Hostile getter/setter descriptors for `name`, `message`, `code`, `stack`, `cause`, serialization, inspection, or string conversion must never execute.
- Own symbol properties, unexpected own keys, prototype changes, and ambiguous proxy/prototype states must fail closed.
- Safe output must expose none of the unsafe value through direct access, own/inherited keys, JSON, `String`, inspection, logging, stack, thrown output, or child-process stdout/stderr.

Do not implement a growing blacklist of sentinel text. Establish a closed invariant that rejects untrusted mutation generically.

### 5. Preserve completed transaction and tenancy behavior

Retain all completed guarantees from Remediations 01–04:

- every accepted query is registered and drained;
- executor deactivation occurs when callback settlement begins transaction finalization;
- query failure remains primary;
- no early commit or release;
- exact cleanup behavior;
- safe handling of non-database business callback failures;
- explicit slug-conflict result handling without raw constraint inspection;
- strict timestamp and tenancy isolation behavior; and
- all migration, runtime, boundary, and security requirements.

## Expected files

Expected focused changes include:

- `tasks/TASK-004-REMEDIATION-05.md`;
- `packages/infrastructure/src/database/database.ts`;
- `packages/infrastructure/src/database/errors.ts`;
- database sanitization code only if strictly required by the closed invariant;
- `packages/infrastructure/test/unit/database.unit.test.ts`;
- `packages/infrastructure/test/unit/errors.unit.test.ts`;
- focused child-process/adversarial tests if kept separately; and
- real-PostgreSQL integration tests only if required to preserve the complete transaction proof.

Do not modify migrations, tenancy SQL, domain/application contracts, API/web/worker composition, dependency pins, CI policy, or unrelated planning artifacts.

## Database changes

None.

- Do not add or edit migrations, schema, constraints, indexes, extensions, or seed data.

## API changes

None.

- Do not add or change routes, payloads, OpenAPI, authentication, authorization, sessions, cookies, CORS, CSRF, or status codes.

## Frontend changes

None.

- Do not modify the web application.

## Backend changes

Only the infrastructure query-result failure boundary, trusted `DatabaseError` invariant, and focused tests may change.

Preserve API and worker lifecycle behavior, database configuration, migration behavior, and tenancy adapter behavior.

## Security requirements

- Treat driver results, driver failures, and mutated error surfaces as untrusted at the infrastructure boundary.
- Never expose or retain raw causes, constraints, SQL, parameters, bind values, credentials, URLs, host/database names, rows, driver objects, hooks, symbols, or raw stacks.
- Never execute hostile error getters, proxy traps, serialization, inspection, coercion, logging, or prototype hooks during sanitization.
- A trusted construction snapshot must contain only already-safe primitive data and must not be externally reachable.
- Query-result mapping failure must not bypass sticky transaction failure.
- No global unhandled-rejection suppression, test-only bypass, debug export, or relaxed security policy is allowed.

## Edge cases

- `client.query()` throws synchronously.
- Driver promise rejects asynchronously.
- Driver promise fulfills, then `rows` access or iteration throws.
- `rowCount` or `command` access throws after rows were copied.
- Mapping succeeds for one query while another mapping fails later.
- Callback catches the safe mapping error and returns normally.
- Mapping error is unawaited and caller attaches no catch.
- Genuine `DatabaseError` has a replaced stack with no URL but with SQL/bind/token sentinels.
- `DatabaseError.prototype.toJSON`, custom inspection, or `toString` is replaced with a data-descriptor function.
- Error prototype or own property is changed after construction.
- Safe genuine database and non-database business errors retain approved semantics.

## Acceptance criteria

1. The complete transaction query lifecycle, including result mapping, is covered by one safe failure boundary.
2. Every mapping exception becomes a credential-safe sticky `DatabaseError`; raw identity and metadata never reach callback code.
3. Mapping failure causes no `COMMIT` or successful transaction resolution and preserves bounded rollback/release behavior.
4. Awaited, unawaited, caught, and uncaught mapping-failure variants emit no unhandled rejection or sentinel output.
5. Genuine `DatabaseError` safety is derived from module-private trusted construction state, not untrusted current fields alone.
6. Replaced prototype methods and modified non-URL stack content cannot survive sanitization or execute afterward.
7. Hostile accessors, proxies, symbols, own keys, prototype changes, serialization, inspection, and string hooks fail closed without execution.
8. Fresh safe errors contain no reference to the unsafe original and expose only approved safe fields/behavior.
9. All Remediation 04 in-flight ordering, delayed success/failure, and first-failure tests remain passing.
10. All prior TASK-003/TASK-004 unit, integration, migration, tenancy, security, typecheck, lint, build, audit, Trivy, runtime, and clean-checkout gates remain passing.
11. No schema, API, frontend, authentication, authorization, product, AI, scheduling, publishing, analytics, social, or unrelated functionality is introduced.
12. Final local HEAD, remote branch head, and PR #4 head match, and the worktree is clean.

## Test plan

### Focused unit and adversarial tests

- Complete query lifecycle failure matrix: invocation, rejection, field access, iteration, mapping, and freezing.
- Awaited/unawaited and caught/uncaught result-mapping failure matrix.
- Command order, sticky failure, rollback/release, and unhandled-rejection assertions.
- Trusted construction snapshot and branded-error mutation matrix.
- Prototype method replacement tests for JSON, inspection, and string conversion.
- Non-URL hostile stack mutation tests.
- Accessor, proxy, symbol, unexpected-key, and prototype-change tests.
- Child-process stdout/stderr sentinel verification.
- All prior transaction and database error regression suites.

### Real PostgreSQL and regression tests

- Run the full existing migration, database, schema, tenancy, delayed-query, and isolation integration suites.
- Preserve the real-PostgreSQL proof that late failures commit no writes.
- Driver-result adversarial mapping may remain a controlled unit test because normal `pg` results do not provide hostile getters by themselves.

### Required verification

Run and report all commands required by TASK-004 and prior remediation specifications, including:

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
- Schema, migration, tenancy, timestamp, domain, application, API, or frontend changes.
- OIDC, sessions, invitations, role mutation, audit, products, AI, scheduling, publishing, analytics, social functionality, queues, or caches.
- ORM/query-builder adoption, generic repository frameworks, dependency upgrades, broad refactors, or security-policy relaxation.
- Preventing arbitrary global JavaScript runtime compromise outside the exported database boundary; this task protects the module's own instances and observable methods against the specified mutations.

## Implementation handoff requirements

This remediation is approved by the Product Owner. Antigravity may implement it on the existing TASK-004 branch.

After approval and before coding, Antigravity must read `AGENTS.md`, TASK-003, TASK-004, all five TASK-004 remediation files, relevant documentation, the complete Codex findings, and the actual `origin/main...HEAD` diff.

Before declaring implementation ready for review, Antigravity must report:

- the complete query-lifecycle safe-boundary design;
- mapping-failure command order and raw-sentinel proof;
- trusted `DatabaseError` construction-state design;
- prototype/stack mutation test results;
- unhandled-rejection and child-process results;
- every required local verification and exact-SHA CI result;
- changed files, final local/remote/PR SHA, and clean worktree status; and
- every skipped check, failure, deviation, or limitation.

Codex will re-review the approved specifications, actual diff, surrounding code, exact adversarial reproductions, trusted-state design, transaction semantics, and required gates before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
