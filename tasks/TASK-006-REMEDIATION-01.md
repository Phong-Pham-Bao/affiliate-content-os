# TASK-006 REMEDIATION 01 - Hostile Authentication Boundaries and Closed PostgreSQL Results

Status: Approved by Product Owner
Owner: Antigravity (Implementation Engineer)

Remediates: Codex review of TASK-006 at reviewed PR head `88cfa6a2d5d37a11431f0c6a8be6941e31a9febb`

Depends on: `TASK-006.md` and every guarantee already implemented on branch `agy/task-006-managed-oidc-session`

## Objective

Remediate the four HIGH findings from the latest TASK-006 review without redesigning the authentication architecture:

1. remove all classification of arbitrary OIDC-port rejections through `instanceof`, property access, prototype traversal, string conversion, or other reflection;
2. make every affected authentication DTO an exact, descriptor-validated, semantically canonical, independently copied and frozen snapshot;
3. validate PostgreSQL result wrappers and genuine row arrays before reading `rows` or mapping any row, without invoking caller-controlled methods, iterators, getters, or hooks; and
4. retain `CryptoOperationError` only as a parameterless, fixed-message public error whose source and emitted declaration cannot accept disclosure-bearing data.

This remediation preserves the provider-neutral OIDC, one-time callback, opaque PostgreSQL session, current-user, concurrency, API, and non-disclosure guarantees of TASK-006. It adds no product behavior.

## Context and reviewed baseline

Codex reviewed both `origin/main...HEAD` and the exact implementation at `88cfa6a2d5d37a11431f0c6a8be6941e31a9febb`. The affected implementation currently has these security-boundary defects:

- `completeOidcLogin` executes `err instanceof OidcProviderUnavailableError` on a value rejected by the OIDC port.
- consumed transactions omit descriptor and value validation for `keyVersion`, `createdAt`, and `expiresAt`, and replace both timestamps with empty strings;
- session and current-user validation accepts malformed dates or missing fields, and returns a caller-owned user object;
- the PostgreSQL auth adapters read `result.rows` before validating the result wrapper, do not enforce a closed array key set, and the session adapter invokes `rawRows.map`;
- the public infrastructure export `CryptoOperationError` accepts arbitrary message text, including in the emitted `crypto.d.ts` declaration.

The following earlier review corrections are already present and are regression requirements, not work to remove or weaken:

- callback success and denial shapes are mutually exclusive, controls are rejected, and invalid shapes perform zero hashing and zero transaction consumption; and
- session authentication performs `findUserById` only through the transaction-scoped store, including with a real PostgreSQL pool configured with `poolMax=1`.

## Governing architecture and contracts

Implementation must remain consistent with:

- `AGENTS.md`;
- `tasks/TASK-006.md`;
- `docs/ARCHITECTURE.md`, especially the modular-monolith dependency direction and managed-OIDC/session boundary;
- `docs/API.md`, especially the four authentication routes, current-user response, fixed Problem Details codes, cookies, and no-store behavior;
- `docs/DATABASE.md`, especially `oidc_login_transactions`, `application_sessions`, UUIDv7, timestamp, lifecycle, and secret-scrubbing invariants;
- `docs/DECISIONS.md`, especially ADR-001, ADR-003, ADR-004, ADR-005, and ADR-020;
- `openapi/openapi.json`; and
- the existing TASK-005 hardened `resolveVerifiedIdentity` contract.

When this specification is more specific about the four findings, this specification governs the remediation. It does not authorize changes to the approved public HTTP shapes, database schema, migrations, dependency versions, or architecture.

## Locked design decisions

### 1. Representation of OIDC exchange outcomes

Expected OIDC exchange outcomes must cross the application port as an explicit discriminated result, never as typed thrown errors.

Add the following application contract, using equivalent names only if required by the existing naming convention:

```ts
export type OidcExchangeResult =
  | {
      readonly status: 'verified';
      readonly claims: VerifiedOidcClaimsDTO;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'unavailable';
    };

export interface OidcProtocolPort {
  // buildAuthorizationUrl remains unchanged.
  exchangeCodeAndValidateIdToken(params: {
    readonly code: string;
    readonly pkceVerifier: string;
    readonly nonce: string;
  }): Promise<OidcExchangeResult>;
}
```

The result is the trusted carrier only after the application validates it as an exact closed DTO. Merely returning an object with a `status` property is not sufficient.

The infrastructure OIDC adapter owns conversion from `openid-client` behavior to this result:

- successful verification and locally validated claims return `status: 'verified'` with a fresh claims snapshot;
- protocol-invalid, claim-invalid, issuer/audience/nonce/signature/time-invalid, or otherwise rejected verified requirements return `status: 'invalid'` when the adapter can determine that outcome without inspecting an arbitrary thrown value;
- transport, timeout, abort, token-endpoint 5xx, JWKS availability, and any library rejection that cannot be safely distinguished without inspecting the rejection return `status: 'unavailable'`;
- a `catch` around an untrusted library rejection must be parameterless (`catch { ... }`) and must not read, reflect, compare, stringify, log, serialize, inspect, or rethrow the caught value; and
- the adapter must create a new frozen result object. It must not return an SDK error, token set, claims object, `Response`, or other library-owned object.

Fail closed when safe classification is impossible: availability is the only permitted classification for an opaque library rejection. Do not restore `instanceof client.*`, `err.cause`, `err.status`, `err.error`, constructor-name checks, symbol tagging on a thrown object, or message parsing.

