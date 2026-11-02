# TASK-006 - Managed OIDC Login, Server Sessions, and Current-User HTTP Boundary

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: clean `origin/main` at or after merged TASK-005 commit `783710fd01b3911f511cd29eeb0126f45ca36472`

## Objective

Implement the first complete browser-authentication slice for Affiliate Content OS:

1. start a provider-neutral managed-OIDC authorization-code flow;
2. validate the callback with discovery, issuer, signature, audience, time, state, PKCE, nonce, and same-browser binding;
3. adapt only verified OIDC claims into the already-approved TASK-005 identity-provisioning boundary;
4. create, authenticate, rotate, expire, and revoke an opaque server-side application session;
5. expose `GET /auth/login`, `GET /auth/callback`, `GET /api/v1/me`, and `POST /api/v1/logout`; and
6. return the signed-in application user, safe session metadata, and bounded active-workspace summaries.

This is an authentication and session task. It is not a general authorization, workspace-management, frontend, social OAuth, or production-hosting task.

## Context and governing decisions

TASK-005 is merged and provides the exact, adversarially hardened `resolveVerifiedIdentity` boundary. It accepts only a narrow, already-verified plain DTO, keys users by exact OIDC issuer/provider plus subject, provisions at most one user, rejects inactive users, and returns an immutable application principal. TASK-006 must call that boundary; it must not duplicate or weaken it.

The approved architecture requires:

- managed OIDC for application identity;
- authorization-code flow with server-side token exchange;
- application sign-in kept separate from Threads/TikTok OAuth;
- secure HttpOnly application-session cookies;
- PostgreSQL as the authoritative session and one-time-login-transaction store;
- exact issuer plus stable subject identity, never email identity;
- PKCE, state, nonce, exact redirect URIs, and one-time callback processing;
- versioned REST, runtime validation, OpenAPI, and RFC 9457 Problem Details;
- closed-by-default CORS and CSRF defenses for cookie-authenticated mutations; and
- safe errors and logs that do not expose tokens, claims, cookies, identity metadata, SQL, or provider bodies.

### Resolved scope decision for this task

The Product Owner approved a standards-based, provider-neutral OIDC adapter. This task may use the official `openid-client` standards library, but it must not add Auth0-, Okta-, Cognito-, Clerk-, Firebase-, Supabase-, Azure-, Google-, or other vendor-specific SDKs, endpoints, claims, actions, or configuration.

The configured OIDC issuer is the application identity provider key passed to TASK-005. The OIDC vendor and enabled sign-in methods remain deployment choices. Selecting a vendor is not required to implement or test this task.

### Decisions that remain unresolved and must not be guessed

- the production managed-OIDC vendor and enabled passwordless/social/enterprise sign-in methods;
- public production domains, reverse-proxy topology, load-balancer trust, and replica count;
- the production distributed rate-limit store;
- key-management-service vendor and automated key rotation;
- exact authentication/session retention periods required by the future privacy jurisdiction;
- frontend login/error/onboarding UX; and
- step-up authentication policy for future privileged actions.

This task defines portable interfaces around those choices. If implementation needs a vendor-specific behavior, public hosting assumption, cross-origin browser design, or distributed store to continue, stop and report the dependency instead of inventing one.

## Required implementation

### 1. Architecture and dependency direction

Preserve the modular-monolith direction:

```text
packages/domain
  <- packages/application
  <- packages/infrastructure
  <- apps/api

apps/web and apps/worker do not participate in TASK-006.
```

Responsibilities are exact:

- `domain`: immutable session/current-user value types only when they are genuinely framework-free;
- `application`: authentication/session ports, typed safe errors, use-case orchestration, and result validation;
- `infrastructure`: PostgreSQL login-transaction/session/workspace-summary adapters, OIDC protocol adapter, AES-256-GCM protector, SHA-256 hashing, and cryptographically secure random bytes;
- `apps/api`: Fastify cookies, route schemas, rate limits, request/response mapping, Problem Details, lifecycle composition, and response headers;
- `packages/config`: fail-fast authentication configuration and redacted metadata only.

Do not create a generic repository, ORM, service locator, ambient request context, global mutable singleton, generic OAuth abstraction, provider SDK wrapper, JWT/session middleware hidden outside the composition root, or second database/clock/ID abstraction.

### 2. Pinned protocol and HTTP dependencies

Add only these runtime dependencies, pinned exactly rather than with `^` or `~`:

- `openid-client` `6.8.8` for OIDC discovery and authorization-code response/token/ID-token validation;
- `@fastify/cookie` `11.1.5` for cookie parsing and serialization; and
- `@fastify/rate-limit` `11.2.1` for bounded per-process endpoint rate limits.

If the test OIDC issuer needs signing/JWKS support, `jose` `6.2.12` may be added as an exact dev dependency only. Production code must not use `jose` to reimplement verification already owned by `openid-client`.

These versions were verified from their official release repositories on 2026-11-02. If frozen installation proves an incompatibility, report it before changing a version. Do not add Passport, NextAuth/Auth.js, Lucia, Express session, Redis, an ORM, or a vendor SDK.

### 3. Authentication configuration

Add a separate `AuthConfig` and `loadAuthConfig` surface. Do not put secrets into redacted `AppConfig` metadata. Required fields and behavior:

```ts
export interface AuthConfig {
  readonly enabled: boolean;
  readonly issuer: string | null;
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly redirectUri: string | null;
  readonly transactionEncryptionKeyBase64Url: string | null;
  readonly transactionKeyVersion: string | null;
  readonly transactionTtlSeconds: number;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly sessionRotationSeconds: number;
  readonly sessionRotationGraceSeconds: number;
  readonly sessionTouchIntervalSeconds: number;
  readonly cookieSecure: boolean;
}
```

Environment contract:

