# Phase 01: Domain Package (@affiliate-content-os/domain)

## Context Links

- `tasks/TASK-005.md` sections 1, 4, 5
- `docs/ARCHITECTURE.md` sections 2, 4, 21
- `packages/domain/src/types.ts`

## Overview

Status: completed  
Priority: high  
Define exact framework-free identity types, claims validation primitives, and immutable application principal structures.

## Requirements

- Exact normative public types in `packages/domain/src/identity.ts`:
  - `VerifiedIdentityClaims`:
    - `readonly identityProvider: string`
    - `readonly identitySubject: string`
    - `readonly email?: string | null | undefined`
    - `readonly displayName?: string | null | undefined`
  - `AuthenticationSource`:
    - `readonly kind: 'verified_oidc'`
    - `readonly identityProvider: string`
  - `ApplicationPrincipal`:
    - `readonly user: UserSnapshot`
    - `readonly authenticationSource: AuthenticationSource`
- Runtime validation of claims input (`unknown`):
  - Must be a plain object with prototype `Object.prototype` or `null`.
  - Reject arrays, primitives, functions, symbols, bigints, dates, regexes.
  - Reject accessor properties (getters/setters) and throwing proxy traps; no property coercion or getter invocation.
  - Require exact own keys: `identityProvider`, `identitySubject`, optional `email`, optional `displayName`. Reject extra/unknown keys.
  - `identityProvider` and `identitySubject` must be non-empty strings with no leading or trailing whitespace (whitespace is rejected, not trimmed). Internal whitespace and case are preserved.
  - `email` and `displayName`: accept `undefined`, `null`, or string. Strings are trimmed; if empty after trim, convert to `null`; otherwise preserve trimmed string.
- Error handling:
  - Domain validation may use a domain-local validation primitive/error internally (`DomainValidationError`).
  - No domain validation error class or metadata escapes the application boundary.
- Immutability:
  - Deep `Object.freeze` on all returned domain structures.
- Tests in `packages/domain/test/identity.unit.test.ts`.

## Focused Test Command

```bash
corepack pnpm exec vitest run packages/domain/test/identity.unit.test.ts
```

## Actual Results

- Tests: 19 passed (19 total) in 29ms
- Typecheck: passed cleanly with zero errors
- Diff inspection: scoped strictly to `packages/domain/src/identity.ts`, `packages/domain/src/index.ts`, and `packages/domain/test/identity.unit.test.ts`.