At the application boundary:

- `status: 'verified'` proceeds only after the result wrapper and nested claims pass the exact validation below;
- `status: 'invalid'` produces a fresh `OidcCallbackInvalidError`;
- `status: 'unavailable'` produces a fresh `OidcProviderUnavailableError`;
- a rejected OIDC-port promise, including an ordinary error, proxy, revoked proxy, primitive, thenable failure, or hostile prototype trap, produces a fresh `OidcCallbackInvalidError` without inspecting the rejection; and
- malformed exchange-result DTOs produce a fresh `OidcCallbackInvalidError`.

`completeOidcLogin` must use a parameterless `catch` for the port call. It must not use `instanceof` on the rejection and must never throw the original rejection or any value derived from it.

### 2. Timestamp representation

All timestamps crossing the affected application, persistence, session-context, and current-user DTO boundaries are immutable primitive strings in the exact canonical format:

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

The validator must require the existing domain canonical form: regex match, a finite parsed instant, and `new Date(value).toISOString() === value`. Invalid calendar values and `Invalid Date` fail closed. No affected DTO may contain a caller-owned `Date`.

Change `BeginOidcLoginResult.expiresAt` and `CompleteOidcLoginResult.absoluteExpiresAt` to canonical strings so public authentication results do not expose mutable `Date` values. API cookie code may construct a fresh local `Date` only after validating the canonical string and must not place that `Date` into another public DTO.

Clock values remain `Date` at the injected clock port, but must be snapshotted before dependency calls by the existing safe-Date pattern: reject proxy/revoked proxy, require exact `Date.prototype`, require zero own keys, call the captured intrinsic `Date.prototype.getTime`, require a finite value, create a fresh `Date`, and derive a canonical string with the captured intrinsic `toISOString`. Never call an overridden instance method.

### 3. Crypto error decision

`CryptoOperationError` remains publicly exported to avoid an unrelated public-export removal, but it becomes a parameterless fixed error:

```ts
export declare class CryptoOperationError extends Error {
  readonly name = 'CryptoOperationError';
  constructor();
}
```

Its only message is exactly `Cryptographic operation failed`. It exposes no operation, field, reason, cause, metadata, options, or arbitrary text. Replace every internal construction with `new CryptoOperationError()`.

Do not create a second public crypto error or a public finite discriminator. Internal diagnostic detail must not be attached to the error and must not include secret inputs. The existing export from `packages/infrastructure/src/auth/index.ts` remains.

## Exact affected contracts and closed key sets

Every object below must have exactly the listed own string keys, no symbol keys, no extra keys, no missing keys, and no inherited substitutes. Each listed property must be an own data property; accessors are prohibited. Object prototypes must be exactly `Object.prototype` or `null` unless a stricter type is explicitly stated. Optional semantic values are represented by required keys whose values may be `null`; they are never omitted or normalized from `undefined`.

### Consumed login transaction

Outer `ConsumedLoginTransactionDTO`, exactly six keys:

| Key                | Exact value contract                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| `id`               | canonical lowercase UUIDv7 string                                                    |
| `keyVersion`       | primitive string matching `^[A-Za-z0-9._-]{1,64}$`                                   |
| `returnTo`         | primitive string passing the existing canonical `validateReturnTo`; no normalization |
| `encryptedSecrets` | exact nested DTO below                                                               |
| `createdAt`        | canonical timestamp string                                                           |
| `expiresAt`        | canonical timestamp string                                                           |

Nested `EncryptedSecretsDTO`, exactly four keys:

| Key          | Exact value contract                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| `ciphertext` | genuine exact `Uint8Array`, independently copied, length at least 1                     |
| `iv`         | genuine exact `Uint8Array`, independently copied, exactly 12 bytes                      |
| `authTag`    | genuine exact `Uint8Array`, independently copied, exactly 16 bytes                      |
| `keyVersion` | primitive string matching the key-version regex and exactly equal to outer `keyVersion` |

Require `createdAt < expiresAt` and `createdAt <= callbackNow < expiresAt`. The application must preserve the validated timestamp strings; it must not replace them with placeholders. A malformed transaction produces a fresh `OidcCallbackInvalidError` before decrypt, provider, identity, or session calls.

### Decrypted login secrets

Exactly two keys:

- `pkceVerifier`: required primitive non-empty string;
- `nonce`: required primitive non-empty string.

Both values must be copied into a fresh frozen plain snapshot. Existing protocol-specific length/alphabet validation remains in the crypto/OIDC implementation and must not be weakened.

### Verified OIDC claims

Exactly four required keys:

- `issuer`: primitive non-empty string with no leading or trailing whitespace;
- `subject`: primitive non-empty string with no leading or trailing whitespace;
- `email`: primitive string or `null`;
- `displayName`: primitive string or `null`.

Missing `email` or `displayName` is invalid; the OIDC adapter is responsible for explicitly returning `null`. The application creates a fresh frozen claims snapshot, then creates the existing new null-prototype TASK-005 claims DTO. No SDK claims object crosses the boundary.

### OIDC exchange results

Exact variants:

- verified: exactly `status`, `claims`, with `status === 'verified'` and nested exact claims;
- invalid: exactly `status`, with `status === 'invalid'`;
- unavailable: exactly `status`, with `status === 'unavailable'`.

No variant accepts error text, cause, status code, response, body, metadata, or provider discriminator.

### Session candidate

`SessionSnapshotDTO` has exactly these 13 keys:

