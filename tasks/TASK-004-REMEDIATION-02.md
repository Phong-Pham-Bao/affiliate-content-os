# TASK-004 Remediation 02 - Private Constraint Classification and Canonical Timestamp Input

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-004`, approved `TASK-004-REMEDIATION-01`, and implementation commit `0e40cc9b65bd57ffe2c9aa8d0c18957d307b8893`

## Objective

Close the two remaining findings from the Codex re-review of TASK-004:

1. prevent arbitrary PostgreSQL constraint payloads from becoming public `DatabaseError` data; and
2. reject parseable but noncanonical timestamp strings instead of silently canonicalizing them.

This remediation is intentionally limited to these two defects and their regression tests. Do not change schema, migrations, APIs, frontend, product behavior, or architecture.

## Context

PR #4 remains based on `main` from branch `agy/task-004-workspace-tenancy-core`. The reviewed local HEAD, remote branch, and PR head were all `0e40cc9b65bd57ffe2c9aa8d0c18957d307b8893`; the worktree was clean and all exact-SHA GitHub checks succeeded.

Codex independently verified that Remediation 01 fixed strict `aiEnabled` validation, immutable snapshot timestamps, canonical timezone validation, and the expanded PostgreSQL schema proof. It returned `STATUS: CHANGES REQUIRED` only for the two issues specified here.

All requirements in `TASK-004.md` and `TASK-004-REMEDIATION-01.md` remain binding.

Relevant sources:

- `AGENTS.md`;
- `tasks/TASK-004.md`;
- `tasks/TASK-004-REMEDIATION-01.md`;
- `tasks/TASK-003.md` and `tasks/TASK-003-REMEDIATION-01.md` for database error security;
- relevant approved architecture/database documentation; and
- the actual `origin/main...HEAD` code and tests.

## Required implementation

### 1. Keep PostgreSQL constraint payloads private

Remove arbitrary constraint data from the public `DatabaseError` contract.

Required behavior:

- `DatabaseError` must not expose a public `constraint` property.
- Its constructor options, `toJSON`, custom inspection result, string form, stack, cause, and any other public/observable surface must not contain a raw constraint payload.
- `sanitizeDatabaseError` must not copy or attach a raw driver constraint, even when it is a string.
- Generic safe database errors retain their stable safe code/message behavior without constraint metadata.
- The tenancy adapter may inspect a raw driver error only through the existing exception-safe, descriptor-based predicate and only to answer whether code is an approved unique violation and constraint is exactly `workspaces_slug_unique`.
- The exact slug decision remains adapter-private. Do not preserve the raw constraint for later classification, logging, serialization, or inspection.
- If code or constraint cannot be read safely, is missing, has an accessor, is non-string, contains any other value, or is otherwise ambiguous, classification must fail closed to a generic safe `DatabaseError`.
- Remove any broad outer fallback that depends on a public sanitized constraint. A previously constructed `SlugConflictError` may pass through by its existing safe identity; raw driver classification must happen only while the adapter still owns the raw failure.

Do not solve this by applying generic credential stripping to the constraint and then exposing it. The constraint is untrusted metadata and must be omitted entirely from generic errors.

Add regression tests for both inner and outer catch behavior:

- exact `23505` plus `workspaces_slug_unique` maps to `SlugConflictError`;
- the repository's approved equivalent unique code plus exact slug constraint behaves as specified by Remediation 01;
- unknown, missing, non-string, accessor-backed, proxy-backed, or hostile constraint values never map to slug conflict;
- primary-key, membership, and external-identity constraint names never map to slug conflict;
- a hostile constraint containing a PostgreSQL URL, username, password, host, database, SQL text, bind sentinel, newline, or stack-like text is absent from direct properties, `Object.keys`, `Reflect.ownKeys` string values, `JSON.stringify`, `String`, `util.inspect`, logger arguments, thrown output, and child-process stdout/stderr; and
- `sanitizeDatabaseError` never returns an error with public raw constraint metadata.

Preserve all TASK-003 protections against hostile getters, proxies, inspection hooks, serialization hooks, mutable causes, and credential leakage.

### 2. Validate original timestamp strings before conversion

The mapper behavior must distinguish driver `Date` inputs from string inputs.

For a string input:

- call the canonical domain timestamp parser on the original string exactly as received;
- do not call `new Date(value)`, `Date.parse`, `toISOString`, formatter APIs, trimming, normalization, or replacement before validation; and
- return the parser's canonical value only if the original string already matches the exact approved `YYYY-MM-DDTHH:mm:ss.sssZ` representation and round-trips identically.

For a genuine valid `Date` input:

- convert that `Date` independently with `toISOString()`;
- validate the resulting canonical string through the domain parser; and
- never return or retain the mutable driver-owned `Date`.

For every invalid or noncanonical input, return the existing credential-safe `DatabaseError` behavior without including the raw timestamp or row.

Apply the same helper consistently to every timestamp field in:

- `UserSnapshot` mapping;
- `WorkspaceSnapshot` mapping; and
- `WorkspaceMembershipSnapshot` mapping, including nullable `joinedAt`.

Add a table-driven regression matrix for every timestamp-bearing mapper and field. Reject at least:

- missing milliseconds: `2026-10-25T12:00:00Z`;
- space-separated form: `2026-10-25 12:00:00+00`;
- explicit `+00:00` offset;
- non-zero timezone offset;
- lowercase `z`;
- extra fractional precision;
- shortened fractional precision;
- surrounding whitespace;
- date-only strings;
- numeric epoch strings;
- invalid dates/times; and
- non-string/non-`Date` values.

Accept:

- exact canonical strings such as `2026-10-25T12:00:00.000Z`; and
- valid `Date` objects, returning a canonical immutable string.

Tests must prove the mapper does not silently transform rejected strings and that the thrown error contains none of the rejected raw value through message, stack, JSON, string, inspection, logs, or child-process output.

## Expected files

Expected focused changes:

- `tasks/TASK-004-REMEDIATION-02.md`;
- `packages/infrastructure/src/database/errors.ts`;
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts` only as needed to keep exact classification private;
- `packages/infrastructure/src/tenancy/mappers.ts`;
- focused database-error and tenancy-adapter unit tests; and
- focused integration/child-process tests only where required by the acceptance criteria.

