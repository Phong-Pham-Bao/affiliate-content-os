# Research Report: Root Cause Analysis for Review Findings

## Executive Summary

Codex identified 3 HIGH severity issues in the previous remediation:

1. Proxy `getPrototypeOf` traps executed due to `!(val instanceof Uint8Array)` preceding proxy checks, own `byteLength`/`length` getters triggered during byte copy leaking sentinels, and open key sets allowed unexpected string/symbol keys in DTO boundaries.
2. Callback validation permitted conflicting inputs containing both `code` and `denial` parameters, raw validation checked only NUL instead of all C0/DEL controls, and completion consumed the pending transaction on malformed query inputs before rejecting.
3. `SessionStorePort.findUserById` remained optional with a fallback to root `deps.userDirectory`, leaving open the possibility of single-connection pool starvation when fakes or alternate implementations omitted the method.

## Detailed Root Causes

### Finding 1: Observable Operations Preceding Proxy Detection & Overridable Byte Properties

- In `authenticate-session-candidate.ts:16` and `complete-oidc-login-snapshots.ts:56`, `!(val instanceof Uint8Array)` ran before `isProxySafe(val)`. In ECMAScript, `instanceof` invokes the proxy's `getPrototypeOf` trap.
- In `authenticate-session-candidate.ts:17`, `val.byteLength` was accessed directly; in `mapper-helpers.ts:59`, `val.length` was accessed directly. If an attacker configured own getters on those properties, the getters executed and threw unhandled sentinels.
- In `complete-oidc-login-snapshots.ts` and `authenticate-session-candidate.ts`, `snapshotVerifiedClaims`, `snapshotSecrets`, `snapshotConsumedTx`, and `extractSingleCandidate` did not verify `Reflect.ownKeys` against an exact whitelist of allowed property names, permitting arbitrary string and symbol keys.

### Finding 2: Callback Shape Conflict, C0/DEL Controls, and Premature Transaction Consumption

- In `apps/api/src/auth/callback-route.ts:92-97`, only `code === 0` (NUL) was rejected in decoded values; ASCII C0 controls (0x01-0x1F) and DEL (0x7F) were permitted.
- Both `callback-route.ts:102` and `complete-oidc-login-snapshots.ts:37` checked `(!code && !error)`, allowing requests containing BOTH `code` AND `error`.
- In `complete-oidc-login.ts:30-41`, query parsing occurred but did not reject C0/DEL controls or conflicting shapes, allowing `deps.transactionStore.consumePendingTransaction` to be called before error rejection.

### Finding 3: Optional `SessionStorePort.findUserById` and Root UserDirectory Fallback

- `SessionStorePort.findUserById?` was optional in `ports.ts:106`.
- `authenticateApplicationSession` fell back to `deps.userDirectory?.findUserById` if `store.findUserById` was not provided, creating an observable root-pool query inside `withTransaction`.