```text
id
userId
currentTokenHash
previousTokenHash
previousTokenValidUntil
createdAt
lastSeenAt
idleExpiresAt
absoluteExpiresAt
rotatedAt
revokedAt
revocationReason
version
```

Value contracts:

- `id` and `userId`: canonical lowercase UUIDv7 strings;
- `currentTokenHash`: exact independently copied `Uint8Array` of 32 bytes for an authenticatable candidate;
- `previousTokenHash`: `null` or an exact independently copied `Uint8Array` of 32 bytes;
- `previousTokenValidUntil`: canonical timestamp string or `null`;
- all five non-nullable timestamps: canonical timestamp strings;
- `revokedAt`: canonical timestamp string or `null`;
- `revocationReason`: `null` or one of `logout`, `user_unavailable`, `idle_expired`, `absolute_expired`;
- `version`: primitive number, safe integer, at least 1.

An authenticatable candidate must be active: `revokedAt === null`, `revocationReason === null`, and `currentTokenHash !== null`. Previous hash and previous-valid-until are both null or both non-null. Current and previous hashes, when both present, must differ.

Timestamp invariants are exact:

```text
createdAt <= rotatedAt <= lastSeenAt <= idleExpiresAt <= absoluteExpiresAt
createdAt < absoluteExpiresAt
```

When previous-token fields are present:

```text
rotatedAt <= previousTokenValidUntil <= absoluteExpiresAt
```

Absolute expiry is evaluated before idle expiry. All timestamps must validate before any expiry, rotation, touch, token-generation, user lookup, or mutation decision. No `NaN` comparison may reach session logic.

The candidate array must contain exactly one candidate for authentication. Zero, more than one, sparse, extra-keyed, symbol-bearing, accessor-backed, subclassed, proxied, revoked-proxy, or malformed candidates fail with a fresh `AuthenticationRequiredError` and no later calls, except the already-authorized revocation behavior for a well-formed expired or unavailable-user session.

### User snapshot used by session authentication

Exactly nine keys:

```text
id
identityProvider
identitySubject
email
displayName
status
createdAt
updatedAt
version
```

Value contracts:

- `id`: canonical lowercase UUIDv7;
- `identityProvider` and `identitySubject`: non-empty primitive strings with no leading or trailing whitespace;
- `email` and `displayName`: primitive string or `null`, required keys;
- `status`: exactly `active` for successful session authentication;
- `createdAt` and `updatedAt`: canonical timestamp strings with `createdAt <= updatedAt`;
- `version`: safe integer at least 1.

The returned user must be a new frozen object populated only from validated descriptor values. Never return or embed the port-owned object. The returned user `id` must exactly equal the session candidate `userId`; mismatch is authentication failure and triggers the existing `user_unavailable` revocation/scrub path inside the transaction.

### Authenticated session context

Outer context, exactly three required keys:

- `user`: the exact copied/frozen user snapshot above;
- `session`: exact nested session context below;
- `rotatedToken`: `null` or a canonical unpadded 32-byte base64url token of exactly 43 ASCII characters.

Nested session context, exactly four required keys:

- `id`: canonical lowercase UUIDv7;
- `userId`: canonical lowercase UUIDv7;
- `idleExpiresAt`: canonical timestamp;
- `absoluteExpiresAt`: canonical timestamp.

Require `session.userId === user.id` and `idleExpiresAt <= absoluteExpiresAt`. Authentication must construct this context entirely from validated copies and freeze the user, session, and outer context.

`getCurrentUser` must revalidate every required context descriptor, including `rotatedToken`, before calling the workspace port. Missing `email`, `displayName`, `rotatedToken`, session `id`, or session `userId` is invalid; no missing value may be normalized to `null`.

### Workspace summary result and items

`ActiveWorkspaceSummariesDTO` has exactly two required keys:

- `items`: exact genuine closed array described below, length `0..100` at the application port boundary;
- `hasMore`: primitive boolean.

Each `WorkspaceSummaryItemDTO` has exactly five keys:

- `id`: canonical lowercase UUIDv7;
- `name`: non-empty primitive string;
- `slug`: primitive string matching the existing canonical lowercase slug regex;
- `timezone`: non-empty primitive string;
- `role`: exactly `owner`, `editor`, or `viewer`.

The current-user output is a new deeply frozen snapshot with exact outer keys `user`, `session`, and `workspaceAccess`; exact user keys `id`, `email`, `displayName`; exact session keys `idleExpiresAt`, `absoluteExpiresAt`; and exact workspace-access keys `items`, `hasMore`. Every item is copied and frozen, and the items array is new and frozen. No returned nested object, array, byte view, or `Date` may alias a caller- or adapter-owned mutable value.

## Common hostile-input validation order

Implement shared narrow helpers where doing so removes divergent validation, but do not create a generic validation framework. For every affected non-primitive object, enforce this order inside a catch-all sanitizer that throws only the fixed error appropriate to that boundary:

1. primitive/null type gate without coercion;
2. proxy and revoked-proxy rejection using the existing trap-free `util.types.isProxy` pattern;
3. for arrays or typed arrays, genuine-brand check using the captured intrinsic;
4. exact prototype check;
5. `Reflect.ownKeys` and exact key-count/set validation, rejecting every symbol;
6. own property descriptor capture for every required key;
7. require data descriptors and reject getters/setters before taking values;
8. validate primitive types, canonical formats, finite numeric bounds, byte lengths, equality, and temporal/lifecycle invariants;
9. copy every accepted mutable value into new storage; and
10. freeze nested snapshots from the inside out.