| Variable                              | Rule                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_ENABLED`                        | Exact `true` or `false`; default `false` outside production; production requires exact `true`.                                                              |
| `OIDC_ISSUER`                         | Required when enabled; absolute URL; HTTPS outside test/local loopback; no credentials, query, or fragment; preserve the exact validated issuer identifier. |
| `OIDC_CLIENT_ID`                      | Required non-empty exact string when enabled; surrounding whitespace rejected.                                                                              |
| `OIDC_CLIENT_SECRET`                  | Required non-empty exact string when enabled; never logged, serialized, returned, or included in redacted metadata.                                         |
| `OIDC_REDIRECT_URI`                   | Required when enabled; absolute URL; path exactly `/auth/callback`; no credentials, query, or fragment; HTTPS outside test/local loopback.                  |
| `AUTH_TRANSACTION_ENCRYPTION_KEY`     | Required when enabled; canonical unpadded base64url encoding of exactly 32 random bytes; retained as an immutable secret string in config.                  |
| `AUTH_TRANSACTION_KEY_VERSION`        | Required safe identifier matching `^[A-Za-z0-9._-]{1,64}$`; not a secret.                                                                                   |
| `AUTH_TRANSACTION_TTL_SECONDS`        | Default `600`; accepted range `120..900`.                                                                                                                   |
| `AUTH_SESSION_IDLE_TTL_SECONDS`       | Default `1800`; accepted range `300..3600`.                                                                                                                 |
| `AUTH_SESSION_ABSOLUTE_TTL_SECONDS`   | Default `28800`; accepted range `3600..86400`; must be greater than idle TTL.                                                                               |
| `AUTH_SESSION_ROTATION_SECONDS`       | Default `900`; accepted range `300..1800`; must be less than idle TTL.                                                                                      |
| `AUTH_SESSION_ROTATION_GRACE_SECONDS` | Default `30`; accepted range `5..120`; must be less than rotation interval.                                                                                 |
| `AUTH_SESSION_TOUCH_INTERVAL_SECONDS` | Default `300`; accepted range `60..600`; must be less than idle TTL.                                                                                        |

`cookieSecure` is derived: always `true` in production and `false` only in development/test. No environment switch may weaken it in production.

The infrastructure protector decodes the validated key once into its own private byte copy. It never returns that copy, and it zeroes temporary decoded buffers where the runtime permits. No mutable key buffer is exposed through a public configuration or adapter API.

The existing `APP_BASE_URL` becomes required whenever auth is enabled. It must be an absolute URL without credentials, query, or fragment; production requires HTTPS. It is the only base used for successful post-login redirects. Auth configuration must not infer it from request headers.

When auth is disabled, issuer/client/secret/redirect/key values must remain `null`, no discovery request is made, and auth/current-user routes return one fixed `503 AUTH_NOT_CONFIGURED` Problem Details response. This mode exists only so the existing local process shell can boot before a developer supplies a managed issuer. It is not an authentication bypass and is forbidden in production.

`getRedactedAuthConfigMetadata` may expose only `enabled`, booleans indicating whether required values exist, non-secret TTLs, `cookieSecure`, and `transactionKeyVersion`. It must not expose the issuer, client ID, client secret, redirect URI, encryption key, decoded bytes, cookie values, or derived hashes.

Update `.env.example` with `AUTH_ENABLED=false` and documented placeholders only. Do not commit any usable client secret or encryption key. `pnpm env:local` must preserve existing user values and must not generate or print secrets unless an explicit, documented local-only command is added and tested.

### 4. OIDC protocol adapter

Implement one provider-neutral adapter using `openid-client` public APIs. The adapter owns discovery and protocol verification; the application layer never imports the library.

#### Startup/discovery

- When auth is enabled, discovery is a required API startup dependency.
- Apply a bounded timeout no greater than five seconds and abort cleanly during startup shutdown.
- Require discovery metadata `issuer` to equal the configured issuer identifier exactly. Do not silently normalize aliases or accept an unexpected tenant.
- Require authorization endpoint, token endpoint, and JWKS/signing capability needed for an ID token.
- Use confidential-client authentication with `client_secret_basic` for this MVP. If the chosen provider cannot support it, that is a Product Owner decision, not an implementation fallback.
- Use scopes exactly `openid profile email`.
- Do not enable dynamic client registration, device flow, implicit/hybrid flow, password grant, refresh-token flow, token introspection, user-info fallback, logout-provider calls, or provider-specific parameters.

#### Login-start material

Generate with cryptographically secure randomness:

- state: 32 bytes, unpadded base64url;
- browser-binding secret: 32 bytes, unpadded base64url;
- nonce: at least 32 bytes of entropy, unpadded base64url; and
- PKCE verifier: valid high-entropy S256 verifier generated through the library-supported primitive.

Persist only hashes/encrypted material described below. Build the provider authorization URL with exact configured redirect URI, exact scopes, state, nonce, `code_challenge`, and `code_challenge_method=S256`. Do not accept caller-supplied issuer, client ID, redirect URI, scope, response type, prompt, connection, audience, organization, or provider parameter.

#### Callback verification order

The callback must fail closed in this order:

1. validate the query object without coercion as exactly one of two shapes: success has one non-empty `code` and one non-empty `state`; denial has one non-empty `error`, one non-empty `state`, and only optional single-string `error_description`/`error_uri`; bound every field length and never reflect or log denial fields;
2. validate the transaction cookie as an exact 32-byte base64url value;
3. SHA-256 hash state and browser binding;
4. atomically locate, lock, consume, and scrub exactly one pending unexpired transaction matching both hashes;
5. if the parsed shape is denial, stop with one fixed callback-invalid outcome after the transaction has been consumed and scrubbed; perform no decrypt, token exchange, identity lookup, or session creation;
6. decrypt the PKCE verifier and nonce with the configured key version and authenticated additional data;
7. exchange the code server-side using the exact configured redirect URI and recovered PKCE verifier;
8. require and validate an ID token through `openid-client`, including issuer, signature, audience/client, expiration, applicable issued-at checks, nonce, and authorization-code response checks;
9. extract only `iss`, `sub`, optional `email`, and optional display name from verified claims without string coercion or broad enumeration;
10. construct a new plain null-prototype DTO with own data properties only and pass it to `resolveVerifiedIdentity`; and
11. create an application session only after TASK-005 returns an active principal.

Use verified `iss` only after requiring it to equal configured/discovered issuer exactly. `sub` must be a non-empty string with no surrounding whitespace. Optional email and name are metadata only. Pass `email` only when it is a primitive string and the verified ID-token claim `email_verified` is exactly boolean `true`; otherwise pass `null`. Prefer primitive-string `name` for `displayName`; do not concatenate other claims, call `userinfo`, or infer identity from email. `email_verified` affects only whether optional email metadata is retained and never identity lookup, linking, uniqueness, recovery, session handling, or authorization.

Never pass the token-set object, ID token, decoded arbitrary claims object, request, query, cookie, provider error, SDK object, or proxy into TASK-005. Do not store access tokens, refresh tokens, ID tokens, authorization codes, full callback URLs, raw state, raw nonce, raw verifier, or raw browser-binding values.

### 5. One-time OIDC login transactions

Add migration `0003_application_auth.sql` with an `oidc_login_transactions` table. The exact logical columns are:

| Column                 | Type                        | Contract                                                                                            |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`                   | `UUID PRIMARY KEY`          | Generated UUIDv7.                                                                                   |
| `state_hash`           | `BYTEA NOT NULL UNIQUE`     | Exactly 32 bytes, SHA-256 of raw state.                                                             |
| `browser_binding_hash` | `BYTEA NOT NULL`            | Exactly 32 bytes, SHA-256 of the transaction cookie.                                                |
| `secrets_ciphertext`   | `BYTEA NULL`                | AES-256-GCM ciphertext for a versioned `{pkceVerifier, nonce}` payload; present only while pending. |
| `secrets_iv`           | `BYTEA NULL`                | Exactly 12 random bytes while pending.                                                              |
| `secrets_auth_tag`     | `BYTEA NULL`                | Exactly 16 bytes while pending.                                                                     |
| `key_version`          | `TEXT NOT NULL`             | Safe configured key identifier.                                                                     |
| `return_to`            | `TEXT NOT NULL`             | Validated local path, maximum 2048 characters.                                                      |
| `status`               | `TEXT NOT NULL`             | Exact `pending` or `consumed`.                                                                      |
| `created_at`           | `TIMESTAMPTZ NOT NULL`      | Canonical creation instant.                                                                         |
| `expires_at`           | `TIMESTAMPTZ NOT NULL`      | Creation plus configured transaction TTL.                                                           |
| `consumed_at`          | `TIMESTAMPTZ NULL`          | Set exactly once during callback consumption.                                                       |
| `version`              | `BIGINT NOT NULL DEFAULT 1` | Positive row version.                                                                               |

