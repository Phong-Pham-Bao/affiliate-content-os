# TASK-004 - Workspace Tenancy Core and PostgreSQL Isolation

Status:  Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved and merged `TASK-003`

## Objective

Establish the smallest durable identity-and-tenancy core needed by later authentication and product slices: PostgreSQL tables for application users, workspaces, and workspace memberships; framework-free domain types and invariants; narrow application ports/use cases; and PostgreSQL repository implementations that require explicit workspace and actor context.

This task must prove that a pre-existing active user can create one workspace with one active owner membership atomically and that membership-scoped reads cannot cross workspace boundaries.

This task does **not** implement sign-in, OIDC redirects or callbacks, sessions, cookies, HTTP endpoints, frontend screens, invitations, membership mutation, audit events, or any product workflow.

## Context

`origin/main` is at `b58daadec69c34192f3c33cb9134ebb000dddeab` (`TASK-003: PostgreSQL, Persistence, Local Infrastructure, and CI Foundation (#3)`) and matched the clean local `main` inspected for this specification.

The repository now has:

- pinned Node.js, pnpm, TypeScript, formatting, lint, dependency-boundary, test, build, audit, and CI gates;
- runnable web, API, and worker shells;
- validated configuration and a narrow PostgreSQL database boundary;
- forward-only migrations with an empty-database validator;
- real-PostgreSQL integration-test isolation; and
- only the `schema_migrations` table from `0001_baseline.sql`.

The approved architecture requires a modular monolith with `packages/domain` independent of frameworks, `packages/application` depending only on domain, and PostgreSQL adapters in `packages/infrastructure`. All tenant-owned access must require workspace context, and application identity is keyed by OIDC issuer/provider plus subject rather than email.

The OIDC vendor remains an open deployment decision in `docs/DECISIONS.md`. Therefore this task creates identity persistence and tenancy boundaries without choosing or integrating an identity provider. A later task will adapt verified OIDC claims into the application identity port.

Relevant sources:

- `AGENTS.md`;
- `docs/PRODUCT.md`, especially account/workspace scope, the fixed role matrix, and Sprint 1;
- `docs/ARCHITECTURE.md`, especially sections 2-7, 14-15, 17, 19, and 21;
- `docs/DATABASE.md`, especially sections 1-2, 12, and 14;
- `docs/API.md`, especially sections 1-5, only to preserve future contracts;
- `docs/DECISIONS.md`, especially ADR-001 through ADR-006 and ADR-020; and
- `tasks/TASK-003.md` plus its approved remediation for the database, migration, testing, and security contracts.

## Required implementation

### 1. Add only the domain and application packages needed by this slice

Create real, buildable `@affiliate-content-os/domain` and `@affiliate-content-os/application` workspace packages. Do not create empty placeholder packages.

`packages/domain` must contain only framework-free identity/workspace concepts exercised by this task:

- opaque user, workspace, and membership ID types with validation for canonical UUIDv7 strings;
- `UserStatus`: `active`, `disabled`, `deletion_pending`;
- `WorkspaceStatus`: `active`, `suspended`, `deletion_pending`;
- `WorkspaceRole`: `owner`, `editor`, `viewer`;
- `MembershipStatus`: `active`, `suspended`, `removed`;
- immutable user, workspace, and membership snapshots; and
- deterministic validation for workspace name, normalized slug, and IANA timezone.

Do not add product entities, generic entity bases, aggregate frameworks, event sourcing, domain-event buses, decorators, reflection, or persistence concerns to domain.

`packages/application` must contain only:

- a narrow port for resolving an active user by ID;
- a narrow workspace persistence port for atomic workspace-and-owner creation and membership-scoped reads;
- an injected ID generator and clock port; and
- a `CreateWorkspace` use case that validates input, verifies the initiating user is active, generates IDs, and delegates one atomic persistence operation.

Do not create a dependency-injection container, generic repository/unit-of-work base, HTTP/controller types, session types, provider SDK types, or speculative use cases.

The application result must be an immutable workspace snapshot plus the caller's active owner membership. Slug conflict and inactive/missing-user outcomes must use explicit typed application errors; they must not depend on parsing PostgreSQL error text outside infrastructure.

### 2. Add migration `0002_identity_tenancy.sql`

Add one forward-only migration creating exactly these business tables:

- `users`;
- `workspaces`; and
- `workspace_memberships`.

No other business, audit, outbox, idempotency, session, token, OAuth, product, or scheduling table is allowed.

#### `users`

Required columns:

- `id uuid primary key`;
- `identity_provider text not null`;
- `identity_subject text not null`;
- `email text null`;
- `display_name text null`;
- `status text not null`;
- `created_at timestamptz not null`;
- `updated_at timestamptz not null`; and
- `version bigint not null default 1`.

