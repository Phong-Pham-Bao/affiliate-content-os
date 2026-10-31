# TASK-004 Remediation 01 - Validation, Immutable Snapshots, Conflict Mapping, and Schema Proof

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-004` and implementation commit `9cd13d625529f9b20a5a7819c4be7a0b557d250b`

## Objective

Correct the five findings from the independent Codex review of TASK-004 without expanding the feature scope.

This remediation must:

1. map only the named workspace-slug constraint to `SlugConflictError`;
2. reject non-boolean `aiEnabled` values before any dependency call;
3. make every domain/application/infrastructure snapshot timestamp observably immutable;
4. reject timezone aliases deterministically while preserving explicitly approved identifiers; and
5. complete the real-PostgreSQL proof for every schema constraint, required index, and non-cascading foreign key.

Do not add authentication, APIs, UI, invitations, role mutation, audit, product functionality, or any other feature.

## Context

PR #4 targets `main` from `agy/task-004-workspace-tenancy-core`. The reviewed local HEAD, remote branch, and PR head were all `9cd13d625529f9b20a5a7819c4be7a0b557d250b`; the worktree was clean and all three GitHub checks succeeded on that SHA.

Codex returned `STATUS: CHANGES REQUIRED` with two HIGH and three MEDIUM findings. The existing implementation otherwise passed formatting, lint, dependency boundaries, typecheck, build, aggregate checks, dependency/security validation, and CI. Local PostgreSQL commands could not run during review because the Docker Desktop Linux engine was unavailable; the exact-SHA GitHub PostgreSQL job passed, but implementation must still provide real-database evidence from an available local or CI environment.

This file supplements, and does not replace, `TASK-004.md`. All TASK-004 requirements remain binding unless this remediation makes a narrower representation decision explicit.

Relevant sources:

- `AGENTS.md`;
- `tasks/TASK-004.md`;
- `tasks/TASK-003.md` and `tasks/TASK-003-REMEDIATION-01.md` for safe database-error handling;
- `docs/ARCHITECTURE.md`, especially module, database, security, and testing boundaries;
- `docs/DATABASE.md`, especially conventions, identity/tenancy, and migrations;
- `docs/PRODUCT.md` for workspace timezone semantics; and
- the actual `origin/main...HEAD` implementation and tests.

## Required implementation

### 1. Map only the exact slug constraint

In the PostgreSQL tenancy adapter, translate a uniqueness failure to `SlugConflictError` only when both conditions are proven:

- the PostgreSQL error represents unique violation code `23505` (or the repository's already-sanitized equivalent); and
- the reported constraint name is exactly `workspaces_slug_unique`.

Workspace primary-key, membership primary-key, duplicate membership, external-identity uniqueness, or any other unique violation must not become `SlugConflictError`. Those failures must pass through the existing credential-safe database error mapping without exposing raw driver values.

Apply the same exact predicate at every catch boundary. Do not retain a broad outer fallback that turns an arbitrary unique violation into a slug conflict.

The predicate must be exception-safe and compatible with TASK-003 hostile-error protections. Do not stringify, inspect, log, attach, or broadly traverse an untrusted driver error merely to read its code or constraint.

Add focused tests for at least:

- `workspaces_slug_unique` -> `SlugConflictError`;
- `workspaces_pkey` -> safe database error, not slug conflict;
- `workspace_memberships_pkey` -> safe database error, not slug conflict;
- `workspace_memberships_workspace_user_unique` -> safe database error, not slug conflict;
- `users_identity_provider_subject_unique` -> safe database error, not slug conflict;
- code `23505` with missing, unknown, non-string, or unsafe constraint -> safe database error; and
- non-unique database failures -> existing safe database error behavior.

Unit tests must exercise both the workspace-insert catch and the outer transaction catch. A real-PostgreSQL test must prove the named slug constraint maps correctly and a duplicate membership does not.

### 2. Validate `aiEnabled` strictly before dependencies

The runtime boundary must accept only:

- `undefined`, which becomes `false`;
- boolean `false`; or
- boolean `true`.

Every other runtime value, including `null`, strings, numbers, bigint, arrays, functions, symbols, and objects, must produce the existing typed `ValidationError` for field `aiEnabled`.

Validation must happen before:

- user lookup;
- clock access;
- ID generation; and
- persistence.

Do not coerce with `Boolean`, truthiness, loose equality, serialization, or string parsing. The TypeScript command type remains boolean/undefined, but tests must deliberately cross the runtime boundary using `unknown` values because compile-time types are not runtime validation.

### 3. Use immutable timestamp values in snapshots

Change domain snapshot timestamps from mutable `Date` objects to immutable canonical RFC 3339 UTC strings.

Define one narrow domain timestamp type/parser used by user, workspace, and membership snapshots. A valid snapshot timestamp must:

- be a string;
- parse to a valid instant;
- be in canonical `YYYY-MM-DDTHH:mm:ss.sssZ` form; and
- round-trip exactly through `new Date(value).toISOString()`.

The timestamp value is a primitive string and therefore cannot be mutated through `Date` methods. Do not expose a mutable `Date`, wrapper with mutable internal state, getter returning shared state, or unsafe cast as the snapshot representation.

The injected clock may continue returning a `Date`, but `CreateWorkspace` must read it exactly once, validate it, and immediately convert it to one canonical timestamp string. It may assign the same primitive string value to timestamps representing the same instant; no mutable object may be shared.

Infrastructure row mappers must convert every PostgreSQL timestamp independently to the canonical domain timestamp type and reject invalid/noncanonical/unparseable driver values with the existing safe database error behavior. They must not return driver-owned `Date` objects.

Update all affected ports, fixtures, tests, and public exports consistently. Do not add a date/time dependency.

Regression tests must cover:

- application-created workspace and membership snapshots;
- database-mapped user, workspace, and membership snapshots;
- all timestamp fields individually;
- attempted consumer mutation or reassignment leaving all snapshot values unchanged;
- no change to one field when another field is manipulated;
- invalid clock `Date` failure before persistence;
- valid PostgreSQL string and `Date` inputs mapping to canonical strings; and
- invalid timestamp row values failing safely.

### 4. Enforce canonical timezone membership

Timezone validation must be deterministic for the pinned Node.js runtime and must not accept a value merely because `Intl.DateTimeFormat` recognizes an alias.

Build the accepted runtime set from `Intl.supportedValuesOf('timeZone')` and accept exact, case-sensitive membership only. In addition, explicitly accept these project-approved identifiers because approved documentation or UTC semantics require them even when the runtime's canonical set omits them:

- `UTC`;
- `Etc/UTC`; and
- `Asia/Ho_Chi_Minh`.

Return the exact approved input identifier after trimming; do not silently rewrite an alias to another zone.

Reject:

- `US/Eastern` and other legacy aliases absent from the canonical set;
- abbreviations such as `EST`, `PST`, and `ICT`;
- Windows timezone names;
- case variants;
- fixed-offset strings;
- whitespace-only and unknown values; and
- non-string runtime values.

Tests must use the runtime-supported set as their oracle rather than the developer machine's local timezone. Include representative canonical zones from more than one region plus all three explicitly approved identifiers.

### 5. Complete the real-PostgreSQL schema matrix

Extend `tenancy-schema.integration.test.ts` so it independently proves every TASK-004 schema requirement. Do not treat migration text inspection or a successful insert as sufficient proof.

Required `users` negative cases:

- duplicate `(identity_provider, identity_subject)`;
- empty and whitespace-only `identity_provider`;
- empty and whitespace-only `identity_subject`;
- each invalid status;
- version `0` and a negative version; and
- `updated_at < created_at`.

Required `workspaces` negative cases:

- duplicate normalized/canonical slug;
- uppercase, leading/trailing hyphen, repeated hyphen, whitespace, Unicode, and punctuation slug violations;
- empty and whitespace-only name;
- empty and whitespace-only timezone;
- invalid status;
- version `0` and a negative version; and
- `updated_at < created_at`.

Required `workspace_memberships` negative cases:

- duplicate `(workspace_id, user_id)`;
- duplicate membership primary key where relevant to constraint/error mapping;
- every invalid role;
- every invalid status;
- active membership with null `joined_at`;
- version `0` and a negative version;
- `updated_at < created_at`;
- missing workspace foreign key;
- missing user foreign key; and
- missing inviter foreign key.

Schema-structure inspection must prove:

- `idx_workspace_memberships_user_workspace` exists with columns in exact order `(user_id, workspace_id)`;
- `idx_workspace_memberships_workspace_status` exists with columns in exact order `(workspace_id, status)`;
- membership foreign keys to workspace, user, and inviter use `ON DELETE RESTRICT`/the PostgreSQL catalog's equivalent no-action blocking behavior and do not cascade;
- attempting to delete referenced workspace/user rows is blocked while memberships reference them; and
- only the three TASK-004 business tables exist in addition to `schema_migrations`.

Each negative test must run in isolated transaction/data setup so one expected failure does not poison later assertions. Tests must clean up through the existing guarded integration lifecycle and remain safe under parallel Vitest execution.

## Expected files

Expected focused changes:

- `tasks/TASK-004-REMEDIATION-01.md`;
- `packages/domain/src/types.ts` plus a narrowly placed timestamp parser/type and public export;
- `packages/domain/src/validation.ts` and domain tests;
- `packages/application/src/create-workspace.ts` and focused use-case tests;
- `packages/application/src/ports.ts` or fixtures only where timestamp types require it;
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`;
- `packages/infrastructure/src/tenancy/mappers.ts`;
- tenancy unit tests; and
- `packages/infrastructure/test/integration/tenancy-schema.integration.test.ts` plus focused adapter integration tests.