No property read such as `value.key`, optional chaining, destructuring, spread, `in`, inherited lookup, `Object.assign`, JSON serialization, `String`, template interpolation, inspection, or logging is permitted before safe descriptor capture. Validation failure must not include the rejected value in an error.

## PostgreSQL result-wrapper contract

Create one infrastructure-auth helper for the three affected adapters. It must validate and snapshot a `DatabaseQueryResult` before an adapter accesses `result.rows`, `result.rowCount`, or `result.command`.

The query-result wrapper has exactly three own string keys and no symbols:

```text
rows
rowCount
command
```

Validation order:

1. require non-null object;
2. reject proxy/revoked proxy before any prototype or property operation;
3. require prototype exactly `Object.prototype` or `null`;
4. require exactly the three keys above;
5. capture all three own descriptors and require data descriptors;
6. require `rowCount` to be a primitive safe integer at least zero;
7. require `command` to be a primitive string;
8. pass only the captured `rows` descriptor value to genuine-array validation; and
9. return a fresh internal snapshot containing only captured primitives and captured row values.

For the affected SELECT/CTE reads, require `command === 'SELECT'` and `rowCount === validatedRows.length`. For mutation queries whose result is inspected, validate the same wrapper before inspecting `rowCount`, require the expected command (`INSERT` or `UPDATE`), validate a closed rows array, and apply the operation's existing exact row-count rule. Do not silently accept `rowCount: null`, a numeric string, an extra `fields` key, or a getter-backed wrapper.

A hostile wrapper fails with a fresh sanitized `DatabaseError` containing only fixed text. Its getters and traps must remain uncalled.

## Genuine-array contract and iteration

After the wrapper descriptor is captured, validate its `rows` value in this exact order:

1. require non-null object;
2. reject proxy/revoked proxy;
3. require `Array.isArray(rows) === true`;
4. require exact `Array.prototype` (reject subclasses and altered prototypes);
5. capture the own `length` descriptor, require a data descriptor, primitive safe integer, and operation-specific bound;
6. capture `Reflect.ownKeys(rows)` and require the exact set `0` through `length - 1` plus `length`, with no holes, symbols, extra strings, own `map`, own iterator, or other own methods;
7. capture each numeric index through `Object.getOwnPropertyDescriptor`, require an own data descriptor, and retain only its value; and
8. map the captured row values through the existing exact row mapper.

Operation-specific bounds:

- consumed login transaction rows: `0..1`;
- candidate session rows: `0..2`, preserving rejection when the application does not receive exactly one candidate;
- user lookup rows: `0..1` after rejecting a database result of two rows;
- workspace summary rows: `0..101`, map at most the first 100 and compute `hasMore` solely as `length === 101`.

Never invoke a method obtained from the untrusted array. In particular, do not use `.map`, `.forEach`, `.slice`, `.at`, `.entries`, `.values`, `.keys`, spread, `Array.from`, `for...of`, or the iterator protocol. Use a numeric `for` loop over the already captured length and captured own index descriptors. Methods on a newly allocated local trusted array are permitted, but direct indexed assignment is preferred until final freeze.

Apply this contract to:

- `postgres-session-adapter.ts` candidate-session rows and user rows;
- `postgres-login-transaction-adapter.ts` consumed-transaction rows; and
- `postgres-workspace-summary-adapter.ts` workspace rows.

The row objects continue to use exact closed mappers with these database key sets:

- session row: `id`, `user_id`, `current_token_hash`, `previous_token_hash`, `previous_token_valid_until`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `rotated_at`, `revoked_at`, `revocation_reason`, `version`;
- consumed transaction row: `id`, `key_version`, `return_to`, `secrets_ciphertext`, `secrets_iv`, `secrets_auth_tag`, `created_at`, `expires_at`;
- workspace summary row: `id`, `name`, `slug`, `timezone`, `role`; and
- session user row: `id`, `identity_provider`, `identity_subject`, `email`, `display_name`, `status`, `created_at`, `updated_at`, `version`.

Row mappers must verify exact keys, descriptors, canonical UUIDs/timestamps, nullable fields, versions, and lifecycle invariants and must return fresh frozen snapshots. `parseIsoTimestamp` must require round-trip canonical string equality; accepting a regex-shaped but noncanonical or invalid date is prohibited. PostgreSQL `Date` values may be accepted only through the existing safe intrinsic-copy path and must be converted immediately to canonical strings.

## Required implementation by file

### Application

Expected focused changes:

- `packages/application/src/auth/ports.ts`
  - add/export `OidcExchangeResult`;
  - change the OIDC exchange return signature;
  - retain exact DTO fields above.
- `packages/application/src/auth/complete-oidc-login.ts`
  - remove thrown-error classification;
  - validate the explicit exchange result;
  - preserve and validate consumed timestamps and key versions;
  - return canonical expiry string.
- `packages/application/src/auth/complete-oidc-login-snapshots.ts`
  - implement exact consumed-transaction, encrypted-secrets, exchange-result, claims, and decrypted-secret snapshots.
- `packages/application/src/auth/authenticate-session-candidate.ts`
  - enforce canonical UUIDs/timestamps and all candidate/user invariants;
  - return a copied frozen user rather than the input object.
- `packages/application/src/auth/authenticate-session.ts`
  - use only validated finite epoch values;
  - enforce user/session ID equality;
  - construct a deeply frozen independent context.
