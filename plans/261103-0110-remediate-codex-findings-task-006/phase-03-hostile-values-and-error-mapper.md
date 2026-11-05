# Phase 03: Hostile Accessors & Error Mappings

## Context Links

- [problem-details.ts](../../apps/api/src/auth/problem-details.ts)
- [mappers.ts](../../packages/infrastructure/src/auth/mappers.ts)
- [complete-oidc-login.ts](../../packages/application/src/auth/complete-oidc-login.ts)
- [authenticate-session.ts](../../packages/application/src/auth/authenticate-session.ts)

## Overview

- Priority: HIGH
- Status: Pending
- Goal: Apply TASK-005 proxy/descriptor validation, defensive byte copying, date validation, and never inspect unknown error properties via getters.

## Requirements

- Hostile accessors/getters on query, row, error, date, or buffer never execute.
- `resolveProblemSpec` checks known safe error instances without reading `.code` or `.statusCode` on arbitrary unknown error objects.
- `mappers.ts` validates property descriptors with `Object.getOwnPropertyDescriptor` before reading values.

## Implementation Steps

1. In `apps/api/src/auth/problem-details.ts`: safely inspect errors using `instanceof` or descriptor check without triggering hostile getters.
2. In `packages/infrastructure/src/auth/mappers.ts`: validate rows using descriptor inspection, genuine Uint8Array checks, and safe byte copying.
3. In `packages/application/src/auth/complete-oidc-login.ts`: validate query using descriptor inspection without executing getters.
4. Add adversarial regression tests with throwing getters on error, query, and session rows.