Do not modify domain/application contracts, timezone behavior, `aiEnabled` behavior, migrations, or schema unless a direct test proves a regression caused by these two fixes.

## Database changes

None. Do not add or edit a migration.

## API changes

None. Do not change routes, contracts, error responses, cookies, sessions, CORS, or CSRF behavior.

## Frontend changes

None.

## Backend changes

Only private error classification/sanitization and row timestamp validation in infrastructure, plus focused tests. Preserve API/worker lifecycle and all existing tenancy behavior.

## Security requirements

- Treat every raw driver constraint as untrusted and secret-bearing.
- Never expose constraint payloads in public errors, logs, JSON, inspection, strings, stacks, causes, metadata, or process output.
- Exact slug classification is a private allowlist decision, not public error metadata.
- Classification uncertainty must fail closed to a generic safe database error.
- Do not execute hostile getters, proxy traps, coercion, serialization, or inspection hooks while classifying.
- Do not include rejected timestamp text or row data in errors.
- Preserve TASK-003 credential redaction and hostile-object guarantees.
- No test-only bypass or production debug export may be added.

## Edge cases

- Correct unique code with hostile or unreadable constraint.
- Correct slug constraint with missing/wrong/non-string code.
- Sanitized `DatabaseError` re-entering the adapter outer catch without raw metadata.
- `SlugConflictError` created by the inner boundary passing through unchanged.
- Timestamp strings that represent the same instant as canonical input but use a different textual form.
- Valid `Date` and invalid `Date` inputs.
- Nullable `joinedAt` remains `null`; non-null values follow the exact timestamp rules.
- One bad timestamp among otherwise valid row fields fails the whole mapper safely.

## Acceptance criteria

1. Public `DatabaseError` has no raw `constraint` property or serialized/inspectable constraint payload.
2. Only the adapter-private exact allowlist of unique code plus `workspaces_slug_unique` produces `SlugConflictError`.
3. All ambiguous and non-slug unique failures produce a generic credential-safe database error.
4. The hostile constraint reproduction leaks no sentinel through any required observable surface.
5. String timestamp inputs are validated in their original form and parseable noncanonical strings are rejected.
6. Valid `Date` inputs are independently converted to immutable canonical strings without retaining mutable state.
7. Every timestamp field in all three mappers is covered by canonical and noncanonical tests.
8. All prior Remediation 01 tests, 79 PostgreSQL integration tests or their expanded successor count, tenant isolation, migrations, security gates, and clean-checkout verification remain passing.
9. No schema, API, frontend, authentication, audit, product, or unrelated scope is introduced.
10. Local HEAD, remote branch, and PR head match the final reviewed SHA and the working tree is clean.

## Test plan

### Focused unit/security tests

- Adapter-private exact slug classification at both catch boundaries.
- Public `DatabaseError` surface inspection proving constraint omission.
- Hostile constraint sentinel matrix across properties, JSON, string, inspection, logging, thrown output, and child-process output.
- Canonical timestamp acceptance and noncanonical table for every mapper field.
- Valid and invalid driver `Date` inputs.
- Credential-safe error behavior for invalid timestamp inputs.

### Regression verification

Run all commands required by TASK-004 and both remediation files, including:

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
git status --short
```

Also run exact-image pin inspection, both required Trivy scans, the no-ignore negative control, runtime regression checks, and clean-checkout verification. Report actual exit codes and exact-SHA GitHub results.

## Out of scope

- Any requirement not needed to close these two findings.
- Schema or migration changes.
- Domain/application redesign, new timestamp representation, timezone changes, or `aiEnabled` changes.
- OIDC, sessions, HTTP APIs, frontend, invitations, role mutation, audit, products, AI, scheduling, publishing, analytics, social functionality, or queues.
- ORM/query builder, generic repository layer, dependency upgrades, or broad refactors.
- Relaxing TASK-003 hostile-error or security guarantees.

## Implementation handoff requirements

This remediation is proposed for Product Owner approval. Antigravity must not implement it until the Product Owner explicitly approves it.

Before coding, Antigravity must read `AGENTS.md`, TASK-004, both TASK-004 remediation files, relevant approved documentation, the complete Codex findings, and the actual `origin/main...HEAD` diff.

Before declaring ready for re-review, report:

- the private exact constraint-classification design;
- proof that public `DatabaseError` has no constraint payload;
- the full hostile-constraint output-surface test result;
- the canonical/noncanonical timestamp matrix for every mapper;
- every required command and exact-SHA CI result;
- changed files, final local/remote/PR SHA, and clean working-tree status; and
- any skipped check, failure, deviation, or limitation.

Codex will re-review the approved requirements, both remediation specifications, actual diff, security behavior, timestamp behavior, and tests before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
