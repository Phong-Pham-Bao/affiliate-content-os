# Phase 02: Application Core & Boundary

## Objective

Preserve and validate `iss` parameter through application query snapshot parsing, command types, and `OidcProtocolPort` interface.

## Key Changes

1. `packages/application/src/auth/complete-oidc-login-query.ts`:
   - Update `parseCallbackQuery` to accept and validate optional `iss` property (1..2048 chars, no control chars).
   - Return `{ code, state, iss?, isDenial: false }` or `{ state, iss?, isDenial: true }`.
2. `packages/application/src/auth/ports.ts`:
   - Update `OidcProtocolPort.exchangeCodeAndValidateIdToken` parameter type to accept `readonly iss?: string | undefined`.
3. `packages/application/src/auth/complete-oidc-login.ts`:
   - Pass `iss: parsed.iss` to `deps.oidc.exchangeCodeAndValidateIdToken`.
   - Maintain transaction consumption, state hash, browser-binding cookie hash, PKCE verifier, nonce, and secret sanitization.