Required constraints:

- fixed hash/IV/tag lengths;
- `expires_at > created_at`;
- pending rows have all encrypted fields and no `consumed_at`;
- consumed rows have `consumed_at`, have all encrypted fields set to `NULL`, and satisfy `created_at <= consumed_at`;
- safe non-empty `key_version` and return path;
- positive version; and
- an index supporting pending-expiry lookup/maintenance without weakening uniqueness.

Encrypt one canonical versioned payload with Node's AES-256-GCM. Authenticated additional data is exact UTF-8 `acos:oidc-login:v1:<transaction-id>:<key-version>`. The JSON/plaintext must be created from already-validated primitive strings and must never be logged.

Callback consumption must be one PostgreSQL transaction using a locking CTE or equivalent exact atomic operation. It must return the pre-scrub encrypted values while changing the same row to `consumed`, setting `consumed_at`, and nulling ciphertext/IV/tag. A second callback, wrong browser cookie, expired row, missing row, duplicate/impossible result, malformed row, decryption failure, or key-version mismatch returns the same fixed safe callback error and performs no token exchange, identity lookup, or session creation.

Do not hold a database transaction open during discovery, redirect, token exchange, identity provisioning, or any provider network call.

### 6. Opaque server-side application sessions

The browser cookie contains one unpadded base64url 32-byte random token and nothing else. It is not a JWT, signed user object, encrypted principal, database ID, or provider token. PostgreSQL stores only SHA-256 hashes.

Add `application_sessions` in migration `0003_application_auth.sql` with:

| Column                       | Type                                                    | Contract                                                                                             |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                         | `UUID PRIMARY KEY`                                      | Generated UUIDv7; never sent to the browser or API response.                                         |
| `user_id`                    | `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT` | Application user.                                                                                    |
| `current_token_hash`         | `BYTEA NULL`                                            | Exactly 32 bytes while active; unique through a partial unique index.                                |
| `previous_token_hash`        | `BYTEA NULL`                                            | Prior hash during the short rotation grace only; partial unique index.                               |
| `previous_token_valid_until` | `TIMESTAMPTZ NULL`                                      | Present only with previous hash and never after absolute expiry.                                     |
| `created_at`                 | `TIMESTAMPTZ NOT NULL`                                  | Session creation.                                                                                    |
| `last_seen_at`               | `TIMESTAMPTZ NOT NULL`                                  | Bounded-touch instant.                                                                               |
| `idle_expires_at`            | `TIMESTAMPTZ NOT NULL`                                  | Sliding idle expiry capped by absolute expiry.                                                       |
| `absolute_expires_at`        | `TIMESTAMPTZ NOT NULL`                                  | Never extended.                                                                                      |
| `rotated_at`                 | `TIMESTAMPTZ NOT NULL`                                  | Last successful current-token rotation.                                                              |
| `revoked_at`                 | `TIMESTAMPTZ NULL`                                      | Set once on logout/inactive/expired invalidation.                                                    |
| `revocation_reason`          | `TEXT NULL`                                             | Exact safe enum `logout`, `user_unavailable`, `idle_expired`, or `absolute_expired`; never returned. |
| `version`                    | `BIGINT NOT NULL DEFAULT 1`                             | Increment on mutation.                                                                               |

