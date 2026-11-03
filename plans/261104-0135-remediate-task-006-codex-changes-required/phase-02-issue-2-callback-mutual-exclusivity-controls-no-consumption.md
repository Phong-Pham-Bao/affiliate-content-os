# Phase 02: Callback Mutual Exclusivity, Controls, and Zero Consumption

## Context

- `apps/api/src/auth/callback-route.ts`
- `packages/application/src/auth/complete-oidc-login-snapshots.ts`
- `packages/application/src/auth/complete-oidc-login.ts`

## Key Implementation Steps

1. Reject all C0 (0x00-0x1F) and DEL (0x7F) characters in decoded keys and values in `callback-route.ts`.
2. Reject ambiguous separator forms (e.g., `;`, `&&`, leading/trailing `&`, duplicate decoded keys).
3. Enforce mutually exclusive callback shapes in both raw parser (`callback-route.ts`) and application query parser (`complete-oidc-login-snapshots.ts`):
   - Success shape: must have `code` and `state`; must NOT have `error`, `error_description`, or `error_uri`.
   - Denial shape: must have `error` and `state`, optional `error_description` and `error_uri`; must NOT have `code`.
   - Reject conflicting inputs having both `code` and `error` before any consumption.
4. In `complete-oidc-login-snapshots.ts:parseCallbackQuery`:
   - Reject proxies first.
   - Enforce closed keys (either `{code, state}` or `{error, state, [error_description], [error_uri]}`).
   - Reject any C0/DEL controls in any field.
   - Bound field lengths (`code` <= 4096, `state` <= 4096, `error` <= 256, `error_description` <= 1024, `error_uri` <= 1024).
5. Ensure malformed/conflicting/control-bearing callbacks cause zero transaction consumption, zero crypto, zero provider, and zero session calls.