- `packages/application/src/auth/authenticate-session-types.ts`
  - keep the exact context key sets and canonical string timestamps.
- `packages/application/src/auth/get-current-user.ts`
  - require exact key counts and every required descriptor/value before the workspace call;
  - enforce equality and canonical values;
  - deep-copy/freeze the response.
- `packages/application/src/auth/begin-oidc-login.ts` and `complete-oidc-login-types.ts`
  - replace mutable public expiry `Date` outputs with canonical strings and safely snapshot the clock.
- `packages/application/src/auth/index.ts`
  - export the new result type and no disclosure-bearing surface.
- application auth tests listed below.

Use an additional focused helper file only if it centralizes canonical DTO/date/array validation without becoming a generic framework. Report it in the handoff.

### Infrastructure

Expected focused changes:

- `packages/infrastructure/src/auth/oidc-adapter.ts`
  - return the explicit exchange result;
  - never inspect an arbitrary caught value;
  - preserve exact issuer and verified-claim requirements.
- `packages/infrastructure/src/auth/postgres-session-adapter.ts`
  - validate wrappers/arrays before access;
  - remove `rawRows.map` and every untrusted iterator/method call;
  - preserve transaction-scoped `findUserById`.
- `packages/infrastructure/src/auth/postgres-login-transaction-adapter.ts`
  - use the shared exact wrapper/array snapshot.
- `packages/infrastructure/src/auth/postgres-workspace-summary-adapter.ts`
  - use the shared exact wrapper/array snapshot.
- `packages/infrastructure/src/auth/mapper-helpers.ts`, `session-mapper.ts`, `transaction-mapper.ts`, and `workspace-summary-mapper.ts`
  - enforce the canonical and lifecycle contracts above where not already enforced.
- one focused infrastructure-auth result validator helper, if needed.
- `packages/infrastructure/src/auth/crypto.ts`
  - make `CryptoOperationError` parameterless and replace all message-bearing construction.
- `packages/infrastructure/src/auth/index.ts`
  - retain the parameterless error export; do not export validation internals unless existing tests require a package-private direct import.
- infrastructure unit/integration tests listed below.

### API compatibility updates

Only narrow test/fake and expiry-string mapping updates required by the port changes are allowed in `apps/api/src/auth/*` and corresponding auth tests. Public routes, schemas, Problem Details bodies, cookies, OpenAPI, and documentation must remain unchanged.

### Generated declarations

Generated build output is verification evidence, not a committed source change unless the repository already tracks it. After build, emitted declarations must show:

```ts
export declare class CryptoOperationError extends Error {
  readonly name = 'CryptoOperationError';
  constructor();
}
```

They must also show `OidcProtocolPort.exchangeCodeAndValidateIdToken(...): Promise<OidcExchangeResult>`, the three finite result variants, canonical string expiry fields, and no error constructor or result variant accepting arbitrary message, cause, metadata, provider body, or options.

## Fixed public error mapping

The remediation must preserve these public mappings:

| Boundary outcome                                       | Fresh public/application error   | HTTP outcome                                                                |
| ------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------- |
| explicit validated OIDC `invalid`                      | `OidcCallbackInvalidError()`     | `400 OIDC_CALLBACK_INVALID`                                                 |
| explicit validated OIDC `unavailable`                  | `OidcProviderUnavailableError()` | `503 OIDC_PROVIDER_UNAVAILABLE`                                             |
| OIDC port rejection or malformed exchange result       | `OidcCallbackInvalidError()`     | `400 OIDC_CALLBACK_INVALID`                                                 |
| malformed consumed transaction/secrets/claims          | `OidcCallbackInvalidError()`     | `400 OIDC_CALLBACK_INVALID`                                                 |
| malformed session candidate/user/context/workspace DTO | `AuthenticationRequiredError()`  | `401 AUTHENTICATION_REQUIRED` where routed                                  |
| malformed PostgreSQL wrapper/array/row                 | fresh sanitized `DatabaseError`  | existing fixed internal/auth persistence mapping; never raw database detail |
| any crypto validation/operation failure                | `CryptoOperationError()`         | existing fixed caller mapping                                               |

No original unsafe value may be thrown or attached. Preserve the existing central API Problem Details fixed text. Do not add a provider or crypto detail field.

## Non-disclosure requirements

For every hostile test value and every failure path, none of the following may contain a sentinel or attacker-controlled content:

- `message`, `name`, `stack`, `cause`, enumerable or non-enumerable error fields;
- `String(error)`, template interpolation, `JSON.stringify`, `toJSON`, or structured serialization;
- `util.inspect`, console output, logger output, stdout, or stderr;
- thrown output, rejected output, unhandled-rejection output, or child-process termination output;
- Problem Details fields, headers, redirects, cookies, OpenAPI, or generated declarations.

All error objects exposed by these boundaries must be fresh fixed instances. All proxy trap, getter, `toString`, `valueOf`, `toJSON`, custom inspection, iterator, `Symbol.iterator`, array-hook, and prototype-trap counters must remain zero.

## Edge cases and adversarial matrices

For each affected object, test valid `Object.prototype` and null-prototype forms where allowed, then independently test:

