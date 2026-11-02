# TASK-005 Remediation 01 - Hostile Persistence Results, Row Mapping, and Clock Safety

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-005` and reviewed implementation commit `5f2c3c0b2e9ec749763d4cd8237ad2782d17aaca`

## Objective

Close all four findings from the Codex final adversarial review of TASK-005 Pull Request #5:

1. make initial lookup and losing-race recovery result inspection exception-safe and non-disclosing;
2. make `RawUserRow` mapping a closed, non-coercing infrastructure boundary that always fails with a fresh safe `DatabaseError`;
3. validate hostile clock results without invoking caller-overridable `Date` behavior or retaining a caller-owned `Date`; and
4. remove the five plan-file whitespace violations and complete every required TASK-005 verification gate.

This remediation is limited to those findings and their focused regression tests. It does not redesign TASK-005 identity semantics, SQL, package boundaries, or concurrency behavior.

## Context

PR #5 targets `main` from `agy/task-005-verified-identity`. Codex reviewed commit `5f2c3c0b2e9ec749763d4cd8237ad2782d17aaca` against `origin/main` commit `f8a39fe9662f7ab97ff06324a61aae485dcf0cf3`. At review time, the local branch, remote branch, PR head, and expected SHA matched, the worktree was clean, and all three GitHub checks succeeded on the reviewed SHA.

The review confirmed the exact provider/subject SQL and parameter ordering, no email identity behavior, successful real-PostgreSQL concurrency coverage, package-boundary compliance, and passing ordinary unit, integration, build, audit, pin, and container gates. It found four defects:

- `resolveVerifiedIdentity()` uses `Array.isArray()` and then directly reads lookup/recovery `length`, indexes, and snapshot properties. A proxy-backed array or accessor-backed snapshot can execute hostile code and expose a raw error instead of the required fixed `IdentityPersistenceError`.
- `mapUserRow()` directly reads row properties, coerces `version` with `Number(...)`, coerces metadata with `String(...)`, and rethrows any incoming value recognized as `DatabaseError`. Hostile getters and conversion hooks execute, and a crafted `DatabaseError` can escape unchanged with raw identity or credential metadata.
- the missing-identity path calls caller-overridable `now.getTime()` and later conversion behavior. A hostile genuine `Date` can execute an overridden own method and expose a raw error rather than the existing fixed clock `ValidationError`.
- `git diff --check origin/main...HEAD` fails because five TASK-005 phase plan files contain trailing whitespace.

The governing sources remain:

- `AGENTS.md`;
- approved `tasks/TASK-005.md`;
- relevant architecture, database, API, security, product, and decision documentation;
- TASK-003, TASK-004, and all approved remediations whose database-error, transaction, runtime, and verification guarantees remain inherited;
- the complete latest Codex findings and exact reproductions; and
- the actual `origin/main...HEAD` implementation and surrounding tests.

TASK-005 remains the source of truth except where this remediation narrows hostile-value handling. Provider and subject remain exact opaque identity keys; email and display name remain trim-only metadata; safe database failures retain precedence over race interpretation; and no OIDC provider, session, route, or runtime composition is selected here.

## Required implementation

### 1. Add one exception-safe application persistence-result validator

Replace direct lookup/recovery array and `UserSnapshot` inspection in `resolveVerifiedIdentity()` with a narrowly scoped internal validator. Do not add a generic validation framework or export a new public contract unless an existing public surface requires it.

The validator must accept `unknown`, the operation (`lookup`, `insert`, or `recovery` where reused), and the exact expected provider/subject or expected inserted snapshot required by TASK-005. It must return only a newly constructed, frozen canonical snapshot or an immutable local collection of canonical snapshots. It must never return or retain a dependency-owned array or snapshot object.

#### 1.1 Proxy and array handling

Before `Array.isArray`, `Object.getPrototypeOf`, `Reflect.ownKeys`, `Object.getOwnPropertyDescriptor`, `Object.isFrozen`, `length`, index access, iteration, spread, destructuring, or any other reflective inspection:

- detect proxy-backed values with the trusted Node runtime primitive `util.types.isProxy` from `node:util`;
- reject proxies immediately without touching a proxy trap;
- catch a failure from proxy detection itself and fail closed;
- require a genuine JavaScript array after proxy rejection; and
- do not accept array-like objects, iterables, typed arrays, arguments objects, subclasses with a hostile prototype, or provider/SDK collections.

For a genuine array:

- require its prototype to be exactly `Array.prototype`;
- obtain `length` through its own data-property descriptor, not `result.length`;
- require the length descriptor to be the normal non-accessor array length descriptor and its value to be a non-negative safe integer;
- reject unexpected string keys, symbol keys, accessors, sparse indexes, duplicate/ambiguous indexes, and non-canonical numeric property names;
- inspect each expected index through `Object.getOwnPropertyDescriptor`, never `result[index]` and never iteration;
- require every index to be an own data property;
- permit only lengths required by TASK-005 result semantics: zero or one for an application-success path, while any length greater than one deterministically becomes the operation-specific persistence error; and
- perform all inspection inside one `try/catch` whose catch path does not inspect, stringify, log, serialize, coerce, attach, or rethrow the caught value.

Proxy-array tests with throwing `get`, `getOwnPropertyDescriptor`, `getPrototypeOf`, and `ownKeys` traps must prove all trap counters remain zero. A revoked proxy must also fail closed. The validator must not depend on a trap throwing to discover a proxy.

#### 1.2 Exact `UserSnapshot` descriptor validation

Every snapshot from lookup, insert, or recovery is untrusted at runtime even when TypeScript declares `UserSnapshot`.

Before reflection, reject a proxy-backed snapshot using the same trusted proxy detection rule. Then require:

- a non-null ordinary object;
- prototype exactly `Object.prototype` or `null`; no class instance, provider object, `Date`, array, function, boxed primitive, or custom prototype;
- `Object.isFrozen(snapshot) === true` after proxy rejection;
- exactly these nine own string keys and no others: `id`, `identityProvider`, `identitySubject`, `email`, `displayName`, `status`, `createdAt`, `updatedAt`, and `version`;
- no own symbol keys;
- one own data-property descriptor for every required key;
- no getter or setter descriptor;
- no inherited value accepted for any required field; and
- no direct property read after descriptor capture.

Validate only the captured descriptor values:

- `id`: primitive string and canonical UUIDv7 through the existing domain ID validation;
- `identityProvider` and `identitySubject`: primitive strings, non-empty, no leading/trailing whitespace, exact match to the validated claims key, and no normalization;
- `email` and `displayName`: primitive string or `null` only; no object or `undefined` in a persistence snapshot;
- `status`: exact existing `UserStatus` primitive string;
- `createdAt` and `updatedAt`: primitive strings satisfying the existing canonical `IsoTimestamp` validator;
- `version`: primitive number, finite safe integer, and greater than zero.

The validator must not call getters, setters, `String`, `Number`, `Boolean`, `toString`, `valueOf`, `toJSON`, custom inspection, iteration, spread, structured cloning, or JSON serialization on any unknown value. Because every accepted field is primitive or `null`, any object, function, symbol, bigint, array, cyclic value, boxed primitive, or other nested reference is rejected.

After validation, construct and freeze a fresh `UserSnapshot` from captured primitive values. The principal must use this canonical copy, never the dependency-owned object. Insert-result comparison must compare only captured canonical primitive values against the generated user and retain every exact TASK-005 equality requirement.

#### 1.3 Error routing and call order

All array/snapshot inspection and canonical-copy failures must become newly constructed errors with the existing fixed default message:

- initial lookup inspection: `new IdentityPersistenceError('lookup')`;
- inserted snapshot inspection: `new IdentityPersistenceError('insert')`;
- losing-race recovery inspection: `new IdentityPersistenceError('recovery')`.

Do not pass a dynamic message to these constructors. Do not include provider, subject, email, display name, ID, status, raw value, operation input, or caught-error text in a field, message, cause, stack addition, log, or serialization hook.

An asynchronous rejection from `findUsersByIdentity()` or `insertUserIfAbsent()` remains governed by TASK-005: an already-safe database error is propagated and database failure takes precedence. The application validator must not import infrastructure or inspect database error internals. This remediation changes hostile fulfilled-result inspection, not the approved database-error dependency contract.

Required ordering remains exact:

- invalid initial lookup results cause zero clock, ID-generator, insert, or recovery calls;
- invalid insert results cause no recovery lookup;
- invalid recovery results cause no retry or additional dependency call;
- active, disabled, deletion-pending, multiple, missing-recovery, and database-failure semantics remain those of TASK-005; and
- no retry loop is introduced.

### 2. Make `RawUserRow` mapping a closed infrastructure boundary

Replace direct property reads and coercion in `mapUserRow()` with a dedicated internal safe row-inspection operation. Do not weaken the `RawUserRow` TypeScript contract to `any`, and do not add a generic repository or mapper framework.

#### 2.1 Exact row shape and descriptors

Treat the runtime row as `unknown`. Before any reflective operation, use `util.types.isProxy` to detect and reject a proxy-backed row without invoking a trap. Catch proxy-detection failure and fail closed.

After proxy rejection, require:

- a non-null ordinary object;
- prototype exactly `Object.prototype` or `null`;
- exactly these nine own string keys: `id`, `identity_provider`, `identity_subject`, `email`, `display_name`, `status`, `created_at`, `updated_at`, and `version`;
- no symbol keys, unexpected keys, inherited substitutes, missing keys, duplicate/ambiguous keys, getters, or setters; and
- one captured own data-property descriptor per required key, with no later direct row property read.

Reject arrays, functions, class instances, provider/driver wrappers with custom prototypes, boxed primitives, cyclic objects, proxies, and any row whose shape cannot be proven safely. Extra database columns are not silently ignored because the SQL contract returns the exact nine user columns.

#### 2.2 Exact runtime types and non-coercing branches

No unknown row value may be passed to `String`, `Number`, `Boolean`, template interpolation, concatenation, `toString`, `valueOf`, `toJSON`, JSON serialization, inspection, logging, or an arbitrary hook.

Validate captured descriptor values through explicit type branches:

- `id`: primitive string only; canonical UUIDv7 required;
- `identity_provider` and `identity_subject`: primitive string only; non-empty and no leading/trailing whitespace; preserve exact case and code points;
- `email` and `display_name`: primitive string or `null` only; `undefined`, objects, boxed strings, functions, symbols, and bigint are rejected; do not trim or normalize database values in the mapper;
- `status`: primitive string and exact existing `UserStatus`;
- `created_at` and `updated_at`: either a canonical primitive timestamp string or the pre-existing explicitly supported genuine `Date` case described below; no other object is accepted;
- `version`: support the declared primitive `number`, `string`, and `bigint` cases through three separate branches, never through coercion of `unknown`.

Version rules are exact:

- number branch: require a finite safe integer from `1` through `Number.MAX_SAFE_INTEGER`; use the value directly;
- string branch: require canonical base-10 digits with no sign, whitespace, decimal point, exponent, prefix, separator, or leading zero; prove the numeric value is within `1..Number.MAX_SAFE_INTEGER` before converting the already-proven primitive string to the domain number;
- bigint branch: require `1n..BigInt(Number.MAX_SAFE_INTEGER)` before converting the already-proven primitive bigint to the domain number; and
- every other type fails.

Conversion in the string/bigint branch may operate only after the value is proven to be the expected primitive and bounded. It must not invoke caller-owned behavior. Calling `Number(...)` on an unclassified value, or using one shared coercing branch, is prohibited.

For a timestamp `Date` value:

- reject proxies before reflection;
- require prototype exactly `Date.prototype`, no subclass, and no own keys or method overrides;
- use trusted intrinsic calls such as `Date.prototype.getTime.call(value)` and `Date.prototype.toISOString.call(freshDate)`, never `value.getTime()`, `value.toISOString()`, `value.valueOf()`, or implicit conversion;
- require a finite epoch;
- create a fresh `Date` from the trusted epoch and derive a canonical primitive timestamp from that fresh value; and
- never retain or return the driver-owned `Date`.

The accepted row must map to a newly constructed frozen `UserSnapshot` containing only approved primitive values and `null`.

#### 2.3 Fresh fixed mapper failures

Every `mapUserRow()` failure, including proxy detection, prototype inspection, own-key inspection, descriptor access, field validation, timestamp conversion, version conversion, snapshot construction, or freezing, must throw a newly constructed fixed-message `DatabaseError`.

Use one approved constant message for all user-row mapping failures, for example `Failed to map user row`, and the existing safe generic database code if a code is supplied. The message must not name a field or contain a row value. The fresh error must not retain the original row or thrown value.

Never:

- rethrow an incoming or crafted `DatabaseError` unchanged;
- call `instanceof DatabaseError` and return that caught identity from this mapper boundary;
- pass the caught value to `sanitizeDatabaseError()` if doing so could preserve an attacker-supplied branded identity or classification;
- attach `cause`, row, SQL, parameters, constraints, driver metadata, URL, credentials, or stack; or
- log, stringify, inspect, serialize, or coerce the caught value.

The adapter's lookup and insert result semantics, SQL text, parameter order, and `ON CONFLICT` target remain byte-for-byte behaviorally equivalent to TASK-005. Zero lookup rows remain `[]`, two lookup rows remain two canonical snapshots for application rejection, zero insert rows remain `null`, one insert row remains one canonical snapshot, and more than one insert row remains a safe `DatabaseError`.

### 3. Validate hostile clock Dates through trusted intrinsic behavior

Replace direct `now.getTime()` and caller-owned Date conversion in the missing-identity path with one internal safe clock conversion operation. It must return a canonical primitive `IsoTimestamp`, not a `Date`.

Required sequence:

1. Call `deps.clock.now()` exactly once inside the clock failure boundary.
2. Treat the returned runtime value as `unknown` regardless of the TypeScript port type.
3. Before reflection, reject a proxy with `util.types.isProxy`; a proxy-wrapped Date is invalid even when `instanceof Date` would otherwise appear plausible.
4. Require `typeof value === 'object'`, non-null, and `Object.getPrototypeOf(value) === Date.prototype`.
5. Reject Date subclasses, cross-shape objects, custom prototypes, and any own key, including overridden own `getTime`, `toISOString`, `valueOf`, `toString`, `toJSON`, symbol, getter, or setter properties. Normal genuine Date instances have no own keys.
6. Invoke only `Date.prototype.getTime.call(value)` to obtain the epoch. Never invoke `value.getTime()`, `value.toISOString()`, `value.valueOf()`, implicit numeric/string conversion, or any caller-overridable method.
7. Require the epoch to be a finite number representing a valid instant.
8. Construct a fresh `Date` from the trusted epoch, derive a canonical primitive timestamp using trusted intrinsic behavior, and validate it through the existing timestamp contract before retaining it.
9. Drop the caller-owned Date reference before ID generation and persistence; only the canonical primitive timestamp may enter the generated snapshot.

The complete `clock.now()` call, proxy/prototype/own-key inspection, intrinsic conversion, fresh-Date construction, and timestamp validation must be inside one `try/catch`. Every failure must throw the existing fixed safe `ValidationError` for field `clock` with no dynamic message, cause, raw error, Date, identity metadata, or hook output.

After any clock failure:

- the ID generator is not called;
- insert is not called;
- recovery is not called;
- no retry occurs; and
- no caller-owned Date or mutable reference is retained or returned.

Global mutation of trusted ECMAScript intrinsics before module initialization is outside this remediation. Instance-level overrides, subclasses, proxies, and hostile own properties are in scope and must fail closed without execution.

### 4. Verification and documentation cleanup

Remove trailing whitespace only from the `Status` and `Priority` lines currently reported in these five files:

- `plans/261101-0130-task-005-verified-identity/phase-01-domain-identity.md`;
- `plans/261101-0130-task-005-verified-identity/phase-02-application-identity.md`;
- `plans/261101-0130-task-005-verified-identity/phase-03-infrastructure-identity.md`;
- `plans/261101-0130-task-005-verified-identity/phase-04-integration-concurrency.md`; and
- `plans/261101-0130-task-005-verified-identity/phase-05-verification-gates.md`.

Do not rewrite plan content or add unrelated documentation. `git diff --check origin/main...HEAD` must exit `0` after remediation.

Run `corepack pnpm env:local` as a required gate. It must retain its existing create-once/no-overwrite behavior. Complete clean-checkout verification in a temporary directory outside the repository, starting without `.env`, `node_modules`, build output, or a pre-existing integration database. The clean checkout must use the final reviewed SHA, perform frozen installation and the applicable full verification matrix, and remain clean afterward.

All prior TASK-005 gates, inherited TASK-003/TASK-004 gates, exact-image checks, Trivy scans, no-ignore negative control, runtime smoke tests, and exact-SHA GitHub checks remain required.

### 5. Preserve all other TASK-005 behavior

Retain without redesign:

- exact provider and subject preservation and lookup;
- trim-only email/display-name claims metadata;
- no email lookup, uniqueness, recovery, linking, or authorization behavior;
- active/inactive user semantics and non-disclosing errors;
- exact clock, ID, insert, and one-recovery call order after valid results;
- exact lookup and insert SQL, nine columns, parameter ordering, `LIMIT 2`, and provider/subject conflict target;
- database-failure precedence over race interpretation;
- immutable principal, source, and user snapshots;
- real-PostgreSQL concurrent first-provisioning behavior;
- existing public package exports and generated build output;
- modular-monolith dependency direction and no deep imports;
- no runtime wiring in API, worker, or web; and
- every completed TASK-004 database, transaction, sanitization, tenancy, and lifecycle guarantee.

## Expected files

Expected focused remediation changes are limited to:

- `tasks/TASK-005-REMEDIATION-01.md`;
- `packages/application/src/resolve-verified-identity.ts`;
- `packages/application/test/resolve-verified-identity.unit.test.ts`;
- a focused application child-process adversarial test file only if needed for stdout/stderr proof;
- `packages/infrastructure/src/tenancy/mappers.ts`;
- `packages/infrastructure/test/unit/identity-adapter.unit.test.ts`;
- a focused infrastructure child-process adversarial test file only if needed for stdout/stderr proof;
- the five phase plan files listed in Required implementation section 4, with trailing-whitespace-only cleanup; and
- generated package build output only where the repository's existing build policy tracks it.

Changes to `packages/infrastructure/src/database/errors.ts` or sanitization are not expected. If implementation proves a change there is unavoidable, stop and report the exact dependency to Codex before editing; do not broaden the trusted `DatabaseError` architecture independently.

Do not modify migrations, schema, SQL contracts, package exports, manifests, dependency pins, lockfile, CI policy, API/worker/web composition, or unrelated planning artifacts.

## Database changes

None.

- Do not add or modify migrations, tables, columns, constraints, indexes, extensions, seed data, roles, or grants.
- Preserve the exact TASK-004 schema and TASK-005 lookup/insert SQL.

## API changes

None.

- Do not add or change routes, request/response schemas, OpenAPI, status codes, Problem Details, authentication, authorization, sessions, cookies, CORS, or CSRF.

## Frontend changes

None.

- Do not modify `apps/web`, UI, pages, styles, forms, or client authentication behavior.

## Backend changes

Only the application persistence-result validator, safe clock conversion, infrastructure user-row mapper, focused tests, and five trailing-whitespace corrections described above may change.

Do not wire identity resolution into API or worker composition. Preserve all runtime startup, shutdown, liveness, database probe, migration, and TASK-004 tenancy behavior.

## Security requirements

- Treat fulfilled persistence results, individual snapshots, raw database rows, row fields, clock values, and all caught values as hostile runtime input.
- Detect proxies before reflective inspection using the trusted runtime proxy detector. Do not intentionally trigger a trap to identify a proxy.
- Use closed allowlists for prototypes, own keys, descriptors, field types, and values. Do not use a growing blacklist of suspicious strings.
- Never execute hostile getters, setters, proxy traps, iteration hooks, coercion hooks, serialization hooks, inspection hooks, `toString`, `valueOf`, or `toJSON`.
- Never expose or retain raw identity metadata, rows, driver values, SQL, parameters, bind values, constraints, URLs, credentials, tokens, stack traces, caught errors, or caller-owned Dates.
- Application inspection failures expose only a fresh fixed-message `IdentityPersistenceError` with the correct operation.
- Clock failures expose only the existing fresh fixed-message `ValidationError` for `clock`.
- User-row mapper failures expose only a fresh fixed-message `DatabaseError`; crafted branded errors are never trusted or rethrown unchanged.
- Safe errors must contain no raw cause and no attacker-controlled own property, symbol, message, code, stack addition, serialization result, or inspection result.
- Do not log hostile values, even in tests. Child-process tests capture output and assert sentinel absence without printing the sentinel on success.
- Do not add global unhandled-rejection suppression, test-only production bypasses, debug exports, monkey patches, ambient state, secret fixtures, or relaxed lint/security rules.

## Edge cases

- Proxy and revoked-proxy lookup arrays.
- Proxy arrays with throwing `length`, index, `ownKeys`, descriptor, and prototype traps.
- Array subclass, sparse array, symbol-bearing array, extra-key array, accessor index, and lengths zero, one, two, and unexpectedly large.
- Null, primitive, function, array-like, iterable, and provider-SDK-like lookup results.
- Proxy, revoked proxy, mutable, symbol-bearing, extra-key, missing-key, custom-prototype, accessor-backed, and cyclic snapshot objects.
- Snapshot getters that return different values on repeated reads or throw crafted errors.
- Snapshot fields containing boxed strings, `Date`, arrays, objects, functions, symbols, bigint, custom hooks, invalid IDs, invalid timestamps, invalid statuses, invalid versions, or mismatched identity keys.
- Initial lookup, inserted result, and recovery result variants of every hostile snapshot case.
- Raw row proxy/revoked proxy and hostile row prototype.
- Raw row getter/setter descriptors, symbol keys, extra/missing keys, and inherited required fields.
- Raw row values with custom `toString`, `valueOf`, `toJSON`, iterator, or Node custom-inspection hooks.
- Crafted genuine or shape-compatible `DatabaseError` values thrown by row getters or conversion hooks.
- `version` as valid/invalid number, canonical/non-canonical string, bounded/out-of-range bigint, `NaN`, infinities, unsafe integers, signed strings, whitespace, leading zeros, decimals, exponents, objects, and symbols.
- Timestamp strings, genuine Dates, invalid Dates, Dates with own overrides, Date subclasses, proxy-wrapped Dates, and non-Date objects with Date-like methods.
- Clock returns null, primitive, invalid Date, Date with own `getTime`, `toISOString`, `valueOf`, `toString`, `toJSON`, symbol, getter, or setter; Date subclass; proxy/revoked-proxy Date; and valid genuine Date.
- Raw sentinels containing identity values, SQL, bind values, constraints, URLs, credentials, tokens, newlines, and fake stack frames.

## Acceptance criteria

1. Initial lookup and recovery accept only safely inspected genuine arrays and canonical frozen copies of exact safe snapshots.
2. Proxy arrays are rejected before any trap executes; throwing length/index/prototype/key/descriptor traps remain unexecuted.
3. Snapshot validation uses only captured own data-property descriptors and rejects proxies, accessors, symbols, unexpected/missing keys, mutable objects, hostile prototypes, nested references, and malformed fields.
4. Every fulfilled-result inspection failure becomes a fresh fixed-message `IdentityPersistenceError` for the exact `lookup`, `insert`, or `recovery` operation; no raw value or identity metadata escapes.
5. Invalid initial lookup causes zero clock, ID-generator, insert, and recovery calls; invalid insert causes no recovery; invalid recovery causes no retry.
6. `mapUserRow()` detects proxies before reflection, accepts only the exact row shape and approved field types, and performs no coercion or arbitrary hook execution on unknown values.
7. Number, string, and bigint versions use separate bounded primitive branches and map only to a safe positive integer domain version.
8. Every user-row failure throws a new fixed-message `DatabaseError`; an incoming or crafted `DatabaseError` is never returned by identity.
9. Raw rows, errors, SQL, binds, constraints, URLs, credentials, identity metadata, and stacks are absent from direct fields, JSON, `String`, inspection, logs, thrown output, and child-process stdout/stderr.
10. Clock conversion rejects proxies, subclasses, own overrides, and non-genuine Dates without invoking caller methods; valid Dates are read only through trusted intrinsic behavior.
11. Clock failure always returns the existing fixed safe clock `ValidationError` and causes zero ID-generator, insert, and recovery calls.
12. No caller-owned Date, dependency-owned array, dependency-owned snapshot, driver-owned Date, or mutable reference reaches returned or persisted state.
13. All exact identity semantics, SQL, concurrency, database-error precedence, package exports, boundaries, and TASK-004 behavior remain unchanged.
14. The five plan files contain no trailing whitespace and `git diff --check origin/main...HEAD` exits `0`.
15. `env:local`, frozen install, clean-checkout verification, all prior TASK-005 gates, both Trivy scans, no-ignore control, runtime smokes, and exact-SHA GitHub checks complete with actual results.
16. Final local HEAD, remote branch head, and PR #5 head are identical; the reviewed worktree and temporary clean checkout are clean.

## Test plan

### Application unit tests

Add an adversarial matrix for initial lookup, insert result, and recovery result covering:

- proxy and revoked-proxy arrays;
- proxies with throwing `get` for `length` and indexes, `ownKeys`, `getPrototypeOf`, and `getOwnPropertyDescriptor` traps, asserting zero trap calls;
- sparse, subclassed, symbol-bearing, extra-key, accessor-index, mutable, malformed, zero-, one-, two-, and oversized arrays;
- accessor-backed, proxy-backed, mutable, symbol-bearing, extra/missing-key, custom-prototype, malformed, and mismatched snapshots;
- hostile nested field values and custom `toString`, `valueOf`, `toJSON`, iterator, and custom-inspection hooks with zero hook calls;
- exact operation, fixed message, public fields, and call-count assertions;
- database rejection precedence and no retry-loop regression;
- mutation attempts against returned principals, sources, users, and dependency-owned objects after resolution; and
- valid active/inactive, creation, inserted-snapshot equality, and losing-race behavior from TASK-005.

### Infrastructure unit tests

Add an adversarial `mapUserRow()` matrix covering:

- proxy/revoked-proxy rows with every relevant throwing trap and zero trap calls;
- row getters/setters, symbols, extra/missing keys, hostile prototypes, inherited fields, arrays, functions, and SDK-like objects;
- invalid and hostile values for every one of the nine fields;
- custom `toString`, `valueOf`, `toJSON`, iterator, and Node custom-inspection hooks, asserting zero hook calls;
- crafted genuine, mutated, proxy-backed, and shape-compatible `DatabaseError` values;
- all number/string/bigint version branches and boundaries;
- canonical timestamp strings, genuine Dates, invalid Dates, own-method Dates, Date subclasses, and proxy Dates;
- fresh error identity and fixed-message assertions for every failure; and
- unchanged exact lookup/insert SQL, parameters, row-count semantics, and immutable mapping success.

### Hostile clock unit tests

Cover:

- null, undefined, primitives, arrays, functions, symbols, bigint, ordinary objects, and Date-like objects;
- invalid genuine Date;
- genuine Date with overridden own `getTime`, `toISOString`, `valueOf`, `toString`, `toJSON`, accessor, or symbol properties;
- Date subclass with overridden methods;
- proxy and revoked-proxy Date with throwing traps and zero trap calls;
- valid genuine Date producing the exact canonical timestamp from a fresh value;
- fixed safe `ValidationError` field/message and absence of raw sentinels; and
- exactly one clock call and zero ID, insert, or recovery calls on every failure.

### Child-process non-disclosure tests

Run focused child processes so test-runner formatting cannot hide a leak. For hostile lookup arrays/snapshots, rows, crafted `DatabaseError` values, and clock Dates, use unique raw sentinels and prove the sentinel is absent from:

- public error fields and own/inherited keys;
- `JSON.stringify` and any approved `toJSON` surface;
- `String(error)`;
- `util.inspect` with custom inspection both enabled and disabled;
- logger arguments and rendered logs;
- error stack and thrown output;
- unhandled rejection and uncaught exception output; and
- child-process stdout and stderr.

Child-process tests must also assert expected exit status, safe error class/code/operation/field, and zero hostile-hook/trap calls. Do not print the raw sentinel as part of a passing test diagnostic.

### Real PostgreSQL and regression tests

- Run the complete migration and PostgreSQL integration suites against the exact pinned image.
- Preserve exact lookup and insert behavior, same-provider/subject concurrency, cross-provider subject distinction, active recovery, inactive recovery, no duplicate row, no metadata mutation, and database-error precedence.
- Preserve all TASK-004 schema, tenancy, transaction, delayed-query, sanitization, and isolation tests.
- Controlled hostile row/clock/proxy behavior may remain unit/child-process coverage because normal PostgreSQL results do not produce adversarial JavaScript accessors or proxies.

### Required verification

Run and report every command below against the final remediation SHA:

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

- exact top-level manifest inspection for the tag and committed pinned PostgreSQL reference;
- the required HIGH/CRITICAL Trivy review scan with the approved exception and suppressed result visible;
- the required blocking CRITICAL `--ignore-unfixed` Trivy scan;
- the no-ignore negative control, which must fail only for the expected approved gosu finding;
- API and worker production/runtime smoke tests with bounded startup and shutdown;
- public package export and generated build-output inspection;
- exact-SHA GitHub checks for quality, PostgreSQL integration, and container security; and
- clean-checkout verification from a temporary external directory, including frozen install, `env:local`, applicable full checks, and final clean status.

Report every skipped, unavailable, failed, or environment-limited check honestly. A successful CI summary does not replace local adversarial reproduction or clean-checkout evidence.

## Out of scope

- Any requirement not needed to close these four findings.
- Changing provider/subject identity semantics, email metadata policy, inactive-user semantics, race semantics, SQL, schema, migrations, or database constraints.
- OIDC token verification, provider SDKs, vendor selection, authorization-code flow, sessions, cookies, routes, `/api/v1/me`, UI, or runtime composition.
- Workspace, invitation, role, audit, product, AI, content, approval, scheduling, publishing, analytics, social-platform, queue, or cache functionality.
- Generic validators, repository bases, ORM/query-builder adoption, dependency upgrades, lockfile changes, broad refactors, or new architectural layers.
- Changing global `DatabaseError` trusted-state/sanitization architecture unless Codex approves a separately demonstrated blocker.
- Defending against arbitrary mutation of trusted ECMAScript or Node intrinsics before module initialization.
- Reformatting plan content beyond the five exact trailing-whitespace corrections.

## Implementation handoff requirements

This remediation is approved by the Product Owner. Antigravity may implement it on the existing TASK-005 branch.

Before coding, Antigravity must read:

- `AGENTS.md`;
- approved `TASK-005` and this approved remediation specification;
- TASK-003, TASK-004, and all their approved remediations relevant to database sanitization and verification;
- relevant architecture, database, API, security, product, and decision documentation;
- the complete latest Codex findings and exact reproductions; and
- the actual final `origin/main...HEAD` diff and surrounding production/tests.

Antigravity must implement the architecture exactly as specified. It must not substitute exception-message filtering, try/catch around unsafe direct reads, JSON cloning, eager serialization, a generic schema library, or its own proxy/Date/error design. Any unavoidable deviation, new file, public export, database-error change, or conflict with an inherited requirement must be reported to Codex before implementation.

Before declaring the remediation ready for review, Antigravity must report:

- the exact array and snapshot descriptor-validation algorithm and proof that proxy traps remain unexecuted;
- the exact `RawUserRow` prototype/key/descriptor/type matrix and version conversion branches;
- proof every mapper failure creates a fresh fixed-message `DatabaseError` and never preserves a crafted error identity;
- the exact trusted-intrinsic Date algorithm and proof that own methods, subclasses, and proxy Dates do not execute;
- dependency call-order results for all initial lookup, insert, recovery, and clock failures;
- complete child-process non-disclosure results across fields, JSON, string conversion, inspection, logs, stack, thrown output, stdout, and stderr;
- all unit, integration, concurrency, runtime, audit, pin, Trivy, no-ignore, clean-checkout, and exact-SHA CI results with command exit statuses;
- changed files, final local/remote/PR SHA equality, and clean worktree status; and
- every skipped check, failure, deviation, or limitation.

Codex will re-review the user requirement, approved TASK-005 specification, this remediation, the actual implementation diff, hostile reproductions, SQL, error surfaces, runtime behavior, tests, and final exact-SHA evidence before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
