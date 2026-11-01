# TASK-005 Remediation 02 - Proxy-Safe Claims and Genuine Persistence Arrays

Status: Proposed for Product Owner approval

Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-005`, approved `TASK-005-REMEDIATION-01`, and reviewed commit `4326de7fd2f20b1f461d0baaed69ffd2f429741e`

## Objective

Close the two findings from the latest Codex adversarial re-review of TASK-005 Pull Request #5:

1. reject proxy and revoked-proxy claims before any proxy-observable operation or hostile hook can execute; and
2. require initial-lookup and losing-race recovery results to be genuine JavaScript arrays rather than objects that merely inherit from `Array.prototype`.

This remediation is limited to those two defects and their focused adversarial, call-order, and non-disclosure tests. It does not redesign identity semantics, public contracts, persistence snapshot validation, clock validation, row mapping, SQL, schema, concurrency behavior, or package boundaries.

## Context

PR #5 targets `main` from branch `agy/task-005-verified-identity`. Codex reviewed commit `4326de7fd2f20b1f461d0baaed69ffd2f429741e` after Remediation 01. At review time:

- the local branch, remote branch, and PR head all matched the reviewed SHA;
- the worktree was clean;
- the PR base was `main` at `f8a39fe9662f7ab97ff06324a61aae485dcf0cf3`;
- all exact-SHA GitHub checks succeeded;
- the full unit, integration, build, audit, pin, Trivy, runtime-smoke, and clean-checkout gates passed; and
- Remediation 01 correctly closed the reviewed persistence-snapshot, user-row mapping, clock, and whitespace findings except for the genuine-array identity gap specified below.

The re-review returned `STATUS: CHANGES REQUIRED` with one HIGH and one MEDIUM finding.

### Finding 1 - claims proxy traps execute before rejection

`packages/domain/src/identity.ts` currently calls `Array.isArray`, `Object.getPrototypeOf`, and `Reflect.ownKeys` without first rejecting proxy-backed claims through the trusted runtime proxy detector. A proxy `getPrototypeOf` trap executed once during the independent reproduction. The application returned a fixed `IdentityClaimsValidationError` and called no dependency, but executing hostile code violates the claims-boundary contract.

### Finding 2 - prototype-spoofed objects pass as persistence arrays

`packages/application/src/resolve-verified-identity.ts` currently rejects proxies and requires `Object.getPrototypeOf(result) === Array.prototype`, but it does not require `Array.isArray(result) === true`. An object created with `Object.create(Array.prototype)` and copied `length`/index descriptors was accepted as an existing-user lookup result and produced a principal even though `Array.isArray(result)` was false.

The governing sources remain:

- `AGENTS.md`;
- approved `tasks/TASK-005.md`;
- approved `tasks/TASK-005-REMEDIATION-01.md`;
- relevant architecture, database, API, product, security, and decision documentation;
- inherited TASK-003/TASK-004 database, transaction, sanitization, tenancy, and verification guarantees;
- the complete latest Codex findings and exact reproductions; and
- the actual `origin/main...HEAD` implementation and tests.

TASK-005 and Remediation 01 remain binding except where this remediation narrows the exact proxy-detection order and genuine-array proof. Provider and subject remain exact opaque keys; email and display name remain trim-only metadata; no email lookup or recovery is permitted; and no provider, session, API, frontend, schema, or runtime composition is selected here.

## Required implementation

### 1. Reject proxy-backed claims before every observable operation

Keep the existing domain/application dependency direction. The domain package must not import `ApplicationError` or `IdentityClaimsValidationError`. The application-facing `resolveVerifiedIdentity()` boundary remains responsible for translating every claims failure to a newly constructed fixed-message `IdentityClaimsValidationError`.

#### 1.1 Exact proxy-detection order

In `inspectClaimsObject()` or a narrowly scoped domain-local helper used by it, perform this sequence:

1. enter one fail-closed claims-inspection boundary;
2. reject non-object and null values without conversion;
3. call the trusted Node runtime proxy detector, `util.types.isProxy`, without first invoking any proxy-observable operation;
4. treat a detector exception as an invalid claims value;
5. reject proxy and revoked-proxy values immediately; and
6. only after proxy rejection, perform `Array.isArray`, `Object.getPrototypeOf`, `Reflect.ownKeys`, and own-property-descriptor inspection.

Before proxy rejection, the implementation must not call or perform:

- `Array.isArray`;
- `Object.getPrototypeOf`;
- `Reflect.ownKeys`;
- `Object.getOwnPropertyDescriptor`;
- direct or computed property access;
- `in`, iteration, destructuring, spread, enumeration, freezing, cloning, or serialization;
- `String`, `Number`, `Boolean`, template interpolation, concatenation, or implicit conversion;
- `toString`, `valueOf`, `toJSON`, an iterator, or custom inspection; or
- logging or attachment of the value.

The narrow use of `node:util` for `util.types.isProxy` is explicitly authorized in the domain identity validator for this remediation. It must not introduce any provider, HTTP, persistence, filesystem, environment, process, timer, or other Node-specific behavior into domain. Do not add a generic proxy-validation framework or a new public dependency.

#### 1.2 Fail-closed validation and error routing

All proxy detection, prototype/key/descriptor inspection, and claims validation must remain within exception-safe boundaries that do not inspect the caught value.

Required routing is:

- domain validation may continue using the existing `DomainValidationError` contract internally and for the existing domain public helper;
- the domain package must not import application errors;
- `validateClaimsSafe()` must catch every domain or unexpected claims-validation failure without inspecting, stringifying, logging, coercing, attaching, or rethrowing the caught value; and
- `resolveVerifiedIdentity()` must expose only a fresh `IdentityClaimsValidationError` with message exactly `Invalid identity claims` and an approved field category.

For proxy/revoked-proxy root claims, the outward field is exactly `claims`. The error must contain no raw proxy, target, handler, sentinel, provider, subject, email, display name, cause, hook result, stack addition, symbol, or unexpected property.

Invalid claims must cause zero calls to:

- `identityDirectory.findUsersByIdentity`;
- `clock.now`;
- `idGenerator.generateUserId`;
- `identityDirectory.insertUserIfAbsent`; and
- any recovery lookup.

No principal, authentication source, user snapshot, partial user, or dependency-owned value may be created or returned.

#### 1.3 Required proxy and non-disclosure coverage

Add tests for ordinary and revoked proxies whose handlers contain throwing or sentinel-bearing traps for:

- `get`;
- `getPrototypeOf`;
- `ownKeys`;
- `getOwnPropertyDescriptor`;
- `has`; and
- `set`.

Also place sentinel-bearing `toString`, `valueOf`, `toJSON`, iterator, and Node custom-inspection hooks on relevant targets/prototypes where they can prove that validation does not invoke them.

Every proxy test must assert:

- the total trap/hook count is exactly zero;
- the exact error class, code, field, and fixed message;
- zero dependency calls;
- no returned principal; and
- no sentinel through direct fields, own/inherited keys, `JSON.stringify`, `String`, `util.inspect` with custom inspection enabled and disabled, captured logger arguments/rendered logs, error stack, thrown output, child-process stdout, or child-process stderr.

Do not make a proxy test pass by allowing a trap to throw and then sanitizing that thrown value. Detection must precede every trap-capable operation.

### 2. Require genuine persistence-result arrays in the exact safe order

Update only the internal persistence-array validator used for initial lookup and losing-race recovery. Do not change the port signature or introduce a generic collection validator.

#### 2.1 Exact validation sequence

`validatePersistenceArray(result, operation)` must execute this exact order inside one operation-specific safe boundary:

1. reject proxy and revoked-proxy values through the existing trusted runtime detector;
2. require `Array.isArray(result) === true`;
3. require `Object.getPrototypeOf(result) === Array.prototype`;
4. obtain the own `length` data-property descriptor;
5. validate the permitted length and descriptor shape;
6. inspect the exact own-key set;
7. inspect each required index through an own data-property descriptor; and
8. capture index descriptor values without direct index access or iteration.

`Array.isArray` and every later inspection step must remain inside the `try/catch` that converts all inspection failures to a fresh `IdentityPersistenceError(operation)`. The catch path must not inspect, stringify, log, serialize, coerce, attach, or rethrow the caught value.

Do not replace the sequence with prototype-only checks, duck typing, `instanceof Array`, iteration, spread, destructuring, JSON cloning, structured cloning, or a schema library.

#### 2.2 Required rejected shapes

Reject at least:

- `Object.create(Array.prototype)`;
- an ordinary object with `length` and numeric keys;
- zero-element and one-element prototype-spoofed objects;
- objects with copied array `length` and index descriptors;
- other array-like objects and iterables;
- array subclasses whose prototype is not exactly `Array.prototype`;
- proxy and revoked-proxy arrays before any trap executes;
- arrays with symbol keys or unexpected string keys;
- sparse arrays;
- arrays with accessor-backed indexes;
- arrays with non-canonical or missing indexes; and
- any other non-array result, regardless of how closely its descriptors resemble an array.

Preserve the completed Remediation 01 descriptor rules for genuine arrays, including exact length semantics, zero-or-one success-path cardinality, closed keys, own data-property indexes, no iteration, and no direct `result.length` or `result[index]` access.

#### 2.3 Initial lookup behavior

For every invalid initial lookup result:

- throw a newly constructed `IdentityPersistenceError('lookup')`;
- use the existing fixed default message;
- make exactly one initial `findUsersByIdentity` call;
- call `clock.now` zero times;
- call `generateUserId` zero times;
- call `insertUserIfAbsent` zero times;
- perform zero recovery lookups or retries; and
- return no principal or partial result.

No raw collection value, descriptor value, identity metadata, trap error, or sentinel may escape through an error or output surface.

#### 2.4 Losing-race recovery behavior

For every invalid recovery result:

- throw a newly constructed `IdentityPersistenceError('recovery')`;
- use the existing fixed default message;
- make exactly one initial lookup and exactly one recovery lookup, for exactly two lookup calls total;
- call `clock.now` exactly once;
- call `generateUserId` exactly once;
- call `insertUserIfAbsent` exactly once, returning `null` for the arranged losing race;
- perform no additional lookup, retry, insert, clock, or ID call; and
- return no principal or partial result.

The same validated provider/subject key must be used for the initial and recovery lookup. Database rejections must retain their existing precedence and must not be reclassified as persistence-shape or race errors.

### 3. Preserve all completed TASK-005 and Remediation 01 behavior

Retain without redesign:

- exact provider/subject preservation and lookup;
- trim-only email/display-name metadata behavior;
- fixed claims, unavailable, persistence, and race error semantics;
- proxy-safe persistence snapshot validation and fresh frozen canonical copies;
- proxy-safe, non-coercing `mapUserRow()` behavior;
- safe clock handling through trusted Date intrinsics;
- exact clock, ID, insert, and bounded one-recovery call order;
- active, disabled, and deletion-pending behavior;
- database-error precedence over race interpretation;
- exact lookup and insert SQL, parameters, `LIMIT 2`, and provider/subject conflict target;
- immutable principals, authentication sources, and snapshots;
- concurrent provisioning of exactly one database row;
- public package exports and modular-monolith dependency direction;
- no runtime wiring in API, worker, or web;
- the five corrected plan files and clean `git diff --check`; and
- every inherited TASK-003/TASK-004 database, transaction, sanitization, migration, tenancy, lifecycle, and verification guarantee.

## Expected files

Expected implementation changes are limited to:

- `tasks/TASK-005-REMEDIATION-02.md`;
- `packages/domain/src/identity.ts`;
- `packages/domain/test/identity.unit.test.ts`;
- `packages/application/src/resolve-verified-identity.ts`;
- `packages/application/test/resolve-verified-identity.unit.test.ts`; and
- one focused claims/persistence child-process adversarial test file only if required to keep non-disclosure coverage readable and isolated.

No manifest, lockfile, dependency, package export, TypeScript configuration, database-error, infrastructure mapper, PostgreSQL adapter, migration, CI, plan, report, API, worker, or frontend change is expected. The existing Node type dependency is sufficient for the narrowly authorized trusted proxy detector.

If implementation proves another file or public contract must change, stop and report the exact blocker to Codex before editing. Do not broaden the remediation independently.

## Database changes

None.

- Do not add or edit migrations, tables, columns, constraints, indexes, extensions, seed data, roles, or grants.
- Preserve the exact TASK-004 schema and TASK-005 identity SQL.

## API changes

None.

- Do not add or change routes, payloads, OpenAPI, Problem Details, status codes, authentication, authorization, sessions, cookies, CORS, or CSRF.

## Frontend changes

None.

- Do not modify `apps/web`, pages, components, styles, forms, client authentication, or browser bundles.

## Backend changes

Only the domain claims inspection order, the application persistence-array genuine-array check, and their focused tests may change.

Do not change row mapping, clock conversion, persistence snapshot validation, identity error public fields, SQL, adapters, runtime composition, startup, shutdown, liveness, or database lifecycle behavior.

## Security requirements

- Treat root claims, persistence results, caught values, proxy targets, proxy handlers, and hook-bearing objects as hostile.
- Use only the trusted runtime proxy detector before any proxy-observable operation.
- A proxy must be rejected because it is detected, not because one of its traps throws.
- Never execute hostile getters, setters, traps, iterators, coercion hooks, serialization hooks, inspection hooks, `toString`, `valueOf`, or `toJSON`.
- Never inspect, stringify, coerce, log, serialize, attach, retain, or rethrow a caught hostile value.
- Use closed allowlists for accepted prototypes, keys, descriptors, primitive field types, and array cardinality.
- Application-facing claims failures expose only a fresh fixed-message `IdentityClaimsValidationError`.
- Persistence-array failures expose only a fresh fixed-message `IdentityPersistenceError` for the exact operation.
- Never expose raw identity metadata, proxy sentinels, stacks, causes, rows, SQL, bind values, URLs, credentials, or tokens.
- Child-process tests must assert sentinel absence without printing the raw sentinel on a passing path.
- Do not add a global unhandled-rejection handler, monkey patch, ambient registry, debug export, test-only production bypass, or relaxed lint/security rule.
- Do not weaken Remediation 01 proxy, snapshot, row, clock, or non-disclosure guarantees.

## Edge cases

- Proxy claims with each individual throwing trap and with all traps installed together.
- Revoked proxy claims whose target would otherwise be a valid claims object.
- Proxy targets with null or ordinary prototypes.
- Proxy targets and prototypes containing sentinel-bearing coercion, serialization, iterator, and inspection hooks.
- Proxy detector failure, if the runtime primitive unexpectedly throws.
- Ordinary valid claims with `Object.prototype` and null prototype remain accepted.
- Accessor-backed ordinary claims remain rejected without getter execution.
- `Object.create(Array.prototype)` with `length: 0`.
- `Object.create(Array.prototype)` with `length: 1` and index `0` holding a valid frozen snapshot.
- Ordinary objects with copied array descriptors but `Object.prototype` or null prototype.
- Array-like objects with iterators, typed arrays, arguments objects, and provider/SDK collection shapes.
- Genuine array subclass, sparse array, accessor index, symbol key, extra key, missing index, and cardinality greater than one.
- Invalid fake arrays during initial lookup and during losing-race recovery.
- A valid genuine empty array still enters provisioning.
- A valid genuine one-element array still resolves an active user or applies inactive-user behavior.
- Database rejection during initial lookup, insert, or recovery retains existing safe-error precedence.

## Acceptance criteria

1. Claims proxy detection occurs before `Array.isArray`, prototype inspection, key enumeration, descriptor access, property reads, or conversion.
2. Proxy and revoked-proxy claims execute zero traps and hooks and expose only a fresh fixed `IdentityClaimsValidationError` with field `claims` and message `Invalid identity claims`.
3. Invalid claims invoke zero lookup, clock, ID, insert, and recovery dependencies and return no principal.
4. Claims sentinels are absent from direct fields, keys, JSON, string conversion, inspection, logs, stack, thrown output, stdout, and stderr.
5. The domain/application dependency direction remains intact; domain does not import application errors, and the narrow trusted proxy detector introduces no broader runtime coupling.
6. `validatePersistenceArray()` rejects proxies first, then requires `Array.isArray(result) === true`, then requires exact `Array.prototype`, before descriptor inspection.
7. Prototype-spoofed, copied-descriptor, and ordinary array-like objects are rejected even when they contain a valid frozen snapshot.
8. Invalid initial lookup results produce exactly `IdentityPersistenceError('lookup')`, one lookup, and zero clock, ID, insert, recovery, or principal results.
9. Invalid recovery results produce exactly `IdentityPersistenceError('recovery')`, two total lookups, one clock call, one ID call, one insert call, no retry/additional call, and no principal.
10. Proxy arrays, array subclasses, sparse/accessor arrays, symbol/extra-key arrays, and all completed Remediation 01 invalid cases remain rejected safely.
11. Valid ordinary genuine arrays retain all approved existing-user, provisioning, inactive-user, and losing-race behavior.
12. Database errors are not reclassified, exact identity semantics and SQL remain unchanged, and concurrent provisioning still creates exactly one row.
13. All TASK-005, Remediation 01, TASK-004, and TASK-003 unit, integration, migration, boundary, runtime, audit, pin, Trivy, and clean-checkout gates pass.
14. No database, API, frontend, provider, session, runtime-composition, dependency, export, or unrelated documentation scope is introduced.
15. Final local HEAD, remote branch head, and PR #5 head match the implementation SHA; both the reviewed worktree and temporary clean checkout are clean.

## Test plan

### Domain claims tests

- Table-test proxy and revoked-proxy root claims with throwing `get`, `getPrototypeOf`, `ownKeys`, `getOwnPropertyDescriptor`, `has`, and `set` traps.
- Add all traps to one proxy and also test representative individual traps so an ordering regression is localized.
- Add sentinel-bearing `toString`, `valueOf`, `toJSON`, iterator, and custom-inspection hooks on targets/prototypes.
- Assert total trap/hook count is exactly zero for every case.
- Assert the domain helper fails through its existing safe domain validation contract without raw sentinel retention.
- Preserve valid ordinary/null-prototype claims, exact-key, accessor, identity-string, metadata-normalization, and immutability tests.

### Application claims tests

- Call `resolveVerifiedIdentity()` with every proxy/revoked-proxy claims case.
- Assert exact `IdentityClaimsValidationError`, `IDENTITY_CLAIMS_INVALID`, field `claims`, and fixed message.
- Assert zero lookup, clock, ID, insert, and recovery calls and no principal.
- Assert fresh error identity across repeated failures.

### Persistence-array tests

- Test initial lookup and recovery separately for:
  - `Object.create(Array.prototype)` with zero elements;
  - `Object.create(Array.prototype)` with one valid snapshot;
  - ordinary array-like objects;
  - objects with copied genuine-array descriptors;
  - iterable and SDK-like collection objects;
  - array subclasses;
  - proxy and revoked-proxy arrays;
  - symbol/extra-key arrays;
  - sparse arrays; and
  - accessor-backed indexes.
- Assert exact operation, fixed message, fresh error identity, trap/getter count, and all dependency call counts.
- Preserve valid zero- and one-element genuine-array success tests and multiple-row rejection.

### Non-disclosure child-process tests

Use focused child processes for hostile claims and spoofed persistence results. Prove sentinel absence from:

- public error fields and own/inherited keys;
- `JSON.stringify`;
- `String(error)`;
- `util.inspect` with custom inspection enabled and disabled;
- captured logger arguments and rendered output;
- error stack and explicit thrown output;
- uncaught-exception and unhandled-rejection output where applicable; and
- child-process stdout and stderr.

Also assert expected exit status, error class/code/field or operation, exact dependency counts, and zero traps/hooks. Passing tests must not print the sentinel.

### Regression and real-infrastructure verification

- Run the complete domain, application, infrastructure, API, worker, and boundary unit suites.
- Run migration validation and the full real-PostgreSQL integration suite, including concurrent first provisioning.
- Preserve exact lookup/insert SQL, parameter order, active/inactive semantics, no email lookup, and one bounded recovery.
- Run API and worker compiled-runtime smoke tests with bounded startup and shutdown.
- Inspect public exports and generated build output.

### Required verification

Run and report every command below against the final implementation SHA:

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
git diff --check origin/main...HEAD
git status --short --branch
```