- primitive, `null`, function, ordinary wrong prototype, inherited-only property, missing key, extra string key, symbol key;
- own getter, setter, throwing accessor, accessor returning a valid-looking value;
- ordinary proxy, revoked proxy, and proxy with throwing `getPrototypeOf`, `ownKeys`, `getOwnPropertyDescriptor`, `get`, or `has` traps;
- frozen, sealed, and mutable caller-owned inputs;
- mutation after the port resolves but before or after use-case completion where a controlled deferred test can expose aliasing;
- hostile `toString`, `valueOf`, `toJSON`, `inspect`, and iterator hooks;
- sparse arrays, arrays with extra indices, extra named keys, symbols, own `map`, own `forEach`, own iterator, subclass prototype, altered prototype, and array-like spoofed objects;
- invalid UUID versions, uppercase UUIDs, noncanonical UUIDs, and valid-looking wrong IDs;
- timestamp wrong types, omitted timestamps, invalid calendar dates, missing milliseconds, offsets, lowercase `z`, extra fractional precision, `Invalid Date`, hostile Date subclasses/proxies, and ordering violations;
- missing nullable fields versus explicit `null`, `undefined`, wrong primitive types, `NaN`, infinities, unsafe integers, zero/negative versions;
- mismatched transaction key versions, mismatched session/user IDs, equal current/previous hashes, half-present previous-token pairs, invalid revocation pairs, expired grace, and malformed active/revoked lifecycle;
- mutation of the original user, byte arrays, summary items, and source arrays after return, proving output remains unchanged and frozen.

### OIDC rejection matrix

Test the OIDC port rejecting each of:

- ordinary `Error` with sentinel message;
- application error instance;
- primitive string/symbol/bigint;
- object with hostile getters and conversion hooks;
- proxy with every relevant trap;
- revoked proxy; and
- a proxy whose `getPrototypeOf` trap throws `Error('SENTINEL_PROVIDER_ERROR')`.

Every case must produce a fresh fixed `OidcCallbackInvalidError`, execute zero traps/hooks, leak no sentinel, and perform zero identity and session calls. Separately test validated explicit `unavailable` produces a fresh fixed `OidcProviderUnavailableError`.

### PostgreSQL matrix

Run the wrapper/array matrix independently against candidate sessions, user lookup, consumed transactions, and workspace summaries. Include the exact regression where a genuine exact-prototype array has an own `map` function. Its counter must remain zero and the adapter must reject it.

Also include hostile result wrappers with a `rows` getter. The getter counter must remain zero because validation examines its descriptor and rejects the accessor without reading it.

## Test plan

### Application unit tests

Add focused tests that prove:

1. provider outcome union validation and fixed error mapping;
2. all hostile OIDC rejections remain uninspected with zero traps and zero sentinel disclosure;
3. consumed transaction exact descriptors, canonical timestamps, time-window invariant, exact key-version equality, byte copies, and frozen snapshots;
4. session candidate canonical timestamp and lifecycle matrix fails before user lookup, token generation, rotate, touch, or revoke unless a well-formed expiry specifically requires revocation;
5. user snapshot validation copies/freezes every field and enforces `session.userId === user.id`;
6. current-user context requires all 3/9/4 keys and valid values before workspace lookup;
7. workspace summaries and final output are exact, deeply copied, and deeply frozen;
8. mutable-alias tests mutate all source objects/arrays/bytes after resolution and cannot affect returned state;
9. malformed dates never authenticate, rotate, touch, or return an invalid expiry; and
10. the callback mutual-exclusivity/control-character tests still prove zero hashing and zero consumption.

### Infrastructure unit tests

Add focused tests that prove:

1. each affected adapter validates the result wrapper before `rows` access;
2. exact wrapper keys/descriptors, command, rowCount, and rowCount/length consistency;
3. the full genuine-array matrix and operation-specific length bounds;
4. no array method or iterator is invoked, including the own-`map` reproduction;
5. row mappers reject noncanonical timestamps and preserve existing UUID, byte-copy, key, nullable, role, version, and lifecycle checks;
6. the OIDC adapter returns only fresh exact result variants and uses parameterless catches for opaque library failures;
7. `new CryptoOperationError()` has the fixed safe message; TypeScript rejects a message/cause/metadata argument; and
8. direct runtime attempts such as `new (CryptoOperationError as unknown as new (x: unknown) => Error)('SENTINEL')` do not retain or expose the argument on any surface.

### Child-process security tests

Use the repository's existing child-process sentinel pattern to cover at least:

- hostile OIDC rejection;
- hostile PostgreSQL wrapper and own-array-hook rejection;
- direct crypto error construction with a sentinel argument through an unsafe cast; and
- malformed DTO/date rejection.

Capture stdout, stderr, uncaught exception, unhandled rejection, stack, JSON, string conversion, inspection, and logger surfaces. Assert the child exits only in the expected controlled manner and the sentinel is absent everywhere.

### Real PostgreSQL integration tests

Using the guarded disposable PostgreSQL harness:

- prove the remediated adapters still accept genuine `DatabaseQueryResult` wrappers produced by the real database layer;
- prove consumed transaction mapping preserves canonical `createdAt` and `expiresAt` rather than empty strings;
- prove canonical session/user/workspace values still map and freeze correctly;
- prove invalid persisted timestamp/lifecycle data fails closed where database constraints permit constructing it;
- retain atomic transaction consumption, secret scrubbing, replay rejection, session rotation/touch/revocation, workspace `LIMIT 101`, and stable ordering tests;
- retain mandatory transaction-scoped `findUserById` with `poolMax=1`, including authenticate, touch, rotate, previous-token grace, and inactive-user revocation without pool starvation; and
- make no external identity-provider calls.

No migration change is required or authorized.

## Regression requirements

### Callback mutual exclusivity and zero consumption