Required constraints cover hash lengths, timestamp ordering, active-versus-revoked field consistency, previous-token pair consistency, allowed reason values, and positive version. Revocation must atomically set both token hashes and grace timestamp to `NULL` so a revoked cookie cannot match again.

#### Session creation

- Generate one UUIDv7 ID and one 32-byte random token only after a principal is active.
- Insert one active session with `created_at = last_seen_at = rotated_at`, configured idle expiry, and configured absolute expiry.
- Return the raw token only to the API cookie mapper; no lower layer may retain or log it.
- A malformed/duplicate persistence result fails closed, clears any transaction cookie, and sets no session cookie.

#### Authentication and exact expiry precedence

For every session-authenticated route:

1. read the named session cookie only;
2. validate exact base64url alphabet, unpadded canonical form, decoded length 32, and no extra/coercing value;
3. hash it with SHA-256;
4. query/lock at most two rows matching current hash or still-valid previous hash;
5. reject zero, multiple, malformed, revoked, or inconsistent rows with one fixed `AuthenticationRequiredError`;
6. check absolute expiry first, then idle expiry; atomically revoke/scrub an expired row;
7. load and validate the exact user snapshot by `user_id`; if absent, disabled, or deletion-pending, revoke/scrub and return the same authentication-required result;
8. accept a valid previous token only during its grace window and never rotate from it;
9. for a valid current token due for rotation, generate a new token and atomically move current hash to previous, set grace, install the new current hash, update `rotated_at`, and increment version; and
10. touch `last_seen_at` and sliding idle expiry only when the touch interval elapsed, always capped at absolute expiry.

The row lock/compare conditions must make concurrent requests safe: at most one current-token request rotates; a request waiting with the old token may authenticate through the newly created previous-token grace but must not rotate again or overwrite the browser's new cookie. No retry loop and no unbounded transaction are allowed.

All time comparisons use an injected `ClockPort` instant passed as SQL data. Do not use JavaScript truthiness, database `now()` mixed with application time, string time comparison, or mutable driver `Date` values as public snapshots.

### 7. Cookies

Cookie names are fixed constants:

- transaction: `acos_oidc_transaction`;
- application session: `acos_session`.

Both cookies use `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`. `Secure` is mandatory in production. The transaction cookie expires with the transaction TTL. The session cookie `Max-Age` is the remaining absolute session lifetime and is refreshed only when a new token is issued.

Every clear operation must repeat matching path, SameSite, Secure, and domain-omission attributes. Clear the transaction cookie on every callback outcome. Clear the session cookie on logout and every detected invalid/revoked/expired session.

Do not sign cookies with the OIDC client secret. Do not put user IDs, session IDs, issuer, subject, email, role, workspace, expiry JSON, or CSRF data in either cookie.

### 8. Application ports, errors, and use cases

Add narrow public application ports for:

- create/consume a login transaction;
- create/authenticate/rotate/touch/revoke a session;
- generate cryptographic secrets and SHA-256 hashes through a testable adapter boundary only where needed;
- protect/unprotect login secrets; and
- list bounded current-user workspace summaries.

Port methods must use named parameter objects, readonly primitive/immutable DTOs, and explicit result unions. They must not expose `pg`, Fastify, `openid-client`, raw provider claims, `URLSearchParams`, `Buffer`, mutable `Uint8Array`, request/reply, cookie objects, or SQL row types. Byte inputs/outputs that cross a port must be copied and never returned as caller-owned mutable state.

Implement focused use cases, not one god service:

- `beginOidcLogin`;
- `completeOidcLogin`;
- `authenticateApplicationSession`;
- `getCurrentUser`;
- `logoutApplicationSession`.

Public error constructors accept only a finite field/operation/reason discriminator; none accepts arbitrary message text, cause, provider data, or metadata. Required safe error classes/codes:

- `AuthConfigurationUnavailableError` / `AUTH_NOT_CONFIGURED`;
- `AuthRequestValidationError` / `AUTH_REQUEST_INVALID` with finite field only;
- `OidcCallbackInvalidError` / `OIDC_CALLBACK_INVALID`;
- `OidcProviderUnavailableError` / `OIDC_PROVIDER_UNAVAILABLE`;
- `AuthenticationRequiredError` / `AUTHENTICATION_REQUIRED`;
- `AuthPersistenceError` / `AUTH_PERSISTENCE_INVALID` with finite operation only.

Messages are fixed by the class. Each throw creates a fresh error. None exposes a raw value through fields, `message`, `cause`, JSON, string conversion, custom inspection, logging, stdout/stderr, stack text, or generated declarations.

Validate every persistence result before inspecting length, keys, indexes, descriptors, or properties in the same hardened order established by TASK-005 Remediation 01/02:

1. reject proxy and revoked proxy;
2. require genuine array with `Array.isArray(result) === true`;
3. require exact `Array.prototype`;
4. only then inspect length, keys, indexes, descriptors, and frozen safe snapshots.

All malformed persistence values, hostile rows, accessor-backed fields, symbol/extra keys, sparse arrays, array subclasses, spoofed arrays, iterables, provider objects, custom hooks, and invalid dates fail closed before later dependencies.