Also run and report:

- exact top-level manifest inspection for the mutable tag and committed pinned PostgreSQL reference;
- the HIGH/CRITICAL Trivy review scan with the approved exception and suppressed result visible;
- the blocking CRITICAL `--ignore-unfixed` Trivy scan;
- the no-ignore negative control, which must fail only for the approved gosu finding;
- API and worker compiled-runtime smoke tests;
- public export and generated-build inspection;
- exact-SHA GitHub checks for quality, PostgreSQL integration, and container security; and
- clean-checkout verification in a temporary external directory starting without `.env`, `node_modules`, build output, or a pre-existing integration database.

Report every skipped, unavailable, failed, or environment-limited check honestly. Successful CI does not replace local adversarial reproduction or clean-checkout evidence.

## Out of scope

- Any requirement not needed to close these two findings.
- Changes to identity-key semantics, metadata normalization, inactive-user behavior, provisioning/race behavior, snapshot validation, row mapping, clock handling, SQL, schema, migrations, or constraints.
- OIDC token verification, provider selection or SDKs, authorization-code flow, sessions, cookies, routes, `/api/v1/me`, frontend UI, or runtime wiring.
- Workspace, membership, role, invitation, audit, product, AI, content, approval, scheduling, publishing, analytics, social-platform, queue, or cache functionality.
- Generic validators, generic proxy frameworks, repository bases, ORM/query builders, dependency upgrades, lockfile changes, package-export changes, or broad refactors.
- Changes to global `DatabaseError` architecture, infrastructure sanitization, CI policy, Trivy policy, or security exceptions.
- Defending against mutation of trusted ECMAScript or Node intrinsics before module initialization.
- Reformatting plans/reports or changing unrelated documentation.