Retain and extend the existing tests proving all of the following fail before hashing and before `consumePendingTransaction`:

- both `code` and `error` present;
- success shape containing denial-only fields;
- denial shape containing `code`;
- missing/duplicate/array/empty fields;
- decoded C0/DEL controls; and
- hostile query objects, accessors, symbols, proxies, and revoked proxies.

### Transaction-scoped user lookup with `poolMax=1`

Retain the unit proof that only `txStore.findUserById` is invoked and root `sessionStore.findUserById` has zero calls. Retain the real PostgreSQL `poolMax=1` lifecycle proof. Do not introduce a root-store fallback, nested pool query, retry loop, or query outside the existing authentication transaction.

## Security and implementation constraints

- Do not inspect an arbitrary caught value to improve error classification.
- Do not use `instanceof` on values received or rejected from ports, SDKs, fakes, query runners, or caller inputs.
- Intrinsic brand/prototype checks are permitted only after proxy rejection and only in the prescribed order.
- Do not use JSON cloning; it invokes hooks, loses types, and normalizes malformed values.
- Do not freeze caller-owned objects as a substitute for copying.
- `Object.freeze` on a wrapper does not freeze a nested object or typed-array bytes; copy nested state explicitly.
- Do not expose validation helpers as new public API without a concrete existing consumer.
- Do not change SQL semantics, migrations, tables, indexes, route schemas, cookies, Problem Details codes, OpenAPI, dependencies, or configuration.
- Do not weaken TASK-005 validation or route errors through raw identity/database/provider errors.
- Do not add a generic repository, validation framework, auth framework, or provider-specific abstraction.

## Database changes

None. Do not add, edit, reorder, or regenerate migrations. Do not change the schema or SQL behavior beyond result validation necessary to consume the existing query outputs safely.

## API changes

No public HTTP change. The four routes, status codes, bodies, headers, cookies, rate limits, redirects, and Problem Details codes remain exactly as approved in TASK-006 and committed OpenAPI.

The application/infrastructure OIDC port signature changes internally to the explicit result union. Expiry fields in application use-case results become canonical strings; API behavior remains identical.

## Frontend changes

None.

## Backend changes

Only the focused application, infrastructure, API mapping/fake, generated declaration verification, and tests enumerated above. No worker behavior changes.

## Expected files

Production changes are expected only in the affected files enumerated under Required implementation by file and, if justified, one focused application helper and one focused infrastructure helper. Test changes are expected only in relevant application auth, infrastructure auth, API auth, child-process security, and real PostgreSQL integration tests.

Do not modify migrations, dependencies, lockfiles, environment files, general documentation, OpenAPI, workflows, unrelated packages, plans, or reports. If implementation proves another production file is necessary, stop and report the exact dependency before changing it.

## Every TASK-006 verification and security gate

Before requesting Codex review, Antigravity must run the complete TASK-006 gate set against the final exact SHA and report command, exit status, and relevant summary:

1. `corepack pnpm install --frozen-lockfile`
2. `corepack pnpm env:local`
3. `docker compose config --quiet` with required validation environment
4. `corepack pnpm verify:infrastructure-pins`
5. start the pinned PostgreSQL image and wait for health
6. `corepack pnpm db:migrate:validate`
7. `corepack pnpm test:integration`
8. `corepack pnpm format:check`
9. `corepack pnpm lint:boundaries`
10. `corepack pnpm lint`
11. `corepack pnpm typecheck`
12. `corepack pnpm test`
13. `corepack pnpm build`
14. deterministic OpenAPI drift check
15. `corepack pnpm check`
16. `corepack pnpm audit --prod --audit-level high`
17. `corepack pnpm verify:trivy-exception`
18. pinned-image manifest inspection
19. both required Trivy scans and the no-ignore negative control
20. API and worker smoke tests
21. infrastructure shutdown in `finally`
22. `git diff --check origin/main...HEAD`
23. clean-checkout verification in a temporary directory with no copied `.env`, `node_modules`, build output, database, or cached generated OpenAPI
24. final working-tree status and exact local/remote/PR SHA agreement

Additionally report focused commands for all new application, infrastructure, child-process, declaration, and real-PostgreSQL tests. Inspect emitted declarations after the final build. Do not claim any skipped or unavailable gate passed; report the reason and residual risk.

## Acceptance criteria