### 9. HTTP routes and exact behavior

Register only these routes. All auth and current-user responses include `Cache-Control: no-store`, `Pragma: no-cache`, and `Referrer-Policy: no-referrer`. No auth route reflects query/cookie/provider values.

#### `GET /auth/login`

- Optional query: exactly `returnTo` and no other key.
- Default `returnTo` is `/`.
- Accept only a local absolute-path reference beginning with one `/`; reject `//`, backslashes, controls, NUL, encoded/decode ambiguity, schemes, credentials, hosts, fragments, and values over 2048 characters.
- On success: persist one transaction, set transaction cookie, and respond `302` with the adapter-produced provider authorization URL.
- Validation failure: `400 application/problem+json`, code `AUTH_REQUEST_INVALID`.
- Auth disabled/discovery unavailable: fixed `503` without transaction/cookie creation.
- Rate limit: 10 requests per 60 seconds per `request.ip`.

#### `GET /auth/callback`

- Accept the provider query only through the exact callback parser. No body.
- Clear transaction cookie on all outcomes.
- On success: create session, set session cookie, and respond `303` to `new URL(returnTo, APP_BASE_URL)` after revalidating the stored path.
- Invalid, denied, missing, replayed, expired, wrong-browser, malformed, or cryptographically invalid callback: fixed `400 OIDC_CALLBACK_INVALID`.
- Provider discovery/token/JWKS network failure: fixed `503 OIDC_PROVIDER_UNAVAILABLE` with no raw upstream detail. A protocol-valid response whose verified requirements fail remains the fixed `400` callback error.
- Identity unavailable: fixed `401 AUTHENTICATION_REQUIRED`; do not reveal user status.
- Rate limit: 20 requests per 60 seconds per `request.ip`.

#### `GET /api/v1/me`

Requires a valid application session. The single-resource JSON response is exactly:

```json
{
  "user": {
    "id": "019...",
    "email": "user@example.com",
    "displayName": "Example User"
  },
  "session": {
    "idleExpiresAt": "2026-11-02T12:30:00.000Z",
    "absoluteExpiresAt": "2026-11-02T20:00:00.000Z"
  },
  "workspaceAccess": {
    "items": [
      {
        "id": "019...",
        "name": "Example Workspace",
        "slug": "example-workspace",
        "timezone": "Asia/Ho_Chi_Minh",
        "role": "owner"
      }
    ],
    "hasMore": false
  }
}
```

`email` and `displayName` are explicit `string | null`, never omitted. Do not expose identity provider, subject, email-verification claim, user status, user/session version, session ID, token hash, creation/rotation/last-seen timestamps, revocation data, social accounts, permissions, secrets, or provider tokens.

Workspace access includes only active membership plus active workspace rows, ordered by `(workspace.slug, workspace.id)`, queried with `LIMIT 101`, returning at most 100 items and `hasMore=true` when the 101st exists. It is informational only and does not authorize later workspace operations. Each row and the genuine persistence array must be adversarially validated and frozen.

Missing/invalid/expired/inactive session: fixed `401 AUTHENTICATION_REQUIRED` and clear session cookie. A successful rotation sets the replacement cookie. No CORS header is added by default.

#### `POST /api/v1/logout`

- Accept no body, query, or path parameter.
- Validate `Origin` when present; it must equal the configured `APP_BASE_URL` origin or exact public callback origin. Reject `Origin: null`, multiple/malformed origins, and mismatches with fixed `403 AUTH_ORIGIN_INVALID`.
- Revoke/scrub the matching session if valid; missing, malformed, already-expired, or already-revoked cookies are still idempotent.
- Always clear the session cookie for an accepted same-origin request.
- Return exactly `204` with no response body.
- Perform no provider logout/revocation call and no redirect.
- Rate limit: 30 requests per 60 seconds per `request.ip`.

Rate limiting uses Fastify's trusted `request.ip` with `trustProxy` remaining false. Do not read `X-Forwarded-For` directly. The in-process store is an explicit single-process MVP defense, not a claim of global multi-replica enforcement; production topology must resolve the distributed-store decision before horizontal scaling.

### 10. Problem Details and OpenAPI

Add central, narrow mapping for the auth errors above to RFC 9457-compatible `application/problem+json`. Required public fields are `type`, `title`, `status`, `code`, `detail`, `instance`, and validated/generated `requestId`; add `retryAfterSeconds` only for `429`. Values are fixed safe text. Do not include `errors` entries containing auth inputs.

Unexpected errors return fixed `500 INTERNAL_ERROR`. Log only the trusted request ID, safe error class/code, route template, method, status, and safe operation discriminator. Never log raw error objects for auth/provider/database failures.

Create a versioned OpenAPI 3.1 artifact under `openapi/` covering the four routes, cookies, exact schemas, status codes, content types, headers, and no bearer-token scheme. Runtime Fastify schemas are the executable source. Add a deterministic generation/check script so `pnpm check` fails if the committed OpenAPI artifact differs. Generation must not require database, network, provider discovery, secrets, or a running server.

### 11. PostgreSQL adapter contracts

All SQL is parameterized. No raw token, state, browser binding, verifier, nonce, code, claim, return URL, issuer, subject, email, or provider body is interpolated into SQL or error text.

Adapters must:

- select explicit columns, never `SELECT *`;
- cap impossible/malformed cardinality with `LIMIT 2` where applicable;
- validate genuine result arrays before mapping;
- validate exact row own data properties, primitive types, UUIDs, statuses, versions, byte lengths, and canonical timestamps;
- copy driver byte arrays before any use;
- return frozen null-prototype or ordinary plain immutable snapshots only;
- sanitize arbitrary driver failures through the existing `DatabaseError` boundary; and
- never inspect a raw constraint name, SQLSTATE detail, query text, bind value, or driver message to choose behavior.