Required constraints:

- unique `(identity_provider, identity_subject)`;
- status limited to `active`, `disabled`, `deletion_pending`;
- provider and subject cannot be empty after trimming;
- version is at least `1`; and
- `updated_at >= created_at`.

Email is display/contact metadata only. No uniqueness constraint or identity merge may use email.

#### `workspaces`

Required columns:

- `id uuid primary key`;
- `name text not null`;
- `slug text not null`;
- `timezone text not null`;
- `brand_voice text null`;
- `default_disclosure text null`;
- `ai_enabled boolean not null default false`;
- `status text not null`;
- `created_at timestamptz not null`;
- `updated_at timestamptz not null`; and
- `version bigint not null default 1`.

Required constraints:

- unique normalized `slug` stored in lowercase canonical form;
- slug uses only lowercase ASCII letters, digits, and single hyphen-separated segments;
- status limited to `active`, `suspended`, `deletion_pending`;
- name and timezone cannot be empty after trimming;
- version is at least `1`; and
- `updated_at >= created_at`.

IANA timezone validity is enforced at the domain/application boundary, not by a database extension. `ai_enabled` defaults to the safer disabled state.

#### `workspace_memberships`

Required columns:

- `id uuid primary key`;
- `workspace_id uuid not null` referencing `workspaces(id)`;
- `user_id uuid not null` referencing `users(id)`;
- `role text not null`;
- `status text not null`;
- `invited_by_user_id uuid null` referencing `users(id)`;
- `joined_at timestamptz null`;
- `created_at timestamptz not null`;
- `updated_at timestamptz not null`; and
- `version bigint not null default 1`.

Required constraints and indexes:

- unique `(workspace_id, user_id)`;
- role limited to `owner`, `editor`, `viewer`;
- status limited to `active`, `suspended`, `removed`;
- an active membership requires non-null `joined_at`;
- version is at least `1`;
- `updated_at >= created_at`;
- an index supporting active membership lookup by `(user_id, workspace_id)`; and
- an index supporting active members by `(workspace_id, status)`.

Foreign keys must not silently cascade-delete users, workspaces, or memberships. Workspace deletion is a later explicit workflow.

Migration SQL must remain deterministic, parameter-free trusted source and compatible with the TASK-003 migration runner. Do not add down migrations, extensions, triggers, seed users, seed workspaces, or automatic startup migration.

### 3. Implement the PostgreSQL identity/workspace adapter

Expose a narrow public infrastructure subpath for this slice, implemented using the existing database API and parameterized SQL.

The adapter must:

- resolve an active user by supplied `UserId` without reading environment variables;
- atomically insert a workspace and its initial active owner membership in one existing database transaction;
- map unique slug conflicts to the typed application conflict error without exposing raw driver errors;
- return the created workspace and owner membership only after both inserts succeed;
- read a workspace only through `(workspaceId, userId)` active-membership scope;
- resolve a membership only through `(workspaceId, userId)` and never by membership ID alone for authorization context;
- return the same non-disclosing not-found outcome for an absent workspace and a workspace inaccessible to that user; and
- map rows explicitly rather than returning driver row objects.

Repository methods must require typed IDs and never infer workspace context from mutable global state, environment variables, cookies, request objects, or asynchronous context storage.

Do not add a generic SQL repository, ORM, query builder, active-record model, global connection singleton, implicit transaction, or repository cache.

### 4. Preserve and extend architecture boundaries

Update manifests, TypeScript project configuration, dependency-cruiser fixtures/tests, and the lockfile only as required to make the new packages substantive members of the existing workspace.

Required direction:

```text
packages/domain <- packages/application <- packages/infrastructure <- apps/api|apps/worker
```

- domain imports no other internal package and no Fastify, Next.js, React, `pg`, config, or infrastructure module;
- application imports only domain among internal packages;
- infrastructure implements application ports and may use domain types;
- web must not import domain, application, or infrastructure; and
- cross-workspace imports use declared package exports only.

This task must not wire the new use case into API or worker composition roots because no authenticated principal exists yet.

### 5. Keep the slice deterministic and bounded

- The caller supplies no IDs or timestamps for `CreateWorkspace`; injected deterministic ports do so.
- Normalize the slug before persistence and conflict comparison.
- Validate timezone with the standard runtime IANA database; tests must not depend on the developer machine's local timezone.
- Trim user-entered name, brand voice, and disclosure consistently; blank optional text becomes `null`.
- Creation always produces an `active` workspace, an `active` owner membership, `joined_at` equal to the injected current time, and version `1` for both rows.
- Creating a workspace does not modify the user row.
- No retry loop may hide a slug conflict or repeat a partially failed transaction.