Do not change migration `0002_identity_tenancy.sql` unless a test proves the committed DDL itself violates TASK-004. Finding 5 is primarily missing proof, not evidence that the DDL is wrong.

## Database changes

No new migration and no schema change are expected.

Migration `0002_identity_tenancy.sql` remains the schema under test. If implementation discovers that a DDL correction is unavoidable, stop and report the exact mismatch before creating `0003`; never edit an already-applied migration silently during remediation without explicit Product Owner/Codex approval.

## API changes

None. Do not add or modify routes, request/response contracts, OpenAPI, cookies, sessions, CORS, CSRF, or error handlers.

## Frontend changes

None. Do not add login, workspace, membership, or settings UI.

## Backend changes

Only the domain/application/infrastructure corrections and tests described above. API and worker runtime composition, liveness, startup, and shutdown behavior remain unchanged.

## Security requirements

- Never expose raw database errors, constraint payloads, SQL, bind values, identity metadata, credentials, or stack traces.
- Exact constraint classification must fail closed: uncertainty produces a generic safe database error, never a false slug conflict.
- Runtime validation must reject type confusion before any dependency or persistence side effect.
- Snapshot consumers must not be able to mutate stored state through returned timestamp values.
- Timezone aliases must not be accepted through permissive canonicalization.
- Preserve all TASK-003 hostile-error, redaction, transaction cleanup, and release-once guarantees.
- All new SQL assertions and fixtures remain parameterized and confined to guarded test databases.
- Do not add test-only behavior to production exports merely to simplify tests.