Concurrency is handled by unique constraints, atomic statements, row locks, compare predicates, and one bounded transaction. Do not catch a constraint and parse its name. Do not retry a provider call or session insert after an ambiguous outcome.

No migration may modify `users`, `workspaces`, or `workspace_memberships` except adding no columns and no changed constraints. Migration `0003` adds only the two auth tables, their constraints, and indexes. Migration validation from an empty database and upgrade from the TASK-005 schema are both required.

### 12. API lifecycle and composition

Extend `createApp` and `startApiServer` through explicit injected auth dependencies. Unit tests must create the app with deterministic fakes and no environment/network access. `main.ts` may load validated auth configuration, create the concrete adapters, perform enabled discovery, and transfer ownership to the server lifecycle.

Startup failure after creating database/OIDC resources must close every owned resource exactly once. Shutdown must stop accepting requests, await bounded Fastify close, abort/close OIDC resources if supported, and close the database once. Auth-disabled mode performs no OIDC setup.

Do not make liveness depend on OIDC or PostgreSQL. `/health/live` remains the existing process-liveness contract and must not expose auth configuration/readiness.

### 13. Documentation updates

Update the approved documentation in the same implementation PR:

- `docs/API.md`: exact four-route contracts, response schema, cookie behavior, and Problem Details codes;
- `docs/DATABASE.md`: both new tables, constraints, sensitive-data rules, indexes, and unresolved retention;
- `docs/ARCHITECTURE.md`: OIDC adapter/session flow and application-versus-social OAuth separation;
- `docs/DECISIONS.md`: record that the implementation is standards-based and provider-neutral while the vendor/sign-in-method decision remains open; and
- `.env.example`/local setup documentation: auth-disabled default and safe configuration instructions without usable secrets.

Do not mark vendor, production hosting, distributed rate limiting, KMS, privacy jurisdiction, or retention as resolved.

## Expected files and file-level blueprint

Focused additions/changes are expected in:

| Area                                                                           | Expected purpose                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `packages/config/src/*`, config tests, `.env.example`                          | Exact auth configuration, invariants, and redacted metadata.                              |
| `packages/application/src/auth/*`, ports/errors/index, tests                   | Narrow auth/session use cases, public contracts, safe errors, hostile-result validation.  |
| `packages/infrastructure/migrations/0003_application_auth.sql`                 | Exact login-transaction and application-session tables.                                   |
| `packages/infrastructure/src/auth/*`, public `./auth` export, tests            | PostgreSQL adapters, OIDC adapter, crypto/random/protector implementations, safe mappers. |
| `packages/infrastructure/src/tenancy/*` only if necessary                      | Bounded active-workspace summary query using the existing tenancy adapter boundary.       |
| `apps/api/src/auth/*`, `app.ts`, `server.ts`, `main.ts`, tests                 | Routes, cookies, schemas, rate limits, error mapping, composition and lifecycle.          |
| `openapi/*`, generation/check script                                           | Deterministic OpenAPI 3.1 contract and drift gate.                                        |
| `docs/API.md`, `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` | Keep architecture and implemented contract synchronized.                                  |
| relevant package manifests and `pnpm-lock.yaml`                                | Exact approved dependencies and exports only.                                             |
| CI/test configuration only if required                                         | Run auth integration/contract checks without external provider access.                    |

No web page, worker behavior, social adapter, generic shared package, production secret, seed user, or unrelated refactor is expected. If another production file is required, report it before implementation and explain the dependency.

## Database changes

Add only migration `0003_application_auth.sql` as specified. Migrations remain forward-only and transactional through the existing migration runner. Do not edit `0001` or `0002`.

The expected relation set after migration is exactly:

- `schema_migrations`;
- `users`;
- `workspaces`;
- `workspace_memberships`;
- `oidc_login_transactions`; and
- `application_sessions`.

No automatic cleanup/deletion schedule is authorized because retention remains unresolved. Consumed transactions and revoked sessions must immediately scrub secret/hash material as specified; later bounded retention deletion requires a separate approved task.

## API changes

Add exactly:

- `GET /auth/login`;
- `GET /auth/callback`;
- `GET /api/v1/me`; and
- `POST /api/v1/logout`.

No other product, admin, debug, readiness, callback, token, refresh, password, registration, profile, workspace, or provider route is permitted.

## Frontend changes

None. Do not add or alter pages, React components, middleware, browser token storage, authenticated SSR, client SDKs, login buttons, error pages, onboarding, or CORS behavior. The successful callback redirects to the validated application path; frontend UX is a later task.

## Backend changes

Backend work is limited to the exact config, application, infrastructure, API, migration, contract, documentation, and test surfaces described above. Existing TASK-003/004/005 behavior remains compatible.

## Security requirements

- Authorization code, access token, refresh token, ID token, raw claims object, state, nonce, PKCE verifier, browser-binding secret, session token, hashes, encryption key, and client secret are secrets and never enter logs/errors/metrics/traces/responses.
- OIDC identity is exact verified issuer plus subject. Email is metadata only and is never a lookup, link, uniqueness, recovery, session, authorization, or account-merge key.
- State, PKCE S256, nonce, exact redirect URI, and same-browser transaction binding are all mandatory; none is an optional provider capability.
- Callback transactions are one-time before token exchange. Replays make zero provider, identity, session, and redirect-state mutations.
- Session cookies are HttpOnly/SameSite, Secure in production, host-only, and opaque. Browser storage contains no application/provider identity.
- Server sessions have both idle and absolute expiry, bounded touch, timed rotation, short previous-token grace, immediate logout revocation, and fail-closed inactive-user handling.
- `APP_BASE_URL` and `returnTo` never create an open redirect. Stored paths are revalidated before redirect.
- Logout has same-origin validation and SameSite defense. CORS remains closed.
- Provider/network errors and OAuth denial parameters never reach public detail or logs.
- Crypto uses Node standard cryptographic primitives and library-supported OIDC APIs. No custom JWT verification, custom cipher, deterministic IV, Math.random, weak hash, or reversible session token storage.
- Production cannot start with authentication disabled, insecure cookies, HTTP issuer/redirect, missing secret, malformed key, or inconsistent TTLs.
- Generated declarations expose no arbitrary message/cause/metadata parameter on public auth error constructors.