## Expected files

Expected additions or focused changes include:

- `packages/domain/package.json` and TypeScript build configuration;
- `packages/domain/src/...` identity/workspace types, validation, and public exports;
- `packages/domain/test/...` focused unit tests;
- `packages/application/package.json` and TypeScript build configuration;
- `packages/application/src/...` ports, errors, `CreateWorkspace`, and public exports;
- `packages/application/test/...` use-case tests with fakes;
- `packages/infrastructure/migrations/0002_identity_tenancy.sql`;
- `packages/infrastructure/src/...` PostgreSQL identity/workspace adapter and public export;
- focused infrastructure unit and real-PostgreSQL integration tests;
- workspace manifests/lockfile and boundary tests where required; and
- README documentation limited to the new schema/test commands if existing instructions would otherwise be incomplete.

Do not create files for HTTP routes, OpenAPI, frontend pages, OIDC providers, sessions, audit, invitations, products, or future modules.

## Database changes

Add only migration `0002_identity_tenancy.sql` and the three tables specified above. Migration validation must prove a fresh database applies `0001` then `0002`, records both checksums, and has no additional application tables.

No seed data is committed. Integration tests create unique guarded test data and clean it through the existing isolated-database lifecycle.

## API changes

None.

- Do not add `/auth/*`, `/api/v1/me`, workspace routes, or test-only routes.
- Preserve the exact existing liveness response.
- Do not change CORS, cookies, CSRF, request authentication, or HTTP error mapping.

## Frontend changes

None.

- Do not add login, onboarding, workspace selection, settings, or membership UI.
- Do not expose infrastructure/domain packages to the web bundle.

## Backend changes

Add the domain/application tenancy core and its PostgreSQL adapter only. No runtime process should automatically create users/workspaces, seed data, or run migrations. API and worker startup/shutdown behavior must remain unchanged.

## Security requirements

- Treat `identity_provider`, `identity_subject`, and email as sensitive identity metadata. Do not log, serialize in errors, or include them in snapshots beyond the explicit user entity contract.
- Email must never authorize, deduplicate, merge, or resolve an identity.
- Every workspace read requires both `workspace_id` and `user_id` plus an active membership predicate.
- Cross-tenant and inactive/removed-membership reads return the same non-disclosing absence result.
- Use parameterized SQL for every value. Never interpolate IDs, slugs, identity values, roles, statuses, or timestamps.
- Do not accept a workspace ID from ambient/global context.
- Database constraints are defense in depth; repositories and use cases must validate their own boundary inputs.
- Do not log raw SQL, bind values, row objects, database URLs, or driver errors.
- Preserve TASK-003 secret redaction, transaction cleanup, migration safety, and destructive-test guards.
- No authentication bypass, fake authenticated user, development backdoor, hard-coded principal, or test route may be added.

## Edge cases

- Invalid/noncanonical/non-v7 IDs.
- Empty or whitespace-only workspace name.
- Slugs with uppercase input, surrounding whitespace, repeated hyphens, leading/trailing hyphens, Unicode confusables, or invalid punctuation.
- Unknown or unsupported IANA timezone, including platform-local aliases.
- Empty optional brand/disclosure text.
- Missing, disabled, or deletion-pending initiating user.
- Two concurrent workspace creations using the same normalized slug.
- Failure after workspace insert but before membership insert; neither row may remain.
- Duplicate membership for one user/workspace pair.
- Invalid role/status values attempted directly against PostgreSQL.
- Active membership without `joined_at`.
- User A querying a workspace owned by User B.
- Suspended or removed membership attempting a read.
- Same user belonging to two workspaces without results crossing between them.
- Repository receives a pool/connection/statement error; result remains typed and credential-safe.
- Migration applied from empty state, applied a second time, or validated concurrently under the existing migration contract.

## Acceptance criteria

1. `main` remains based on merged TASK-003 and the existing runtime/database/security contracts continue to pass unchanged.
2. Domain and application packages are substantive, buildable, independently tested, and obey the approved dependency direction.
3. Migration `0002` creates exactly `users`, `workspaces`, and `workspace_memberships` with the specified columns, constraints, foreign keys, uniqueness, and indexes; no extension, seed, trigger, or unrelated table is added.
4. A fresh-database migration validation applies `0001` and `0002`, verifies checksums, and proves a second run is a no-op.
5. `CreateWorkspace` validates and normalizes input, rejects an inactive/missing user, uses injected IDs/time, and atomically creates one active workspace plus one active owner membership.
6. A failure during membership insertion rolls back the workspace insertion and releases the client exactly once.
7. Concurrent normalized-slug collisions create at most one workspace and return one typed conflict without raw PostgreSQL leakage.
8. Membership-scoped reads require both user and workspace IDs and return no data for absent, cross-tenant, suspended, or removed membership cases.
9. Real-PostgreSQL integration tests prove tenant isolation for at least two users and two workspaces in both directions.
10. Database constraints independently reject invalid roles/statuses, duplicate external identities, duplicate memberships, invalid canonical slugs, and active membership without `joined_at`.
11. No API, frontend, authentication/session, invitation, audit, product, AI, scheduling, publishing, social, queue, or observability feature is introduced.
12. Existing liveness, runtime lifecycle, credential-redaction, migration, integration, dependency audit, infrastructure-pin, and container-security tests remain passing.
13. The final diff contains no credential, environment override, generated build output, database dump, scan report, test-only production path, generic repository framework, or unrelated documentation rewrite.