1. `completeOidcLogin` applies no `instanceof`, property read, prototype operation, conversion, inspection, serialization, or logging to an OIDC-port rejection.
2. Ordinary errors, primitives, proxies, revoked proxies, and hostile prototype traps rejected by the OIDC port all produce fresh fixed safe errors; every hostile counter remains zero and no sentinel appears on any output surface.
3. A trusted provider-unavailable condition crosses the port only as the exact validated `status: 'unavailable'` result and maps to a fresh `OidcProviderUnavailableError`.
4. Every affected DTO has its exact closed key set, own data descriptors, required nullable fields, canonical values, and independent frozen snapshot.
5. Consumed transaction `createdAt`, `expiresAt`, and both key-version fields are validated and preserved; no placeholder timestamp remains.
6. All affected timestamps are canonical UTC strings; malformed/invalid dates fail before later dependency calls and cannot bypass expiry, rotation, grace, or touch checks.
7. Session and user IDs are canonical UUIDv7 strings, session/user IDs match exactly, and mismatches follow fixed authentication failure and scrub behavior.
8. Authentication returns a copied frozen user and deeply frozen context; current-user output shares no mutable nested state with any caller or adapter input.
9. Current-user validation rejects every missing required context/user/session field before workspace lookup; it never normalizes omission or `undefined` to `null`.
10. Each affected PostgreSQL adapter validates the exact result wrapper before reading `rows` and validates rows in the prescribed proxy, genuine-array, prototype, descriptor/key order.
11. Sparse arrays, symbols, extra keys, own methods, accessors, subclasses, proxies, revoked proxies, hostile wrappers, and invalid row counts are rejected with fixed sanitized errors.
12. No method or iterator from a query-result array is invoked; the own-`map` reproduction has `mapHookCount === 0` and is rejected.
13. Row objects retain exact key sets and canonical UUID/timestamp/lifecycle validation, and mapped outputs are copied/frozen.
14. `CryptoOperationError` remains public only with `constructor()`, exact fixed message `Cryptographic operation failed`, and no arbitrary message/cause/metadata in source or emitted declarations.
15. Direct sentinel construction through an unsafe runtime cast proves zero disclosure from crypto errors.
16. Child-process tests prove zero sentinel disclosure through stdout, stderr, stack, string, JSON, inspection, logging, uncaught exceptions, and unhandled rejections.
17. Callback mutual exclusivity and invalid-control cases continue to perform zero hashing and zero transaction consumption.
18. Session authentication continues to use mandatory transaction-scoped `findUserById`; the real `poolMax=1` lifecycle test passes without starvation.
19. Real PostgreSQL login-transaction, session, user, and workspace results remain accepted and all TASK-006 concurrency, replay, scrubbing, expiry, rotation, touch, and `LIMIT 101` behavior remains correct.
20. Public HTTP/OpenAPI/database/configuration/dependency behavior is unchanged.
21. All TASK-006 verification, security, clean-checkout, exact-SHA, and status gates are run and honestly reported.
22. The final implementation diff contains no unrelated changes.

## Out of scope

- New routes, schemas, cookies, Problem Details codes, database columns, constraints, migrations, indexes, dependencies, or configuration.
- Frontend, worker, vendor-specific OIDC behavior, provider selection, social OAuth, authorization, workspace mutation, Redis, KMS, hosting, retention jobs, or deployment.
- Replacing `openid-client`, custom JWT verification, user-info, refresh tokens, provider logout, new telemetry, or new public diagnostics.
- Redesigning TASK-005 identity resolution, session concurrency SQL, transaction consumption SQL, rate limiting, OpenAPI, or documentation.
- General hardening of unrelated database/tenancy adapters. Only shared helpers already used by the affected auth adapters may be touched.
- Formatting churn, broad refactors, test rewrites unrelated to these findings, or changes to prior task specifications.

## Implementation sequence

1. Re-read `AGENTS.md`, `TASK-006.md`, this remediation, relevant docs, actual source/tests/declarations, and confirm the implementation baseline SHA.
2. Add focused failing reproductions for all four findings, including exact trap/hook/sentinel counters.
3. Change the application OIDC port to the explicit result union and update adapter/fakes without inspecting arbitrary rejections.
4. Implement exact DTO/date/UUID/copy/freeze validation and update authentication/current-user orchestration.
5. Implement shared PostgreSQL result-wrapper and genuine-array snapshot validation; migrate all three affected adapters and remove untrusted methods/iterators.
6. Make `CryptoOperationError` parameterless and update crypto tests.
7. Run focused unit and child-process suites.
8. Run real PostgreSQL tests, including the two prior-finding regressions.
9. Run the complete TASK-006 verification and clean-checkout gates on the final exact SHA.
10. Provide the handoff evidence below and request Codex review.

## Implementation handoff evidence

Antigravity must provide all of the following before Codex review:

- baseline SHA, final local SHA, remote branch SHA, and PR-head SHA;
- exact `origin/main...HEAD` file list and diff summary;
- every modified/created/deleted file with reason, including confirmation that no migration, dependency, lockfile, OpenAPI, or documentation changed;
- source excerpts and emitted declaration excerpts for `OidcExchangeResult`, `OidcProtocolPort`, expiry strings, and parameterless `CryptoOperationError`;
- a table of every exact DTO key set, nullable field, UUID/timestamp rule, invariant, snapshot/copy rule, and fixed failure mapping implemented;
- the exact OIDC adapter/application call-order and rejection-classification matrix, showing parameterless catches and zero inspection;
- the exact PostgreSQL wrapper/array validation order and operation-specific row bounds;
- evidence that no adapter invokes an untrusted array method or iterator, including the own-`map` counter result;
- before/after results for all four exact reproductions from the review;
- trap/getter/hook counters and child-process sentinel results for every required output surface;
- mutable-alias evidence for user, context, summaries, arrays, and bytes;
- proof of callback mutual exclusivity with zero hashing/consumption;
- proof of transaction-scoped user lookup with zero root lookup and real `poolMax=1` completion;
- real PostgreSQL results for consumption/scrubbing, session lifecycle/concurrency, workspace limit/order, and canonical timestamp preservation;
- every focused and full verification command with exit status and summary, tied to the final exact SHA;
- all skips, limitations, warnings, or deviations with risk; and
- final clean working-tree status.

Codex will review the user requirement, TASK-006, this remediation, actual code and diffs, tests, declarations, hostile reproductions, real PostgreSQL behavior, and exact-SHA verification. An implementation summary is not proof. The feature remains unapproved until Codex explicitly returns `STATUS: APPROVED`.