## Edge cases

Cover at minimum:

- auth disabled, partially configured, malformed URLs, whitespace, wrong key length/encoding, inconsistent TTLs, and production-insecure configuration;
- discovery timeout, cancellation, issuer mismatch, missing endpoints, unsupported client authentication, malformed metadata, rotating JWKS, provider outage, and shutdown during startup;
- duplicate/missing query keys, OAuth denial, empty code/state, array query values, encoded controls, hostile objects, proxies, revoked proxies, accessors, symbols, custom hooks, and enormous inputs;
- return paths with `//`, `\\`, encoded slash/backslash, scheme-relative URL, absolute URL, fragment, control, double encoding, Unicode ambiguity, and length boundary;
- transaction missing, wrong-browser cookie, expired, already consumed, malformed encrypted row, wrong key version, bad tag/AAD, replay, and concurrent duplicate callbacks;
- token response missing ID token, wrong issuer/audience/nonce/signature/time, malformed `sub`, provider objects with hooks, and optional metadata of wrong type;
- existing/new/inactive TASK-005 users and concurrent first-user provisioning;
- session missing, malformed, noncanonical base64url, wrong length, nonexistent, revoked, idle expired, absolute expired, user deleted/inactive, malformed persistence row, and duplicate impossible result;
- simultaneous session rotation, requests arriving with old/current token in both orders, grace boundary, touch boundary, clock skew expressed through injected time, and absolute-expiry cap;
- logout with no cookie, malformed cookie, valid cookie, repeated logout, mismatched/null/multiple Origin, and database failure;
- zero, one, 100, and 101 active workspace summaries; inactive memberships/workspaces; stable order; hostile rows; and no authorization inference;
- cookie clearing attribute parity, no-store headers, 204 empty body, Problem Details content type, Retry-After, and no accidental CORS;
- child-process sentinel tests for stdout/stderr, unhandled rejection, stack, JSON, string, inspection, logging, and thrown output non-disclosure.

## Acceptance criteria

1. A standards-compliant managed OIDC authorization-code flow starts with exact state, nonce, PKCE S256, redirect URI, scopes, and same-browser binding.
2. Callback verification is one-time, ordered, replay-safe, provider-neutral, and performs no token exchange before atomic transaction consumption.
3. Only exact verified issuer/subject plus optional primitive metadata enters TASK-005; no raw provider/token/request object crosses the boundary.
4. Opaque session tokens have 256 bits of secure randomness, only SHA-256 hashes persist, and revoked/consumed secret material is scrubbed.
5. Idle/absolute expiry, bounded touch, rotation, concurrent previous-token grace, inactive-user revocation, and logout behave exactly as specified.
6. `/auth/login`, `/auth/callback`, `/api/v1/me`, and `/api/v1/logout` match the exact status, schema, cookie, redirect, header, rate-limit, and error contracts.
7. `/api/v1/me` returns only safe user/session fields and at most 100 deterministic active-workspace summaries with an honest `hasMore` flag.
8. Every public error is fresh, fixed, typed, non-disclosing, and has no arbitrary-message/cause constructor in source or generated declarations.
9. Hostile claims, provider results, persistence arrays/rows, errors, dates, proxies, descriptors, iterables, and hooks fail closed without executing attacker-controlled behavior or leaking sentinels.
10. Migration `0003` validates from empty and upgraded databases, preserves old tables/contracts, and supports real PostgreSQL concurrency tests.
11. Unit and integration tests use a local test-only OIDC issuer and real PostgreSQL; no test calls a public identity provider or uses a production bypass.
12. Runtime schemas and committed OpenAPI are deterministic and drift-checked through the aggregate check.
13. Auth-enabled startup/shutdown owns and closes dependencies exactly once; auth-disabled non-production mode performs no discovery; liveness remains unchanged.
14. Existing TASK-003, TASK-004 including all remediations, and TASK-005 including both remediations remain fully passing.
15. No frontend, worker, social OAuth, role authorization, audit, workspace mutation, provider-vendor, or unrelated functionality is added.

## Test plan

### Configuration unit tests

- Full valid development, test, and production matrices.
- Every missing/partial/malformed field and numeric boundary.
- Exact HTTPS/loopback URL rules, issuer preservation, redirect path, client-secret non-disclosure, base64url canonicalization, key copying, TTL relationships, and redacted metadata.
- Auth-disabled zero-secret behavior and production prohibition.

### Application adversarial unit tests

- Exact dependency call order and zero-call assertions for every early failure.
- Genuine-array enforcement before any reflection/property read for every persistence result.
- Active/inactive identity, session, transaction, rotation, touch, logout, and workspace-summary matrices.
- Proxy/revoked-proxy, spoofed array, subclass, sparse array, accessor, symbol, extra-key, wrong-prototype, iterable, hostile date, custom `toString`/`valueOf`/`toJSON`/inspection/logging hooks.
- Fresh fixed errors, generated constructor declarations, and sentinel non-disclosure in-process and child-process.

### Infrastructure unit tests

