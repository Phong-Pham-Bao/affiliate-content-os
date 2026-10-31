# TASK-005 - Verified OIDC Identity Provisioning Boundary

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: clean `origin/main` after merged TASK-004 and all merged TASK-004 remediations

## Objective

Implement the smallest provider-neutral application identity slice after TASK-004:

1. accept a narrowly shaped, already-verified OIDC identity DTO from a future authentication adapter;
2. resolve the application user by the exact `(identity_provider, identity_subject)` key;
3. provision one active application user when that key is new; and
4. return an immutable, safe application principal for later authenticated use cases.

This task defines the domain, application, and PostgreSQL contracts. It does not select an identity provider, verify tokens, create sessions, add HTTP routes, or modify the frontend.

## Context and governing decisions

The current clean `origin/main` is commit `f8a39fe`, the merged TASK-004 implementation. TASK-004 created the `users` table, immutable `UserSnapshot`, user lookup by ID, UUIDv7/clock ports, and the narrow PostgreSQL tenancy adapter. It explicitly deferred adapting verified OIDC claims into an application identity port.

The approved documentation requires:

- managed OIDC for application identity, separate from social-platform OAuth;
- identity keyed by provider/issuer plus stable subject, never email;
- `active`, `disabled`, and `deletion_pending` user states;
- PostgreSQL as the source of truth;
- explicit modular-monolith dependency direction;
- safe, credential-free database errors; and
- real-infrastructure, hostile-input, boundary, runtime, and clean-checkout verification.

The TASK-004 implementation already exposes `UserSnapshot`, `IsoTimestamp`, `ClockPort`, `IdGeneratorPort`, and the PostgreSQL database boundary. Reuse those contracts; do not create a second user model, timestamp type, ID generator, database abstraction, or transaction abstraction.

### Product Owner decisions that remain unresolved

These decisions are still open in `docs/DECISIONS.md` and must not be selected by Antigravity in this task:

- managed OIDC vendor and supported sign-in methods;
- deployment issuer configuration, client credentials, redirect domains, hosting topology, and session library;
- privacy jurisdiction, exact retention periods, terms/privacy copy, and any email-verification policy; and
- whether editor self-approval remains acceptable after beta.

None of those decisions changes this provider-neutral persistence boundary. A later approved task must supply the selected provider/session adapter and prove token verification before calling this boundary. If implementation discovers that one of these decisions is required to implement the contracts below, stop and report the dependency; do not guess.

## Required implementation

### 1. Exact domain contracts

Add the following framework-free types to `packages/domain/src/identity.ts`.

```ts
export interface VerifiedIdentityClaims {
  readonly identityProvider: string;
  readonly identitySubject: string;
  readonly email?: string | null | undefined;
  readonly displayName?: string | null | undefined;
}

export interface AuthenticationSource {
  readonly kind: 'verified_oidc';
  readonly identityProvider: string;
}

export interface ApplicationPrincipal {
  readonly user: UserSnapshot;
  readonly authenticationSource: AuthenticationSource;
}
```

The public type names above are normative. `VerifiedIdentityClaims` is a DTO, not a JWT, token, request, session, or provider SDK type. `ApplicationPrincipal` contains no token, cookie, request, session identifier, email-derived key, workspace, role, or membership.

#### Runtime validation

The application boundary must validate `unknown` before any dependency call. The accepted claims value must be a plain object whose prototype is `Object.prototype` or `null`, with exactly these own keys:

- required data properties `identityProvider` and `identitySubject`;
- optional data properties `email` and `displayName`; and
- no other own keys.

Accessor properties are rejected. Reading a getter, enumerating a proxy, coercing a value, stringifying a value, or invoking a provider object is prohibited. Any exception while inspecting the value becomes the same safe claims-validation error. A proxy that cannot be inspected safely is rejected.

`identityProvider` and `identitySubject` must each be a non-empty string with no leading or trailing whitespace. Surrounding whitespace is rejected; it is not trimmed. Internal whitespace and case are preserved exactly. No lowercasing, Unicode normalization, URL canonicalization, aliasing, or other identity-key normalization is performed. The exact validated strings become the SQL parameters.

`email` and `displayName` accept `undefined`, `null`, or a string. For a string, trim leading/trailing whitespace; convert the empty result to `null`; otherwise preserve the trimmed string exactly. Do not lowercase email, validate it as an address, Unicode-normalize it, or use it for lookup, conflict recovery, authorization, linking, or uniqueness. `displayName` has the same trim-only rule. Non-string, non-null optional values are rejected.