## Implementation handoff requirements

This remediation is proposed for Product Owner approval. Antigravity must not implement it until the Product Owner explicitly approves it.

Before implementation, Antigravity must read:

- `AGENTS.md`;
- approved TASK-005 and both approved remediation specifications;
- relevant TASK-003/TASK-004 specifications and remediations;
- relevant architecture, database, API, product, security, and decision documentation;
- the complete latest Codex findings and exact reproductions; and
- the actual final `origin/main...HEAD` diff and surrounding implementation/tests.

Antigravity must implement the architecture exactly as specified. It must not substitute try/catch around unsafe proxy reflection, intentional trap triggering, `instanceof Array`, prototype duck typing, JSON cloning, eager serialization, a generic schema library, or a public contract redesign. Any unavoidable deviation, new file, dependency, export, or boundary change must be reported to Codex before implementation.

Before declaring implementation ready for review, Antigravity must report:

- the exact claims proxy-detection and fail-closed error-routing sequence;
- proof every claims proxy trap/hook remains at zero;
- complete claims non-disclosure results across fields, JSON, string conversion, inspection, logs, stack, thrown output, stdout, and stderr;
- the exact persistence-array validation sequence showing proxy rejection, `Array.isArray`, exact prototype, then descriptors;
- initial-lookup and recovery spoofed-array matrices with exact dependency call counts;
- proof no fake array produces a principal and no database error is reclassified;
- all unit, integration, concurrency, runtime, audit, pin, Trivy, no-ignore, clean-checkout, and exact-SHA CI results with actual exit statuses;
- changed files, final local/remote/PR SHA equality, and clean worktree status; and
- every skipped check, failure, deviation, or limitation.

Codex will re-review the approved requirements, actual implementation diff, claims and persistence-result adversarial reproductions, trap/hook counts, call ordering, error surfaces, regression behavior, and all required gates before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
