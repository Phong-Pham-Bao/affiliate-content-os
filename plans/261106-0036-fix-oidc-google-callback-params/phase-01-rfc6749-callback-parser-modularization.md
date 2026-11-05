# Phase 01: RFC 6749 Callback URL Parser Implementation & Modularization

## Context

- `apps/api/src/auth/callback-route.ts`
- `apps/api/src/auth/callback-url-parser.ts` (new module)
- `apps/api/src/auth/schemas.ts`
- `apps/api/src/auth/index.ts`

## Key Insights

1. Google's real OIDC callback adds `scope`, `authuser`, `prompt`, and possibly `hd` to the callback URL.
2. RFC 6749 Section 4.1.2 mandates: "The client MUST ignore unrecognized response parameters."
3. In `complete-oidc-login-query.ts`, `completeOidcLogin` requires strict exact keys (`keys.length === 2` on success). Therefore, `parseAndValidateRawCallback` must filter and return ONLY the allowlisted core fields (`code`, `state`, `error`, `error_description`, `error_uri`).
4. To respect the <200 lines file size limit, `parseAndValidateRawCallback` should be extracted into `apps/api/src/auth/callback-url-parser.ts`.
5. Fastify's schema in `apps/api/src/auth/schemas.ts` for `callbackRouteSchema.querystring` must have `additionalProperties: true` so Fastify's Ajv doesn't reject unrecognized query parameters before route execution.

## Implementation Steps

1. Create `apps/api/src/auth/callback-url-parser.ts`:
   - Enforce query string format: no `#`, exactly one `?`, no `;`, no `&&`, no leading/trailing `&`.
   - Bound total query length (<= 16384) and pair count (<= 32).
   - Strict percent encoding validation: `%` followed by two valid hex characters.
   - Strict duplicate key rejection on both raw and decoded keys (standard and unrecognized).
   - Strict control character rejection: C0 controls (0x00-0x1F) and DEL (0x7F) in all keys and values.
   - Bounded lengths: key length 1..256, value length <= 4096.
   - Reject hostile prototype keys (`__proto__`, `constructor`, `prototype`).
   - Mutual exclusivity: `code` XOR `error`.
   - Mandatory non-empty `state` (1..4096).
   - If `code`: non-empty (1..4096), strictly no `error_description` or `error_uri`.
   - If `error`: non-empty (1..256), `error_description` <= 1024, `error_uri` <= 1024.
   - Return null-prototype object containing ONLY the allowlisted core fields.
2. Update `apps/api/src/auth/callback-route.ts`:
   - Import `parseAndValidateRawCallback` from `./callback-url-parser.js`.
   - Remove inline parser function.
3. Update `apps/api/src/auth/schemas.ts`:
   - Set `additionalProperties: true` on `callbackRouteSchema.querystring`.
4. Export `parseAndValidateRawCallback` in `apps/api/src/auth/index.ts`.
