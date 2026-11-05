# Phase 02: OIDC Adapter Integration

## Overview

Integrate the secret-safe diagnostic classifier into `OidcProtocolAdapter.exchangeCodeAndValidateIdToken`.

## Key Steps

1. Wire `classifyGrantError` and `classifyClaimError` around `authorizationCodeGrant` and subsequent ID token validation.
2. Allow optional `diagnosticLogger` injection for test assertions while defaulting to `console.warn`.
3. Keep `oidc-adapter.ts` under 200 lines by delegating all classification logic to `oidc-grant-diagnostic.ts`.
4. Return appropriate `status`: `'verified'`, `'invalid'`, `'unavailable'`, or `'configuration_unavailable'`.

## Related Files

- `packages/infrastructure/src/auth/oidc-adapter.ts`
- `packages/infrastructure/src/auth/index.ts`
