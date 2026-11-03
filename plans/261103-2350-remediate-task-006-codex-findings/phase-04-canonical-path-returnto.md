# Phase 04: Implement Canonical Local-Path Validator for returnTo

## Context Links

- [begin-oidc-login.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/application/src/auth/begin-oidc-login.ts)
- [login-route.ts](file:///C:/Users/Win%2010/affiliate-content-os/apps/api/src/auth/login-route.ts)

## Overview

Reject fragments, encoded slash/backslash separators, double encoding, decode ambiguity, and duplicate `returnTo` parameters before transaction creation.

## Implementation Steps

1. In `packages/application/src/auth/begin-oidc-login.ts`:
   - Harden `validateReturnTo(raw: unknown)`:
     - Allow default `/` for undefined/null/''.
     - Reject non-strings and length > 2048.
     - Reject if not starting with `/` or starts with `//` or `/\`.
     - Reject if containing `#` (fragments).
     - Reject if containing literal `\` or control characters (0x00-0x1F, 0x7F).
     - Reject if containing encoded separators (`%2f`, `%2F`, `%5c`, `%5C`).
     - Reject if containing encoded fragments (`%23`).
     - Reject if containing double-encoding (`%25`).
     - Reject invalid percent-encoding triplets or invalid UTF-8 bytes.
     - Verify decoded URI component does not introduce `//`, `\`, `#`, or controls.
2. In `apps/api/src/auth/login-route.ts`:
   - Inspect raw query string of `request.raw?.url ?? request.url`.
   - Validate that `returnTo` appears at most once (reject duplicate `returnTo` keys and encoded duplicates).
   - Reject any other query key.
3. Update tests in `login-route.test.ts` and `begin-oidc-login.unit.test.ts`.

## Todo List

- [ ] Update `validateReturnTo` with canonical local-path rules
- [ ] Update `login-route.ts` query multiplicity check
- [ ] Add adversarial tests for `#fragment`, `%5cevil`, `%2f%2fevil`, `%252f%252fevil`, and duplicate `returnTo` keys