## Edge cases

- Unique violation with correct code but missing/wrong/unsafe constraint name.
- Safe slug conflict thrown inside the transaction and re-observed at the outer catch.
- Runtime `aiEnabled` values `null`, `0`, `1`, `''`, `'false'`, `'true'`, arrays, objects, symbols, bigint, and functions.
- Clock returns an invalid `Date` or a caller later mutates the original clock-owned `Date`.
- PostgreSQL returns timestamps as strings or `Date` instances.
- Equal timestamps across fields remain equal by value without sharing mutable state.
- Timezones recognized by formatter construction but absent from the canonical set.
- Explicit `UTC`, `Etc/UTC`, and `Asia/Ho_Chi_Minh` handling when absent from `Intl.supportedValuesOf`.
- Expected PostgreSQL constraint failure aborts a transaction; subsequent assertions use fresh isolated setup.
- Foreign-key delete action catalog representation differs between `RESTRICT` and equivalent blocking `NO ACTION`; behavior must still be proven non-cascading.
- Docker unavailable locally: report the failure honestly and rely on exact-SHA CI only as additional evidence, never claim the local command passed.

## Acceptance criteria

1. Only `workspaces_slug_unique` maps to `SlugConflictError`; all other unique violations become the existing safe database error type.
2. `aiEnabled` accepts only `undefined`, `true`, or `false`, and every invalid runtime value fails before any dependency call.
3. Every user/workspace/membership snapshot timestamp is an immutable canonical RFC 3339 UTC string; no consumer mutation can change it or another field.
4. Application and database-mapped snapshots are frozen and contain no mutable timestamp object.
5. Timezone validation uses exact canonical-set membership plus only `UTC`, `Etc/UTC`, and `Asia/Ho_Chi_Minh`; aliases and platform-local names are rejected.
6. Real-PostgreSQL tests exercise every required constraint negative case from this remediation.
7. Catalog inspection proves both required indexes and non-cascading foreign-key actions; behavioral deletes are blocked.
8. Migration validation still applies `0001` and `0002` from empty state and a second run applies zero migrations.
9. Existing tenant isolation, atomic rollback, exact-once release, boundary, hostile-error, runtime, audit, pin, and container-security tests remain passing.
10. No schema, API, frontend, authentication, audit, product, scheduling, AI, social, or unrelated documentation scope is introduced.
11. Local/remote/PR SHA alignment and a clean working tree are proven before review.