The resulting claims object and every returned principal, source, and user snapshot must be immutable. Use the existing primitive `IsoTimestamp` strings and `Object.freeze` semantics already established by TASK-004. No returned object may expose a mutable `Date`, mutable array, mutable nested object, getter-backed state, or caller-owned reference.

#### Exact public errors

Add all four errors to `packages/application/src/errors.ts`. They are application-facing errors; the domain package must not import or export `ApplicationError`. Their public fields are normative and must not contain identity metadata:

```ts
export type IdentityClaimField =
  'claims' | 'identityProvider' | 'identitySubject' | 'email' | 'displayName';

export class IdentityClaimsValidationError extends ApplicationError {
  readonly code: 'IDENTITY_CLAIMS_INVALID';
  readonly field: IdentityClaimField;
}

export class IdentityUnavailableError extends ApplicationError {
  readonly code: 'IDENTITY_UNAVAILABLE';
}

export class IdentityPersistenceError extends ApplicationError {
  readonly code: 'IDENTITY_PERSISTENCE_INVALID';
  readonly operation: 'lookup' | 'insert' | 'recovery';
}

export class IdentityProvisioningRaceError extends ApplicationError {
  readonly code: 'IDENTITY_PROVISIONING_RACE';
  readonly retryable: true;
}
```

`IdentityClaimsValidationError.field` identifies only the failing field category. `IdentityUnavailableError` is used for both disabled and deletion-pending users and has no status, user ID, provider, subject, email, or display-name field. `IdentityPersistenceError.operation` is the only diagnostic classification. Messages must be fixed safe text and contain none of the input values. Existing infrastructure `DatabaseError` remains the safe public error for database failures; it must not be wrapped with raw driver data.

### 2. Exact application contracts

Extend `packages/application/src/ports.ts` with these exact ports:

```ts
export interface IdentityLookupKey {
  readonly identityProvider: string;
  readonly identitySubject: string;
}

export interface UserIdentityDirectoryPort {
  findUsersByIdentity(key: IdentityLookupKey): Promise<readonly UserSnapshot[]>;
  insertUserIfAbsent(params: { readonly user: UserSnapshot }): Promise<UserSnapshot | null>;
}
```

The application use-case contract is:

```ts
export interface ResolveVerifiedIdentityCommand {
  readonly claims: unknown;
}

export interface ResolveVerifiedIdentityDependencies {
  readonly identityDirectory: UserIdentityDirectoryPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export async function resolveVerifiedIdentity(
  command: ResolveVerifiedIdentityCommand,
  deps: ResolveVerifiedIdentityDependencies,
): Promise<ApplicationPrincipal>;
```

`insertUserIfAbsent` returns the inserted immutable `UserSnapshot` when the `INSERT ... RETURNING` statement inserted one row and `null` when `ON CONFLICT DO NOTHING` returned zero rows. It must never return an existing row from the conflict path.

#### Exact dependency-call order and error precedence

The use case must execute this sequence:

1. Validate and normalize `command.claims`. On failure, throw `IdentityClaimsValidationError`; call no dependency, including no clock or ID generator.
2. Call `identityDirectory.findUsersByIdentity` once with the exact validated provider/subject strings.
3. If lookup throws, propagate the already-safe typed error; do not call clock or ID generator.
4. If lookup returns anything other than zero or one safe immutable `UserSnapshot`, throw `IdentityPersistenceError('lookup')`; do not call clock or ID generator.
5. If one user is returned, verify its immutable snapshot shape and exact provider/subject match. An active user returns a frozen principal. A disabled or deletion-pending user throws `IdentityUnavailableError`. No clock or ID generator call occurs. Any other status, malformed snapshot, or mismatched identity throws `IdentityPersistenceError('lookup')`.
6. If zero users are returned, call `deps.clock.now()` exactly once. An invalid/non-`Date`/invalid-instant result throws the existing safe validation error for `clock`; do not call the ID generator or persistence again.
7. Convert the clock value immediately with the existing `dateToIsoTimestamp` behavior. Call `deps.idGenerator.generateUserId()` exactly once. Build one frozen active `UserSnapshot` with the generated ID, normalized metadata, version `1`, `createdAt === updatedAt`, and no caller-owned mutable value.
8. Call `identityDirectory.insertUserIfAbsent({ user })` once. If it returns a safe inserted snapshot, require exact ID, provider, subject, normalized metadata, `active` status, version `1`, and matching canonical timestamps. A mismatch, inactive status, malformed snapshot, or mutable result throws `IdentityPersistenceError('insert')`. A valid result returns a frozen principal.
9. If insert returns `null`, call `findUsersByIdentity` exactly once for losing-race recovery. More than one or malformed result throws `IdentityPersistenceError('recovery')`. One active exact-match user returns a frozen principal. One disabled/deletion-pending exact-match user throws `IdentityUnavailableError`. Zero users throws `IdentityProvisioningRaceError`. A mismatched identity or invalid status throws `IdentityPersistenceError('recovery')`.

