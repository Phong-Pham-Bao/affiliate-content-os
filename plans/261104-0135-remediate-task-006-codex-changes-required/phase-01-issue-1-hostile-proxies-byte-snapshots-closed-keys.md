# Phase 01: Hostile Proxies, Byte Snapshots, and Closed Key Sets

## Context

- `packages/application/src/auth/authenticate-session-candidate.ts`
- `packages/application/src/auth/complete-oidc-login-snapshots.ts`
- `packages/infrastructure/src/auth/mapper-helpers.ts`
- `packages/application/src/auth/get-current-user.ts`

## Key Implementation Steps

1. Re-order proxy detection:
   - Always run `isProxySafe(val)` before any `instanceof`, `Object.getPrototypeOf`, `Reflect.ownKeys`, or property access.
   - For byte snapshot helpers, verify `isProxySafe(val)` first. If proxy, return null (or throw fresh `DatabaseError` in mapper).
2. Safe TypedArray branding and byte extraction:
   - Check `util.types.isUint8Array(val)`.
   - Check `Object.getPrototypeOf(val) === Uint8Array.prototype`.
   - Extract intrinsic byte length via `TypedArray.prototype.byteLength.get.call(val)` to bypass any hostile own `byteLength` or `length` getters.
   - Enforce that `Reflect.ownKeys(val)` has length exactly equal to `byteLength` and contains only `'0'`..`String(byteLength - 1)`. Any own getters/setters or extra keys/symbols cause safe rejection without invoking accessors.
   - Copy bytes into a new `Uint8Array`.
3. Closed Key Sets & Descriptors:
   - `snapshotVerifiedClaims`: allowed keys `issuer`, `subject`, `email`, `displayName`. Reject unknown keys or symbols.
   - `snapshotSecrets`: allowed keys `pkceVerifier`, `nonce`. Reject unknown keys or symbols.
   - `snapshotConsumedTx`: allowed keys `id`, `keyVersion`, `returnTo`, `encryptedSecrets`, `createdAt`, `expiresAt`. Inside `encryptedSecrets`: `ciphertext`, `iv`, `authTag`, `keyVersion`. Reject extra keys or symbols.
   - `extractSingleCandidate`: candidate object allowed keys: 13 specific keys. Reject unknown keys or symbols. Candidates array must contain only `['0', 'length']`.
   - `safeExtractUser`: user object must match `UserSnapshot` keys exactly. No symbols, no accessors.
   - `getCurrentUser`: context, user, session, summaries, and items must enforce closed key sets with no symbols and data descriptors only.
