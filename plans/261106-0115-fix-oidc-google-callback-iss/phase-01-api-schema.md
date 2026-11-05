# Phase 01: API Schema & Callback URL Parser

## Objective

Allowlist `iss` parameter in API callback route schema and update `callback-url-parser.ts` to validate and extract `iss` for both success and denial responses.

## Key Changes

1. `apps/api/src/auth/schemas.ts`: Add `iss: { type: 'string', minLength: 1, maxLength: 2048 }` to `callbackRouteSchema.querystring.properties`.
2. `apps/api/src/auth/callback-url-parser.ts`:
   - Allowlist `iss` parameter alongside `code`/`state` or `error`/`state`.
   - Validate `iss` length (1..2048) and ensure no C0/DEL control characters.
   - Include `filteredCore['iss'] = issVal` when present.
3. Update OpenAPI schema via `pnpm openapi:generate`.
4. Keep `callback-url-parser.ts` and `callback-route.ts` under 200 lines.