No other dependency calls, retries, status changes, reactivation, profile updates, email linking, or account merging are permitted. The application must not inspect PostgreSQL errors or constraint names.

### 3. Exact PostgreSQL contract

Extend the existing `PostgresTenancyAdapter` or a same-package `PostgresIdentityAdapter`; do not create a generic repository. The public infrastructure export must implement `UserIdentityDirectoryPort` and may continue implementing the existing TASK-004 ports.

#### Lookup SQL

`findUsersByIdentity` must use one parameterized query with this behavior and no email predicate:

```sql
SELECT id, identity_provider, identity_subject, email, display_name,
       status, created_at, updated_at, version
FROM users
WHERE identity_provider = $1
  AND identity_subject = $2
LIMIT 2
```

Parameters are exactly `[key.identityProvider, key.identitySubject]`. `LIMIT 2` is required so a hostile or drifted database cannot be silently treated as a unique result. Return rows mapped independently through the existing safe user-row mapper. Zero rows becomes `[]`; one row becomes `[snapshot]`; two rows are returned to the application for deterministic malformed-result rejection.

#### Insert SQL

`insertUserIfAbsent` must use one parameterized statement with this exact conflict behavior:

```sql
INSERT INTO users (
  id, identity_provider, identity_subject, email, display_name,
  status, created_at, updated_at, version
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (identity_provider, identity_subject) DO NOTHING
RETURNING id, identity_provider, identity_subject, email, display_name,
          status, created_at, updated_at, version
```

Parameters are exactly `[user.id, user.identityProvider, user.identitySubject, user.email, user.displayName, user.status, user.createdAt, user.updatedAt, user.version]`. The application-created user always supplies `active`, one canonical timestamp twice, and `1`.

The adapter must map zero rows to `null`, one row through the safe user-row mapper, and more than one returned row to `DatabaseError` before returning. It must not inspect, stringify, classify, or log raw PostgreSQL constraint errors. `ON CONFLICT DO NOTHING` is the only race handling. No `ON CONFLICT` target may use email.

#### Transaction and concurrency requirements

The lookup is a read. The insert is one atomic PostgreSQL statement and does not require a check-then-insert transaction. Do not place a pre-check and insert in separate application-controlled transactions and do not hold a transaction across a provider call. If the existing database implementation wraps the single insert in its transaction helper, it must use only the existing `Database.withTransaction` contract and must not add a new transaction abstraction or perform extra SQL.

After an insert returns zero rows, the application performs exactly one fresh lookup using the exact same provider/subject parameters. Active recovery succeeds; inactive recovery fails closed; missing recovery is the typed race error. A database error from lookup, insert, or recovery wins over any race interpretation and is propagated as the existing safe database error. No retry loop is allowed.

### 4. Exact package and export boundaries

Required public exports are:

- `@affiliate-content-os/domain`: `VerifiedIdentityClaims`, `AuthenticationSource`, `ApplicationPrincipal`, and identity validation helpers/types; existing exports remain compatible. `IdentityLookupKey` and all four application errors are not domain exports.
- `@affiliate-content-os/application`: `resolveVerifiedIdentity`, `ResolveVerifiedIdentityCommand`, `ResolveVerifiedIdentityDependencies`, `IdentityLookupKey`, `UserIdentityDirectoryPort`, and the four exact identity error classes; existing exports remain compatible.
- `@affiliate-content-os/infrastructure/tenancy` (the existing public subpath): the identity-capable adapter/factory and explicit user-row mapper types; no raw `pg` type or SQL result type is exported.

Expected dependency direction remains:

