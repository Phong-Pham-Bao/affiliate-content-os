# Research: Root Causes & Remediation for TASK-006 Codex Findings

## 1. Finding 1: Session authentication self-starves with poolMax=1

- Root Cause: `authenticateApplicationSession` calls `deps.sessionStore.withTransaction(async (txStore) => ...)` which checks out a client from the pool and acquires row locks (`FOR UPDATE`). Inside this transaction, `deps.userDirectory.findUserById(parsedUserId)` was called on the root `database` adapter instead of using the transaction client. When `DATABASE_POOL_MAX=1`, the root connection pool is exhausted, leading to self-starvation / query timeout.
- Solution: Expose `findUserById` on `PostgresSessionAdapter` (and `SessionStorePort`), bound to the transaction-scoped `runner` inside `withTransaction`. In `authenticateApplicationSession`, invoke `store.findUserById(parsedUserId)` (with fallback to `deps.userDirectory?.findUserById`). This ensures the user lookup executes on the transaction connection without requesting a second connection.

## 2. Finding 2: Hostile values execute traps/getters

- Root Causes:
  1. `resolveProblemSpec` in `apps/api/src/auth/problem-details.ts:91`: `instanceof` checks ran before proxy detection (`util.types.isProxy`), allowing a proxy whose `getPrototypeOf` trap throws to escape with a raw sentinel.
  2. `authenticate-session.ts:61, 105`: `extractSingleCandidate` did not validate own data property descriptors of the candidate session object `s`, allowing throwing getters on `revokedAt`, `idleExpiresAt`, etc.
  3. `complete-oidc-login.ts:142, 178`: `consumedTx` and `claims` properties were accessed directly without proxy/descriptor validation.
  4. `get-current-user.ts:28`: `context.user` and `summaries` properties were read directly without proxy/descriptor validation.
  5. `postgres-login-transaction-adapter.ts:113` and `postgres-workspace-summary-adapter.ts:35`: `result.rows` was checked via `Array.isArray` and `.length` before verifying proxy rejection and prototype hierarchy.
- Solution: Implement hook-free proxy rejection (`util.types.isProxy`) before any reflection/instanceof. Validate exact own data descriptors (no getters/setters), prototypes, keys, and copy data into fresh null-prototype or plain frozen objects before any property reads.

## 3. Finding 3: Malformed callback encoding consumes transaction

- Root Cause: In `callback-route.ts`, `new URL` was used without validating raw percent-encoding triplets (`%XX`). URL accepts `%` literally. The pre-validation passed it to `completeOidcLogin`, which called `consumePendingTransaction` before any code validation.
- Solution: Validate raw query string and every percent-encoded triplet in raw URL before URLSearchParams decoding. Ensure valid hex triplets, valid UTF-8 sequences, reject encoded duplicate keys (`code` and `%63ode`), unknown keys, and ambiguous query delimiters. Throw `OidcCallbackInvalidError` before any transaction store or crypto calls.

## 4. Finding 4: returnTo canonical-path validation

- Root Cause: `validateReturnTo` only checked leading slash, `//`, `\`, controls, and length. It accepted fragments (`#`), encoded separators (`%5c`, `%2f`), and double encoding (`%252f`). `login-route.ts` accepted duplicate `returnTo` parameters silently.
- Solution: Implement strict canonical local path validator rejecting `#`, encoded separators (`%2f`, `%5c`), double encoding (`%25`), controls, decode ambiguity, and ensure `login-route` validates raw query syntax and rejects duplicate/unknown query keys before transaction creation.

## 5. Finding 5: Missing upgrade, equality, and concurrency tests

- Root Cause: No automated test upgraded from migration 0002 to 0003 with seeded data; timestamp constraints were not tested at equality boundaries; concurrency tests lacked forced concurrent schedules with poolMax=1 and exact before/at/after grace checks.
- Solution: Add migration upgrade integration test from TASK-005 schema; add timestamp boundary equality tests; add deterministic forced concurrent tests with poolMax=1 and exact grace boundary assertions.
