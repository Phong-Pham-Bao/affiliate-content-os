# Phase 04: Adversarial and Integration Verification

## Context

- `apps/api/test/auth-adversarial-hostile-proxies.unit.test.ts`
- `apps/api/test/auth-callback-route.unit.test.ts`
- `packages/infrastructure/test/integration/session-concurrency.integration.test.ts`

## Key Verification Steps

1. Add adversarial unit tests:
   - Proxy with `getPrototypeOf` trap passed to `copyBytes` in `authenticate-session-candidate.ts`, `complete-oidc-login-snapshots.ts`, and `mapper-helpers.ts` (verify 0 trap calls).
   - TypedArray with hostile own `byteLength`/`length` getters (verify 0 hook calls, 0 sentinels leaked).
   - Extra string and symbol keys on claims, decrypted secrets, consumed transactions, and session candidates (verify rejection).
   - Conflicting `/auth/callback?code=c&error=e&state=s` and `{code: "c", state: "s\n"}` (verify 400, 0 consume calls).
   - Transaction-scoped fake without `findUserById` fails compilation, and root `userDirectory` receives 0 calls.
2. Run full quality gates:
   - `pnpm format:check`
   - `pnpm lint`
   - `pnpm lint:boundaries`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm test:integration`
   - `pnpm build`
3. Generate remediation cook report.