## Test plan

### Focused unit tests

- Exact constraint-name classification matrix at both adapter catch boundaries.
- Strict `aiEnabled` runtime-type matrix with zero dependency calls on failure.
- Canonical timestamp parsing and immutable snapshot behavior.
- Application-created and row-mapped timestamp regression matrix.
- Canonical/approved timezone acceptance and alias/platform-name rejection.

### PostgreSQL integration tests

- Exact slug constraint mapping versus other unique constraints.
- Every `users`, `workspaces`, and `workspace_memberships` negative case listed above.
- Exact index names and column order through PostgreSQL catalogs.
- Foreign-key delete action inspection and blocked-delete behavior.
- Exact relation set after migrations.
- Existing atomic creation, rollback, concurrency, and tenant-isolation tests.

### Regression and clean-checkout verification

Run and report actual exit codes/results for all commands required by TASK-004, including:

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

Also run the required exact-image Trivy review scan, blocking scan, and no-ignore negative control. Provide GitHub check evidence on the final implementation SHA. Clean-checkout verification must use a temporary location outside the repository and must leave both checkouts clean.

## Out of scope

- Any requirement not needed to close Findings 1-5.
- New tables, migrations, extensions, triggers, seed data, or schema redesign.
- OIDC, login/logout, sessions, cookies, CSRF, CORS, HTTP routes, OpenAPI, or frontend UI.
- Invitations, membership mutation, role changes, ownership transfer, workspace deletion, or authorization policy expansion.
- Audit, outbox, idempotency, observability, products, media, AI, content, approval, scheduling, publishing, analytics, social connections, or queues.
- ORM/query builder, repository framework, DI container, CQRS, event sourcing, microservices, Redis, Kafka, or Kubernetes.
- Broad refactors of TASK-003 database sanitization or process lifecycle code.
- Dependency upgrades unrelated to a demonstrated blocker.

## Implementation handoff requirements

This remediation is proposed for Product Owner approval. Antigravity must not implement it until the Product Owner explicitly approves it.

Before coding, Antigravity must read `AGENTS.md`, `TASK-004.md`, this remediation, the relevant approved documentation, the complete review findings, and the actual `origin/main...HEAD` diff. Report any requested deviation before implementation.

Before declaring ready for re-review, provide:

- the exact constraint-classification predicate and test matrix;
- the complete invalid `aiEnabled` matrix with proof dependencies were untouched;
- the public immutable timestamp representation and every affected contract;
- the accepted/rejected timezone matrix for the pinned Node runtime;
- the complete PostgreSQL constraint/index/foreign-key evidence;
- all required command results and exact-SHA CI evidence;
- changed files, final local/remote SHA, and clean working-tree status; and
- every failure, skipped check, limitation, or deviation.

Codex will re-review the approved requirements, this remediation, the actual implementation, PostgreSQL behavior, and tests before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
