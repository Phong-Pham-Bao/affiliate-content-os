# Implementation Report: Remediate TASK-006 Codex Changes Required

- **Date**: 2026-11-04
- **Branch**: `agy/task-006-managed-oidc-session`
- **Target Task**: TASK-006 (Managed OIDC and Session Authentication)
- **Status**: Complete & Verified

---

## 1. Issue 1 (HIGH) — Hostile Proxies, Byte Snapshots, Accessors & Closed Key Sets

### Root Cause

1. `byte-snapshot` operations performed observable inspections (`!(val instanceof Uint8Array)`) before proxy detection, triggering `getPrototypeOf` traps on proxies with custom prototypes.
2. Accessing `val.byteLength` and `val.length` invoked hostile own getter accessors that leaked sentinels in thrown errors.
3. DTO snapshot boundaries (`snapshotVerifiedClaims`, `snapshotSecrets`, `snapshotConsumedTx`, `extractSingleCandidate`, `safeExtractUser`, `getCurrentUser`) allowed extra string and symbol keys.

### Implementation

- **Centralized Byte Snapshot Helpers** (`packages/application/src/auth/byte-snapshot-helpers.ts`, 62 lines):
  - `isProxySafe(val)` runs prior to any prototype or brand inspection; revoked proxies and hostile proxies are rejected safely.
  - Safe brand verification checks `util.types.isUint8Array(val)` and `Object.getPrototypeOf(val) === Uint8Array.prototype`.
  - Intrinsic byte length is extracted directly via `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(val)`, bypassing any hostile own `byteLength` or `length` getters.
  - Enforces that `Reflect.ownKeys(val)` contains strictly `'0'` through `String(byteLength - 1)` with no extra own keys or symbols.
  - Copies bytes defensively into a fresh `Uint8Array`.
- **Infrastructure Byte Mapper** (`packages/infrastructure/src/auth/mapper-helpers.ts`, 97 lines):
  - Re-ordered to verify `isProxySafe` first before any prototype inspection.
  - Intrinsic `TypedArray.prototype.byteLength` getter read directly; accepts canonical `Uint8Array.prototype` and `Buffer.prototype` from PostgreSQL `pg` driver `bytea` columns.
  - Throws fresh, non-disclosing `DatabaseError` on any noncanonical value.
- **Closed Key Set Enforcement**:
  - `snapshotVerifiedClaims`: strictly `['issuer', 'subject', 'email', 'displayName']`.
  - `snapshotSecrets`: strictly `['pkceVerifier', 'nonce']`.
  - `snapshotConsumedTx`: strictly `['id', 'keyVersion', 'returnTo', 'encryptedSecrets', 'createdAt', 'expiresAt']`; `encryptedSecrets` strictly `['ciphertext', 'iv', 'authTag', 'keyVersion']`.
  - `extractSingleCandidate` & `safeExtractUser` (`packages/application/src/auth/authenticate-session-candidate.ts`, 182 lines): strictly 13 allowed candidate keys and `UserSnapshot` keys; candidates array strictly `['0', 'length']`.
  - `getCurrentUser` (`packages/application/src/auth/get-current-user.ts`, 180 lines): closed key verification on `context`, `user`, `session`, `summaries`, and summary `items`.
- **Adversarial Test Coverage**:
  - `packages/application/test/auth/auth-adversarial-issue1-matrix.unit.test.ts` (168 lines): proves 0 `getPrototypeOf` trap calls, 0 own getter hooks, 0 sentinels leaked, safe handling of revoked proxies, and closed key rejection on claims, secrets, consumed transactions, candidate sessions, and users.
  - `packages/infrastructure/test/unit/mapper-bytes-adversarial.unit.test.ts` (60 lines): proves 0 trap calls, 0 getter hooks, and safe copying of canonical `Buffer` and `Uint8Array` in persistence mappers.

---

## 2. Issue 2 (HIGH) — Callback Mutual Exclusivity, Controls & Zero Consumption

### Root Cause

Raw and application validation accepted conflicting callbacks containing both `code` and `error` parameters, and checked only NUL instead of all C0 and DEL control characters. Conflicting or control-bearing requests reached `completeOidcLogin` and consumed the pending transaction in PostgreSQL before returning HTTP 400.

### Implementation

- **API Route Pre-Validation** (`apps/api/src/auth/callback-route.ts`, 187 lines):
  - Rejects ambiguous query separator forms: `;`, `&&`, leading/trailing `&`, and duplicate/encoded-duplicate keys.
  - Enforces C0 control (`0x00`-`0x1F`) and DEL (`0x7F`) rejection in both query keys and decoded values.
  - Enforces mutually exclusive shapes in `preValidation` before any transaction lookup or hashing:
    - Success shape: requires `code` and `state`; strictly forbids `error`, `error_description`, and `error_uri`.
    - Denial shape: requires `error` and `state`, optional `error_description` and `error_uri`; strictly forbids `code`.
  - Conflicting inputs (e.g. `/auth/callback?code=c&error=e&state=s`) return HTTP 400 `OIDC_CALLBACK_INVALID` with zero database calls, zero crypto operations, and zero transaction consumption.