- Exact parameterized SQL and parameter order for transaction creation/consumption, session creation/authentication/rotation/touch/revocation, user lookup, and workspace summaries.
- Atomic consume-and-scrub and revoke-and-scrub semantics.
- AES-256-GCM round trip, random IV, wrong key/AAD/tag/version rejection, copy semantics, canonical payload, and no plaintext persistence/logging.
- Random token entropy/format and SHA-256 known vectors without deterministic production fallback.
- OIDC adapter authorization URL and callback verification using controlled protocol responses; no vendor extensions.
- Safe mapping/sanitization of arbitrary database/provider failures.

### API unit/contract tests

- All route status codes, content types, headers, exact bodies, cookie attributes, clears, redirects, origin rules, rate limits, and no-store behavior.
- Auth-disabled behavior and zero discovery/provider/dependency calls.
- Request/query validation without coercion and maximum lengths.
- OpenAPI generation is deterministic and exactly matches runtime schemas.
- Existing liveness/startup/shutdown tests remain passing.

### Real PostgreSQL and local OIDC integration tests

Use the guarded disposable PostgreSQL harness and an in-process test-only OIDC issuer bound to loopback. The issuer must publish discovery/JWKS, sign short-lived test ID tokens, validate client/redirect/PKCE, and expose counters; it must never be compiled into production exports.

Prove:

- clean and upgrade migrations;
- full login start/callback/session/me/logout path;
- exact issuer/subject provisioning through TASK-005;
- same subject under different issuer remains distinct;
- two concurrent first logins create one user and independent valid sessions;
- replay and wrong-browser callback make zero additional token/identity/session calls;
- concurrent callback consumption permits one winner only;
- concurrent session rotation has one new token, bounded old-token grace, and no lost/overwriting rotation;
- idle/absolute expiry and inactive-user revocation scrub hashes;
- logout immediately invalidates the old cookie;
- real workspace summaries enforce active rows, stable ordering, and `LIMIT 101` behavior; and
- provider and database failure paths expose only fixed safe responses.

### Required repository verification

Antigravity must run and report actual command, exit status, and relevant summary for every applicable check:

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

Do not report a check as passed unless it ran against the final exact SHA. Report every skipped/unavailable check honestly with reason and risk.

## Out of scope

- Selecting/configuring a specific OIDC vendor, tenant, production domain, hosted login theme, sign-in method, MFA, enterprise federation, invitation, password, magic-link, or email-verification policy.
- Provider logout, refresh tokens, user-info endpoint, token introspection, token exchange beyond the authorization code, device flow, dynamic registration, account linking/merging, profile synchronization, reactivation, or identity deletion.
- Frontend login/logout/current-user UI, route guards, authenticated SSR, onboarding, workspace picker, or browser API client.
- Workspace CRUD, membership invitation/change/removal, authorization middleware, role-policy enforcement, step-up authentication, or audit events.
- Threads/TikTok OAuth, social credentials, products, AI, content, compliance, approval, scheduling, publishing, analytics, queues, or workers.
- Redis/distributed rate limiting, cross-origin browser deployment, trusted-proxy configuration, multi-region sessions, global logout, KMS integration, automatic key rotation, retention deletion jobs, or production deployment.
- Generic auth framework, JWT application sessions, bearer API tokens, public API keys, service accounts, password database, ORM, DI container, CQRS, event sourcing, microservices, Kafka, or Kubernetes.
- Unrelated upgrades, formatting churn, refactors, migrations, APIs, docs, or test rewrites.

## Implementation sequence for Antigravity

Use this order to minimize partial insecure states:

1. Re-read `AGENTS.md`, relevant docs, TASK-003/004/005 and every remediation, then inspect actual merged code and tests.
2. Create a branch from clean current `origin/main`; record baseline SHA and do not modify prior migrations.
3. Implement and exhaustively test `AuthConfig` first.
4. Add migration `0003`, mapper contracts, migration tests, and real PostgreSQL tests before route wiring.
5. Implement crypto/random/protector primitives with known-vector and non-disclosure tests.
6. Implement login-transaction and session PostgreSQL adapters with exact SQL, concurrency, and hostile-result tests.
7. Implement application ports, errors, and focused use cases with all dependency-order/zero-call tests.
8. Implement the provider-neutral OIDC adapter against the local test issuer.
9. Add API schemas, Problem Details, cookies, rate limits, and routes using injected fakes first.
10. Wire `main.ts` lifecycle and enabled discovery only after all lower boundaries pass.
11. Add OpenAPI generation/drift checks and synchronize documentation.
12. Run the complete unit/integration/adversarial/concurrency/security matrix.
13. Run every required repository and clean-checkout verification on the final exact SHA.
14. Report all files, exact SQL, exports/declarations, endpoint examples, checks, deviations, final SHA, and clean status for Codex review.

Do not compress these stages into a large unreviewable implementation. If an earlier stage reveals a contract conflict, stop and report it before wiring later layers.

## Implementation handoff requirements

Before requesting Codex review, Antigravity must provide:

- baseline, final local, remote-branch, and PR-head SHAs;
- full `origin/main...HEAD` file list and diff summary;
- every created/modified/deleted file and why;
- exact public exports/signatures and generated declaration evidence;
- exact migration SQL, constraints, indexes, query text, and parameter order;
- the callback verification and session-authentication call-order matrices;
- proof that callbacks are one-time and concurrent session rotation is safe;
- proof that no token/claim/cookie/identity/provider/database sentinel appears in any output surface;
- OpenAPI drift result and exact API/cookie examples containing only test values;
- every required verification command with final-SHA exit status;
- all skips, limitations, warnings, or deviations; and
- clean final working tree.

Codex will independently review the user requirement, this specification, actual `origin/main...HEAD` code, focused diffs, migrations, SQL, generated declarations, security boundaries, hostile tests, real PostgreSQL/OIDC concurrency, exact-SHA checks, and clean-checkout evidence. Antigravity's report is context, not proof. The feature is not complete and must not be merged until Codex returns `STATUS: APPROVED`.