```text
packages/domain <- packages/application <- packages/infrastructure <- apps/api|apps/worker
```

Domain may import only itself. Application may import only domain among internal packages. Infrastructure may import application/domain and existing database/config boundaries. Web may import none of domain, application, infrastructure. No package may import a provider SDK, HTTP framework, session library, `pg` outside infrastructure, or another module’s private file. Do not wire this task into `apps/api`, `apps/worker`, or `apps/web`; no authenticated principal exists in runtime composition until a later approved session task.

### 5. Exact security contract

- Only a future adapter that has completed OIDC issuer/signature/audience/nonce/time and provider-specific claim validation may construct the plain `VerifiedIdentityClaims` DTO. That verification is outside this task and must be documented by the later adapter task.
- This boundary accepts only the exact plain-object DTO shape above. Raw tokens, JWT strings/objects, authorization codes, HTTP requests, cookies, session objects, provider SDK objects, and client form data are rejected as claims-validation failures.
- Provider and subject are exact opaque identity keys. Surrounding whitespace is rejected; no canonicalization or email fallback is allowed.
- Identity metadata is never included in errors, logs, metrics labels, exception causes, serialized diagnostics, or SQL error messages. Fixed safe error messages are required.
- Database errors use the existing `DatabaseError` sanitization and trusted-error behavior. No raw driver value, constraint name, SQL, bind value, row object, stack trace, or database URL may escape.
- Validation and mapping must be hostile-value safe: getters, setters, proxies, symbols, bigint, functions, cyclic values, invalid dates, invalid timestamp strings, invalid IDs, invalid statuses, invalid versions, extra row fields, and multiple rows must fail closed without invoking arbitrary user code where avoidable.
- Mapped snapshots and principals are frozen and contain only primitive strings, booleans, numbers, nulls, and frozen nested source objects. Do not return driver-owned `Date` objects or mutable row references.
- No new logs, telemetry attributes, serialization hooks, secrets, test backdoors, hard-coded user, environment reads, ambient context, or authentication bypass may be added.

## Expected files and file-level implementation blueprint

Only focused changes to the following files/modules are expected. If a different file is required, report it before coding and explain why.

