# Phase 08: Startup/Discovery Ownership & Cancellation

## Context Links

- [oidc-adapter.ts](../../packages/infrastructure/src/auth/oidc-adapter.ts)
- [main.ts](../../apps/api/src/main.ts)
- [server.ts](../../apps/api/src/server.ts)

## Overview

- Priority: MEDIUM
- Status: Pending
- Goal: Honor discovery cancellation signal; ensure single resource owner closes database and resources exactly once on success, timeout, or failure.

## Requirements

- `discoverOidcAdapter` honors `signal`.
- Server signal handlers installed before discovery or discovery managed under server startup lifecycle.
- Database closed exactly once on any failure mode.

## Implementation Steps

1. In `oidc-adapter.ts`: pass `signal` to discovery and abort if signaled.
2. In `main.ts` / `server.ts`: establish single owner for database lifecycle; eliminate redundant `database.close()` in `main.ts`.
3. Add lifecycle unit tests for cancellation during discovery and single-close verification.
