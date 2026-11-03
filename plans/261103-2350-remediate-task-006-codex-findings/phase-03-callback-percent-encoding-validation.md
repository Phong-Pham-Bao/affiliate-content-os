# Phase 03: Enforce Raw Callback Percent-Encoding Validation

## Context Links

- [callback-route.ts](file:///C:/Users/Win%2010/affiliate-content-os/apps/api/src/auth/callback-route.ts)
- [complete-oidc-login.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/application/src/auth/complete-oidc-login.ts)

## Overview

Reject malformed percent-encoding in raw callback request target before URL decoding, crypto operations, or pending transaction consumption.

## Implementation Steps

1. In `apps/api/src/auth/callback-route.ts`:
   - Inspect raw URL query string (`request.raw?.url ?? request.url`).
   - Validate every `%` character: must be followed by exactly two hexadecimal characters (`/^[0-9a-fA-F]{2}$/`).
   - Test `decodeURIComponent` for valid UTF-8 sequences.
   - Validate that parameter keys, when decoded, do not produce duplicates (e.g. `code` vs `%63ode`).
   - Verify all keys belong to the strict allowlist (`code`, `state`, `error`, `error_description`, `error_uri`).
   - Throw `OidcCallbackInvalidError` on any syntax/encoding failure before calling handler/dependencies.
2. In `callback-route.test.ts`, add adversarial test cases:
   - `?code=%&state=s`
   - Incomplete triplets (`?code=%2&state=s`)
   - Invalid hex characters (`?code=%2g&state=s`)
   - Encoded duplicate keys (`?code=1&%63ode=2`)
   - Invalid UTF-8 sequences
   - Assert zero calls to transaction consumption, crypto, or OIDC provider.

## Todo List

- [ ] Implement raw query scanner and percent-triplet validator in `callback-route.ts`
- [ ] Add adversarial tests with transaction store call counter
