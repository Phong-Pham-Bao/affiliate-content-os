# Phase 01: UUIDv7 Production Wiring

## Context Links

- [TASK-006.md](../../tasks/TASK-006.md)
- [login-route.ts](../../apps/api/src/auth/login-route.ts)
- [callback-route.ts](../../apps/api/src/auth/callback-route.ts)
- [main.ts](../../apps/api/src/main.ts)
- [mappers.ts](../../packages/infrastructure/src/auth/mappers.ts)

## Overview

- Priority: CRITICAL
- Status: Pending
- Goal: Inject the approved UUIDv7 generator into both transaction and session creation in production. Remove UUIDv4 fallbacks from auth persistence paths.

## Requirements

- `main.ts` must pass `generateId: () => idGenerator.generateId()` and `now: () => clock.now()` in `authDeps`.
- `login-route.ts` and `callback-route.ts` must use the injected `generateId` and `now` without `crypto.randomUUID()` UUIDv4 fallbacks.
- Both persisted login transaction ID and session ID must validate as UUIDv7.

## Implementation Steps

1. In `apps/api/src/main.ts`: pass `generateId: () => idGenerator.generateId()` and `now: () => clock.now()` into `authDeps`.
2. In `apps/api/src/auth/login-route.ts` and `apps/api/src/auth/callback-route.ts`: remove `import { randomUUID } from 'node:crypto'`. If `deps.generateId` is missing, throw `AuthConfigurationUnavailableError` or require it in `AuthDependencies`.
3. Add regression tests verifying UUIDv7 format for both transaction and session IDs.
