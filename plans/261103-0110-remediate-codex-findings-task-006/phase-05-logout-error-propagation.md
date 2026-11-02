# Phase 05: Logout Error Propagation

## Context Links

- [logout-route.ts](../../apps/api/src/auth/logout-route.ts)
- [logout-session.ts](../../packages/application/src/auth/logout-session.ts)

## Overview

- Priority: HIGH
- Status: Pending
- Goal: Keep malformed/missing/already-revoked cookies idempotent, but propagate an ambiguous revocation failure as a fixed safe 500.

## Requirements

- Malformed, missing, or already-revoked session cookies return 204.
- Persistence failure in `sessionStore.revokeMatchingSessionsByTokenHash` must NOT return 204; must propagate to 500 Problem Details.

## Implementation Steps

1. In `logout-route.ts`: remove `try { ... } catch {}` swallowing persistence errors.
2. Allow `DatabaseError` or other persistence errors to propagate to the central error handler.
3. Add regression tests proving 500 on database failure during logout.
