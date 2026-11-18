# TASK-016 Remediation 02 — Close production composition and truthful flow evidence

## Objective

Fix the remaining blocking defects found by Codex in commit
`9139985cdfc1d5fbea917fd1af986d1ba3bee8e2`. This is a focused follow-up to
`TASK-016-REMEDIATION-01`; preserve its correct credential binding, callback
claim fence, PKCE, actor binding, and atomic authorize idempotency work.

## Context

Codex reviewed the actual remediation code and found four gaps:

1. **CRITICAL — production validation is not active in the API process.**
   `apps/api/src/main.ts` calls `loadSocialConfig(process.env)` without the
   effective `config.nodeEnv`. Therefore production fake/local/KMS rejection in
   `validate-social.ts` is skipped in the real composition root.
2. **HIGH — the fake provider page still has a production escape hatch.**
   `ALLOW_FAKE_SOCIAL_AUTH=true` makes a `NODE_ENV=production` build serve the
   page. Production must never serve it, irrespective of this legacy test flag.
3. **HIGH — concurrent first-time callbacks for one provider identity do not
   converge safely.** Both transactions can observe no active account before
   insert; the partial unique index makes one transaction fail after the remote
   exchange has already succeeded. Serialize completion per
   `(workspace, platform, provider_account_id)` before select/insert/update and
   prove one account plus valid credential rotation/result behavior under real
   overlap.
4. **HIGH — the claimed “actual local fake flow” E2E is API-mocked.**
   `e2e/social-connections-flow.spec.ts` mocks authorize, callback, callback
   result, and account list, so it does not exercise persistence, callback
   fencing, credential storage, or real API routes. Its label and acceptance
   claim are false.

The remediation specification also required allowlisted audit evidence for
authorization claim and replay rejection, but no such audit actions exist.

## Required implementation

### 1. Activate fail-closed production composition

- Pass the already validated effective `config.nodeEnv` into
  `loadSocialConfig` in the API composition root.
- Remove the production escape hatch from the fake provider page. In any
  effective production runtime/build it must return 404 and must not render or
  navigate, regardless of `ALLOW_FAKE_SOCIAL_AUTH`.
- Keep test/local ability explicit without weakening production.
- Add composition-level tests that exercise the same invocation used by
  `main.ts`, not only direct validator unit tests.

### 2. Serialize account upsert by provider identity

- Before `SQL_FIND_ACTIVE_ACCOUNT_FOR_UPDATE`, acquire a transaction-scoped
  PostgreSQL advisory lock derived from the full workspace/platform/provider
  identity (or an equivalently safe database serialization mechanism).
- Do not rely on catching a unique violation after token exchange.
- Retain the partial unique index as defense in depth.
- Add a controlled-barrier PostgreSQL integration test with two distinct,
  already-claimed OAuth transactions completing concurrently for the same new
  provider identity. Assert both operations settle according to the documented
  convergence contract, exactly one active account exists, credentials decrypt
  with that authoritative account ID, no orphan credential exists, and each
  transaction has at most one terminal result.
- If both completions are allowed to succeed, define deterministic last-writer
  rotation semantics. If one is rejected, rejection must be a deliberate
  domain conflict rather than an accidental unique-constraint error. In either
  case do not claim that a second external exchange was prevented across two
  distinct authorization transactions.

### 3. Produce truthful end-to-end evidence

- Replace the mocked happy/deny Playwright flow with a harness that sends the
  browser through the real TASK-016 API routes and PostgreSQL persistence:
  authorize -> rendered fake provider -> callback -> opaque result consume ->
  account list refresh. Verify the stored account is explicitly local/test.
- The API process used by this E2E must be configured with social auth and the
  fake adapter explicitly enabled, a test encryption key, and a test database.
  Seed only the minimum authenticated owner/workspace state using existing test
  helpers or a dedicated deterministic fixture. Do not bypass the social API
  routes with Playwright `route.fulfill`.