- **Application Query Snapshotting** (`packages/application/src/auth/complete-oidc-login-query.ts`, 112 lines; `complete-oidc-login-snapshots.ts`, 166 lines):
  - Re-verifies proxy safety and data descriptors.
  - Enforces closed key sets and mutual exclusivity at the use-case boundary.
  - Bounds field lengths (`code` <= 4096, `state` <= 4096, `error` <= 256, `error_description` <= 1024, `error_uri` <= 1024) and rejects C0/DEL controls.
- **Adversarial Test Coverage**:
  - `apps/api/test/auth-adversarial-issue2-issue3.unit.test.ts` (275 lines): verifies HTTP injection of `/auth/callback?code=c&error=e&state=s`, denial fields on success, control characters in query, and `{code: 'c', state: 's\n'}` all return HTTP 400 with 0 transaction consumption calls.

---

## 3. Issue 3 (HIGH) — Mandatory Transaction User Lookup & Root Fallback Elimination

### Root Cause

`SessionStorePort.findUserById` remained optional, and `authenticateApplicationSession` fell back to `deps.userDirectory`. In single-connection pool configurations (`DATABASE_POOL_MAX=1`), omitting `findUserById` on the transaction store caused the authentication use case to acquire a connection from the exhausted root pool while holding the transaction row lock, causing self-starvation.

### Implementation

- **Mandatory Port Contract** (`packages/application/src/auth/ports.ts`, 137 lines):
  - Made `findUserById(userId: string): Promise<UserSnapshot | null>` mandatory on `SessionStorePort`.
- **Eliminated Root Directory Fallback**:
  - `packages/application/src/auth/authenticate-session-types.ts` (24 lines): removed `userDirectory` from `AuthenticateSessionDependencies`.
  - `packages/application/src/auth/authenticate-session.ts` (141 lines): strictly calls `txStore.findUserById(parsedUserId)` using the store instance passed into `withTransaction`. Removed all root `userDirectory` references and fallback logic.
  - `apps/api/src/auth/me-route.ts` (64 lines): removed passing `userDirectory` to `authenticateApplicationSession`.
- **Test Coverage & Verification**:
  - `apps/api/test/auth-adversarial-issue2-issue3.unit.test.ts`: proves 0 root-directory lookups during session authentication.
  - `packages/infrastructure/test/integration/session-concurrency.integration.test.ts`: proves authentication, touch, rotation, inactive-user revocation, concurrent current/previous-token requests, rollback, and connection release on PostgreSQL with `poolMax=1`.

---

## 4. Verification & Quality Gates

All workspace quality gates passed cleanly:

1. **Format Check**: `pnpm format:check` — all files use Prettier style.
2. **Lint & Boundaries**: `pnpm lint` and `pnpm lint:boundaries` — 0 errors, 0 dependency violations (418 modules, 985 dependencies cruised).
3. **Typecheck**: `pnpm typecheck` — 0 TypeScript errors across all 7 workspace projects.
4. **Unit Tests**: `pnpm test` — 46 test files, 896 tests passed.
5. **Integration Tests**: `pnpm test:integration` — 10 test files, 105 tests passed against local PostgreSQL container.
6. **Infrastructure Pins**: `pnpm verify:infrastructure-pins` — verified `postgres:18.6-bookworm@sha256:...`.
7. **Production Build**: `pnpm build` — successful production builds for all apps (`api`, `web`, `worker`) and packages (`config`, `domain`, `application`, `infrastructure`).
8. **Infrastructure Teardown**: `pnpm infra:down` executed cleanly, `docker ps` confirmed 0 running containers.
9. **Modularity Constraints**: All source code files verified strictly <= 200 lines:
   - `packages/application/src/auth/byte-snapshot-helpers.ts`: 62 lines
   - `packages/application/src/auth/complete-oidc-login-query.ts`: 112 lines
   - `packages/application/src/auth/authenticate-session-candidate.ts`: 182 lines
   - `packages/application/src/auth/complete-oidc-login-snapshots.ts`: 166 lines
   - `packages/application/src/auth/get-current-user.ts`: 180 lines
   - `apps/api/src/auth/callback-route.ts`: 187 lines
   - `packages/infrastructure/src/auth/mapper-helpers.ts`: 97 lines
   - `packages/application/src/auth/ports.ts`: 137 lines
   - `packages/application/src/auth/authenticate-session.ts`: 141 lines
   - `packages/application/src/auth/authenticate-session-types.ts`: 24 lines
   - `apps/api/src/auth/me-route.ts`: 64 lines
   - `packages/infrastructure/src/auth/index.ts`: 40 lines