| File/module                                                                                        | Purpose                                                                                                                   | Permitted dependencies                                                           | Required exports                                                                                                          | Required tests                                                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/domain/src/identity.ts`                                                                  | Define exact claims, source, and principal types, immutable construction/guards, and safe identity validation primitives. | Domain-local `errors.ts`, existing `types.ts`, existing timestamp/ID types only. | `VerifiedIdentityClaims`, `AuthenticationSource`, `ApplicationPrincipal`, and named validation helpers.                   | Plain-object/accessor/proxy/extra-key tests; whitespace and metadata matrix; immutable object tests. |
| `packages/domain/src/errors.ts`                                                                    | Hold only domain validation errors if identity validation is domain-owned.                                                | No internal package or framework.                                                | Existing error plus any explicitly domain-scoped identity validation error; no application error leakage.                 | Error field/code and non-disclosure tests.                                                           |
| `packages/domain/src/index.ts`                                                                     | Re-export the approved identity domain surface.                                                                           | Domain-local modules only.                                                       | Exact domain exports above; no infrastructure/application exports.                                                        | Public-import and boundary tests.                                                                    |
| `packages/domain/test/identity.unit.test.ts`                                                       | Test domain-only runtime contracts and immutable values.                                                                  | Vitest and domain public exports.                                                | None.                                                                                                                     | Complete domain validation/immutability matrix.                                                      |
| `packages/application/src/ports.ts`                                                                | Add `IdentityLookupKey` and `UserIdentityDirectoryPort` exact signatures beside existing narrow ports.                    | `@affiliate-content-os/domain` only.                                             | Exact port interfaces; no database/HTTP/provider types.                                                                   | Compile-time/public contract coverage through use-case tests.                                        |
| `packages/application/src/errors.ts`                                                               | Add four exact safe identity error classes.                                                                               | Existing `ApplicationError` only.                                                | `IdentityClaimsValidationError`, `IdentityUnavailableError`, `IdentityPersistenceError`, `IdentityProvisioningRaceError`. | Public field, fixed-message, and metadata non-disclosure tests.                                      |
| `packages/application/src/resolve-verified-identity.ts`                                            | Implement the exact validation, lookup, provision, and one-recovery sequence.                                             | `@affiliate-content-os/domain`, local ports/errors only.                         | `resolveVerifiedIdentity`, command/dependency types if not in ports.                                                      | Full dependency order, precedence, status, race, malformed-result, clock/ID matrix.                  |
| `packages/application/src/index.ts`                                                                | Re-export the application identity surface.                                                                               | Application-local modules and existing domain type-only exports.                 | Exact use case, ports, command/dependency types, and errors.                                                              | Public-import and forbidden-dependency tests.                                                        |
| `packages/application/test/resolve-verified-identity.unit.test.ts`                                 | Independently verify orchestration with hostile fakes.                                                                    | Vitest, application/domain public exports only.                                  | None.                                                                                                                     | Complete independent test matrix below; assert calls and parameters exactly.                         |
| `packages/infrastructure/src/tenancy/mappers.ts`                                                   | Reuse/extend explicit `RawUserRow` mapping with safe timestamp/status/version/ID checks.                                  | Domain and existing safe `DatabaseError` only.                                   | Existing mapper exports plus no provider/driver types.                                                                    | Valid row, invalid row, hostile row, timestamp, multiple-row mapping tests.                          |
| `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`                                  | Implement exact parameterized lookup and insert-if-absent SQL using existing database boundary.                           | Application ports, domain types, existing `Database` and safe database errors.   | Adapter methods and factory through existing tenancy subpath only.                                                        | SQL text/parameter unit tests; error/result mapping tests.                                           |
| `packages/infrastructure/src/tenancy/index.ts`                                                     | Expose the identity-capable adapter through the existing public subpath.                                                  | Local tenancy module only.                                                       | Adapter/factory and explicit safe mapper types only.                                                                      | Public-boundary/deep-import rejection tests.                                                         |
| `packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts` or focused new identity unit test | Verify exact SQL, zero-row semantics, mapper and safe failures with a fake `Database`.                                    | Vitest, infrastructure public/local test helpers, no production bypass.          | None.                                                                                                                     | Query parameter and hostile-driver matrix.                                                           |
| `packages/infrastructure/test/integration/identity-adapter.integration.test.ts`                    | Prove real PostgreSQL lookup, creation, uniqueness, and concurrent losing-race recovery.                                  | Existing guarded integration harness and public adapter.                         | None.                                                                                                                     | Real database matrix below.                                                                          |
| `test/boundaries.test.ts` and focused fixtures if required                                         | Preserve dependency direction and web isolation.                                                                          | Existing boundary test framework.                                                | None.                                                                                                                     | Allowed/rejected import matrix.                                                                      |
| `package.json`, workspace manifests, lockfile, or TS configs only if required                      | Make substantive exports buildable without changing runtime wiring.                                                       | Existing toolchain only.                                                         | No new provider/session dependency.                                                                                       | Frozen install, typecheck, build, boundary, and clean-checkout checks.                               |

No migration, API file, frontend file, app composition file, provider file, session file, documentation file, generated artifact, or security exception is expected.

## Database changes

No database migration. Use only the existing `users` table and the existing `users_identity_provider_subject_unique` constraint from `0002_identity_tenancy.sql`. The relation set remains exactly `schema_migrations`, `users`, `workspaces`, and `workspace_memberships` after migrations.

## API changes

None. Do not add `/auth/*`, `/api/v1/me`, logout, cookies, CSRF/CORS behavior, OpenAPI, Problem Details mapping, test routes, or browser/session contracts.

## Frontend changes

None. Do not add login, callback, onboarding, workspace selection, account linking, identity display, or browser authentication behavior.

## Backend changes

Only the domain/application/infrastructure contracts and tests in this task may change. API, worker, and web startup/shutdown/liveness/database wiring must remain byte-for-byte behaviorally compatible. The use case is not registered in any runtime composition root.

## Complete independent test matrix

### Domain and application unit matrix

For every invalid input below, assert the exact safe error class/code/field and zero calls to lookup, clock, ID generation, and persistence:

- claims `null`, `undefined`, primitive, array, function, symbol, bigint, cyclic object, object with wrong prototype, extra own key, missing required key, accessor property, throwing getter, throwing proxy trap, or provider SDK-like object;
- provider/subject non-string, empty, whitespace-only, leading whitespace, trailing whitespace, both surrounding whitespace, and invalid descriptor values;
- optional email/display name number, boolean, object, array, symbol, bigint, function, accessor, throwing getter, and non-null invalid values;
- accepted `undefined`/`null` optional values, trim-only metadata normalization, and preservation of case/internal whitespace;
- provider/subject case difference, internal whitespace, Unicode, and same subject across different providers proving exact-key behavior.

Then assert:

- active existing user returns a frozen principal with `kind: 'verified_oidc'` and exact provider;
- disabled and deletion-pending existing users both throw the same `IdentityUnavailableError` with no status/user/identity fields;
- existing-user lookup makes no clock or ID calls;
- zero lookup calls clock once, ID once, then inserts one active version-1 user with one canonical timestamp used for both timestamp fields;
- invalid clock fails before ID generation and insert;
- ID-generator failure is propagated safely and insert is not called;
- inserted result with exact expected fields succeeds;
- inserted result with wrong ID, identity, metadata, status, version, timestamps, mutable object, invalid snapshot, multiple impossible rows, or driver-owned mutable data throws `IdentityPersistenceError('insert')`;
- insert `null` performs exactly one recovery lookup and never retries insert;
- active exact recovery succeeds without a second clock/ID call;
- inactive exact recovery throws `IdentityUnavailableError`;
- zero recovery throws `IdentityProvisioningRaceError` with `retryable === true`;
- multiple, malformed, mismatched, or invalid-status recovery results throw `IdentityPersistenceError('recovery')`;
- lookup multiple/malformed/mismatched results throw `IdentityPersistenceError('lookup')` before clock/ID;
- lookup, insert, recovery, clock, and ID failures preserve safe error identity and never expose input values.

Mutation tests must attempt to change the returned user, principal, nested source, and timestamp values and prove the result and subsequent values are unchanged. Test both ordinary objects and hostile values with custom inspection/stringification hooks.

### Infrastructure unit matrix

Assert exact SQL semantics and parameter arrays:

- lookup has only provider/subject predicates, `LIMIT 2`, and exact two parameters;
- insert has the exact `(identity_provider, identity_subject)` conflict target, `DO NOTHING RETURNING`, all ten user columns, and exact parameter order;
- no query contains email lookup, interpolated values, raw identity strings, or provider-specific SQL;
- zero insert rows map to `null`; one maps through `mapUserRow`; more than one becomes safe `DatabaseError`;
- malformed IDs, statuses, versions, timestamps, row values, getters, proxies, and hostile database results fail closed;
- wrong constraints, syntax errors, connection errors, transaction errors, and arbitrary hostile driver errors remain safe `DatabaseError` values; and
- no raw driver error, SQL, parameters, row, stack, or identity metadata is logged, serialized, or returned.

### Real PostgreSQL integration matrix

Using the existing guarded isolated test database and parameterized SQL:

- create a unique active user and resolve it by exact provider/subject;
- provision a missing identity and verify exactly one row, active status, version `1`, canonical equal timestamps, and trimmed-only metadata;
- resolve the same provider/subject with a different email and prove the existing row is returned unchanged;
- use the same subject with two providers and prove two distinct users;
- use two concurrent first provisions for one provider/subject and prove one row, one successful insert path, one losing-race recovery path, and no duplicate;
- prove duplicate identity is handled only by `ON CONFLICT (identity_provider, identity_subject) DO NOTHING RETURNING` and not by email;
- seed disabled and deletion-pending users and prove both fail closed without reactivation or mutation;
- exercise malformed-result behavior through unit fakes because real PostgreSQL cannot produce duplicate unique rows without schema corruption;
- rerun migrations and prove no new relation/table is introduced; and
- clean all test data through the existing guarded lifecycle.

### Security, boundary, runtime, and clean-checkout matrix

- adversarial errors, getters, proxies, rows, timestamps, constraint-like values, and `toJSON`/inspect hooks prove non-disclosure;
- dependency-cruiser tests prove domain/application/infrastructure direction, no web-to-core imports, no deep/private imports, and no provider/session SDK;
- existing API/worker startup, shutdown, liveness, config, migration, database sanitization, transaction, and TASK-004 tenancy tests remain passing;
- format, lint, boundary lint, typecheck, unit test, build, migration validation, integration test, production dependency audit, infrastructure pin, and container-security gates pass with actual results recorded;
- exact clean-checkout verification starts in a temporary directory without `.env`, `node_modules`, build output, or an existing integration database, installs frozen dependencies, runs applicable checks, and leaves the temporary checkout clean; and
- `git diff --check` and `git status --short` are clean apart from the intended task specification before handoff.

## Acceptance criteria

1. The exact domain, application, and infrastructure contracts in this specification are implemented without provider/session architecture being invented during coding.
2. Invalid runtime claims fail before every dependency call and cannot execute getters, provider SDK behavior, or token logic.
3. Identity lookup uses only exact provider/subject strings; surrounding whitespace is rejected and no identity-key normalization occurs.
4. Email/display-name handling is trim-only metadata handling; email is never used for lookup, uniqueness, recovery, authorization, or linking.
5. Active users resolve successfully without clock/ID calls; disabled and deletion-pending users fail with the same non-disclosing typed error.
6. New users are created exactly once with active status, version `1`, generated UUIDv7 ID, canonical equal timestamps, and immutable results.
7. PostgreSQL uses the exact parameterized `ON CONFLICT (identity_provider, identity_subject) DO NOTHING RETURNING ...` contract and one fresh recovery lookup after zero rows.
8. Concurrent first provisioning cannot duplicate a user; missing recovery is a safe retryable race error; database failures take precedence over race classification.
9. Malformed, multiple, mismatched, mutable, or hostile persistence results fail closed with safe typed errors.
10. No raw identity metadata, tokens, SQL, bind values, provider errors, stack traces, or credentials reach logs, errors, serialization, or public APIs.
11. Existing modular-monolith dependency direction, database boundary, lifecycle behavior, migration relation set, and TASK-004 tests remain intact.
12. The independent unit, integration, security, runtime, boundary, formatting, build, audit, container, and clean-checkout test matrix passes with actual results reported.
13. No API, frontend, session, OIDC provider, social, audit, product, AI, content, scheduling, publishing, analytics, migration, or unrelated functionality is added.

## Out of scope

- Managed OIDC vendor, issuer/client configuration, supported sign-in methods, hosted login, authorization-code flow, PKCE, discovery, JWKS, token parsing, signature/audience/nonce/time verification, claim mapping from provider SDKs, callbacks, webhooks, or redirect handling.
- Application sessions, cookies, logout, CSRF, CORS, `/auth/*`, `/api/v1/me`, HTTP routes, OpenAPI, Problem Details mapping, browser authentication, or authenticated SSR.
- Email verification, profile editing, email changes, account linking/merging, reactivation, deletion, invitations, memberships, roles, authorization policy, workspace settings, audit events, or data retention policy.
- Threads/TikTok OAuth, social credentials, products, facts, media, AI, content, compliance, approval, scheduling, publishing, analytics, recommendations, queues, or learning workflows.
- New migrations/tables, seed data, outbox, idempotency, Redis, observability, rate limits, generic repositories, ORM/query builders, DI containers, CQRS, event sourcing, microservices, Kafka, Kubernetes, or provider SDK dependencies.
- Changes to `docs/`, decision records, production configuration, secrets, branches, commits, pushes, pull requests, or unrelated refactors.

## Implementation handoff requirements

This specification has been approved by the Product Owner. Antigravity may implement it only within the exact scope, contracts, and constraints defined here and must not begin broader authentication, identity-provider, session, API, frontend, or product work.

Before implementation, Antigravity must read `AGENTS.md`, this task, all relevant files under `/docs`, the complete TASK-003 and TASK-004 specifications and remediations, and the clean `origin/main` implementation. Antigravity must report any deviation before coding; it must not invent provider, session, token, transaction, error, or package architecture.

Before declaring implementation ready for Codex review, provide:

- exact public exports and signatures, with generated declaration/build evidence;
- the complete dependency-call order and error-precedence matrix;
- exact SQL text/parameters and proof of the conflict target/recovery sequence;
- evidence that raw tokens, JWTs, authorization codes, requests, provider SDK objects, and identity metadata cannot enter or escape the boundary;
- unit, adversarial, real-PostgreSQL concurrency, boundary, runtime, security-gate, and clean-checkout results with actual commands and exit statuses;
- every created, modified, and deleted file, final local/remote SHA, and clean working-tree status; and
- every skipped check, failure, limitation, or deviation.

Codex will review the user requirement, this specification, approved documentation, actual implementation diff, contracts, SQL, security behavior, database evidence, tests, and clean-checkout evidence before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