- Exercise a real denial callback too. UI-only role gating may continue to use
  a session fixture if the existing E2E auth architecture requires it, but it
  must not be presented as backend authorization evidence.
- If a separate full-stack Playwright project/config is necessary, keep the
  ordinary fast UI suite intact and ensure `pnpm test:e2e` runs the full-stack
  proof in CI/local validation.
- Rename any remaining mocked browser test so its title states that it is a UI
  contract test rather than an actual OAuth flow.

### 4. Complete callback audit evidence

- Record an allowlisted `social_connection.authorization_claimed` event for the
  successful atomic claim without including state, code, verifier, token, raw
  provider values, or ciphertext.
- Record replay rejection at the nearest trustworthy boundary with a fixed
  reason code and safe metadata. If a rejected database transaction cannot
  persist its own audit atomically, use a separate narrow audit operation after
  classification; audit failure must not turn replay into success.
- Add tests for successful claim and replay-rejected audit events and confirm
  sensitive values are absent.

## Expected files

Focused changes in API composition/config tests, fake provider page/tests,
PostgreSQL social completion/claim code and integration tests, Playwright
configuration/fixtures/specs, and audit contracts. Do not modify migrations
`0001`–`0013`; modify `0014` only if a still-unreleased Checkpoint A schema
change is genuinely necessary.

Do not stage or modify unrelated untracked `plans/` content or
`packages/application/src/workforce/affiliate-content-os.code-workspace`.

## Database changes

Prefer transaction-scoped advisory locking without a new table. Keep schema
uniqueness and workspace isolation. Any `0014` change must remain forward-only
and validation-idempotent.

## API changes

No route-surface changes. Production composition must actually enforce the
approved configuration rules. Errors remain RFC 9457-safe and secret-free.

## Frontend changes

Fake OAuth is unconditionally unavailable in production. Preserve exact
same-origin callback validation, accessibility, honest local/test labels, and
safe UI error behavior.

## Backend changes

Serialize provider-identity account convergence and add safe claim/replay audit
evidence. Preserve the one-exchange-per-state guarantee.

## Security requirements

- Production cannot activate or serve fake/local social authentication.
- No unique-violation race may be the normal result of duplicate provider
  identity completion.
- Full-flow evidence must traverse the actual social API and database.
- Audit contains fixed identifiers/categories only, never OAuth secrets or raw
  provider-controlled content.

## Edge cases

- `NODE_ENV=production` with `ALLOW_FAKE_SOCIAL_AUTH=true`.
- Production social enabled with local, fake, or unimplemented KMS settings.
- Two distinct claimed transactions complete simultaneously for the same new
  provider identity.
- Replay arrives after a successful claim and audit writing itself fails.
- Fake authorize success and denial through the browser and real API.

## Acceptance criteria

1. The real API startup path rejects every unsupported production social
   configuration and never registers fake adapters or an undefined protector.
2. The fake provider page returns 404 in production even when the legacy allow
   flag is true.
3. Concurrent same-identity completion is explicitly serialized and tested;
   one active account remains and stored credentials decrypt with its ID.
4. Playwright proves the actual local fake authorize/callback/result/list flow
   without mocking those social endpoints.
5. Claim and replay rejection have safe, tested audit evidence.
6. All TASK-016 and Remediation 01 acceptance criteria still pass.

## Test plan

Run and report exact exit codes/counts for:

- focused unit/API/integration/E2E tests added here
- `pnpm check`
- `pnpm test:integration`
- `pnpm db:migrate:validate` twice
- `pnpm test:e2e`
- `git diff --check 9139985..HEAD`
- a secret/state/code/verifier/token/ciphertext response-log-audit scan

Commit and push only relevant tracked files. Report the commit SHA and any
deviation. Codex will review actual code/diffs before approval.

## Out of scope

Real provider calls, production KMS implementation, account lifecycle commands,
scheduling/publishing, TikTok posting, analytics, or later Sprint 4 checkpoints.