## Test plan

### Domain unit tests

- Canonical UUIDv7 acceptance and rejection matrix.
- Role/status closed sets.
- Workspace name, slug normalization/validation, optional-text normalization, and IANA timezone validation.
- Immutable snapshots and no framework/database imports.

### Application unit tests

- Successful creation with deterministic clock/IDs.
- Missing and inactive user rejection before persistence.
- Normalized input passed exactly once to the persistence port.
- Typed slug conflict and persistence failure propagation without raw data.
- No hidden environment, clock, random-ID, database, or framework dependency.

### PostgreSQL integration tests

- Fresh migration and exact table/constraint/index inspection.
- Atomic workspace plus owner creation.
- Forced second-insert failure rollback.
- Concurrent normalized-slug conflict.
- Duplicate external identity and membership rejection.
- Direct invalid status/role/slug/joined-at constraint rejection.
- Two-user/two-workspace isolation matrix, including suspended and removed memberships.
- Typed, credential-safe mapping for database failures.

### Architecture and regression tests

- Allowed domain-to-application-to-infrastructure direction.
- Rejected domain/application framework, database, config, and reverse imports.
- Rejected web imports of domain/application/infrastructure.
- Existing API/worker lifecycle and web boundary tests unchanged.

### Required verification

Run and report actual results for:

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

Also provide CI evidence for the exact implementation SHA and repeat the TASK-003 container-security commands required by the workflow. Clean-checkout verification must start without `.env`, `node_modules`, build output, or a pre-existing integration database and must leave the checkout clean.

## Out of scope

- Managed OIDC vendor selection or integration, authorization redirects/callbacks, PKCE, discovery, claim verification, login/logout, sessions, cookies, CSRF, CORS changes, or `/api/v1/me`.
- HTTP routes, OpenAPI, Problem Details mapping, frontend UI, authenticated SSR, or browser session forwarding.
- Invitations, email delivery, membership creation/update/removal APIs, role changes, ownership transfer, last-owner removal handling, or workspace deletion.
- Permission evaluation beyond defining the fixed role values; route/use-case authorization is a later slice.
- Audit events, outbox, idempotency records, observability package, rate limits, or telemetry.
- Products, facts, affiliate URLs, media, AI, content, compliance, approval, scheduling, publishing, analytics, or social-platform functionality.
- Social OAuth or credential storage.
- Row-level security, custom PostgreSQL roles, database-per-tenant, schemas-per-tenant, or tenant caches.
- ORM/query builder, generic repository/unit-of-work framework, dependency-injection container, CQRS, event sourcing, microservices, Redis, Kafka, or Kubernetes.
- Seed/demo data, admin scripts, fixtures exposed to production code, or development authentication bypasses.
- Changes to approved documents under `docs/`; any architecture change requires a separate approved decision.

## Implementation handoff requirements

This specification is presented for Product Owner approval. Antigravity must not implement it until the Product Owner explicitly changes the status to `Approved by Product Owner` or otherwise gives explicit approval.

Before implementation, Antigravity must read `AGENTS.md`, this task, the relevant approved documents listed in Context, and the current `origin/main` implementation. Any deviation in schema, status values, package boundaries, tenancy query shape, transaction ownership, or scope must be reported before coding.

Before declaring the implementation ready for Codex review, report:

- every created, modified, and deleted file;
- the exact migration DDL, constraints, indexes, and resulting relation set;
- public domain/application/infrastructure exports and dependency direction;
- `CreateWorkspace` input/output/errors and transaction sequence;
- tenant-isolation and rollback evidence from real PostgreSQL;
- every required verification command with actual exit status/result;
- CI results for the implementation SHA;
- final local/remote SHA and clean working-tree status; and
- every deviation, skipped check, or known limitation.

Codex will compare the user requirement, this specification, approved architecture, actual base-to-head diff, surrounding code, real migration behavior, and executed tests before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
