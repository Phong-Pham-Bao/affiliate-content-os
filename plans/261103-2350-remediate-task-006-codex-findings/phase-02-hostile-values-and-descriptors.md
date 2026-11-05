# Phase 02: Eliminate Hostile Value Getter/Proxy Traps

## Context Links

- [problem-details.ts](file:///C:/Users/Win%2010/affiliate-content-os/apps/api/src/auth/problem-details.ts)
- [authenticate-session.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/application/src/auth/authenticate-session.ts)
- [complete-oidc-login.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/application/src/auth/complete-oidc-login.ts)
- [get-current-user.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/application/src/auth/get-current-user.ts)
- [postgres-login-transaction-adapter.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/src/auth/postgres-login-transaction-adapter.ts)
- [postgres-workspace-summary-adapter.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/src/auth/postgres-workspace-summary-adapter.ts)

## Overview

Ensure zero traps or getters can be executed by hostile proxies, prototypes, accessors, or custom objects at application or infrastructure boundaries.

## Implementation Steps

1. In `apps/api/src/auth/problem-details.ts`:
   - Check `util.types.isProxy` and `hasProxyInPrototypeChain` before ANY `instanceof` check or property access.
   - If proxy detected or getter throws, return safe `INTERNAL_ERROR` Problem Details.
2. In `packages/application/src/auth/authenticate-session.ts`:
   - In `extractSingleCandidate`, validate exact own data property descriptors of candidate session object `s`.
   - Snapshot `s` into a fresh plain object with verified primitive/byte properties before any property access.
3. In `packages/application/src/auth/complete-oidc-login.ts`:
   - Validate own data descriptors for `consumedTx` and `claims` before reading any fields.
   - Snapshot both into fresh plain objects before use.
4. In `packages/application/src/auth/get-current-user.ts`:
   - Validate descriptors of `context.user` and `summaries` before property access.
5. In `postgres-login-transaction-adapter.ts` and `postgres-workspace-summary-adapter.ts`:
   - Ensure `result.rows` is validated for `typeof === 'object'`, `!isProxySafe`, `Array.isArray`, and `Object.getPrototypeOf === Array.prototype` before reading `rows.length` or array elements.

## Todo List

- [ ] Fix `resolveProblemSpec` in `problem-details.ts`
- [ ] Harden `extractSingleCandidate` and session extraction in `authenticate-session.ts`
- [ ] Harden `consumedTx` and `claims` validation in `complete-oidc-login.ts`
- [ ] Harden `context` and `summaries` validation in `get-current-user.ts`
- [ ] Harden `result.rows` inspection in `postgres-login-transaction-adapter.ts` and `postgres-workspace-summary-adapter.ts`
- [ ] Add unit and adversarial tests covering proxy traps and throwing getters
