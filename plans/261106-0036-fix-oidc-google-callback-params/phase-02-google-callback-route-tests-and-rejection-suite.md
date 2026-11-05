# Phase 02: Google-Shaped Callback Route Tests and Rejection Suite

## Context

- `apps/api/test/auth-callback-route.unit.test.ts`

## Key Implementation Steps

1. Add route tests with actual Google-shaped callbacks:
   - Full Google callback with `code`, `state`, `scope`, `authuser`, `prompt`, `hd`.
   - Verify 303 redirect, session cookie set, transaction cookie cleared.
   - Verify transaction consumption is called with correct state and cookie hashes.
   - Verify `completeOidcLogin` receives strictly `{ code, state }`.
2. Add route test with bounded arbitrary unrecognized OAuth parameters (RFC 6749 compliance).
3. Add route test with Google callback on user denial (`error`, `state`, `authuser`, `prompt`).
4. Retain and harden rejection tests:
   - Duplicate keys (standard keys and unrecognized keys like `scope`).
   - Duplicate keys via percent encoding (`scope=a&%73cope=b`).
   - Malformed percent encoding in query string and in unrecognized parameters (`scope=%2g`).
   - Missing state on code flow and on error flow.
   - Code + error mutual exclusivity (`code` and `error` together, `code` and `error_description`).
   - Hostile values:
     - Control characters in keys and values.
     - Hostile prototype keys (`__proto__`, `constructor`, `prototype`).
     - Oversized keys (>256) and oversized values (>4096).
     - Empty keys (`=val`).
     - Parameter count limit (>32).
     - Ambiguous separators (`;`, `&&`, leading/trailing `&`).
