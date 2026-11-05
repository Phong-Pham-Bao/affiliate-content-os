# Phase 04: Callback Query Validation Order

## Context Links

- [callback-route.ts](../../apps/api/src/auth/callback-route.ts)
- [schemas.ts](../../apps/api/src/auth/schemas.ts)
- [complete-oidc-login.ts](../../packages/application/src/auth/complete-oidc-login.ts)

## Overview

- Priority: HIGH
- Status: Pending
- Goal: Preserve and validate raw query exact multiplicity and key set before any hash or persistence call.

## Requirements

- Query with unexpected keys, duplicate keys, or oversized keys must fail immediately.
- Zero calls to `consumePendingTransaction`, `hashToken`, or provider endpoints on invalid callback query.

## Implementation Steps

1. In `callback-route.ts`: extract and validate raw URL query search parameters directly from `request.raw?.url ?? request.url`.
2. Verify exact parameter count, allowed keys only, and single-value cardinality.
3. Pass clean validated payload to `completeOidcLogin`.
4. Add regression tests asserting zero transaction/hash calls on malformed or extraneous query parameters.
