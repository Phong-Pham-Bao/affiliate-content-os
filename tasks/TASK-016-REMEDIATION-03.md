# TASK-016 Remediation 03 — Reproducible CI E2E and controlled concurrency proof

## Objective

Fix the final blocking review findings in commit `8ff45e2` so TASK-016 can be
approved without relying on a developer's root `.env` or a merely nominal
concurrency test.

## Context

Codex reviewed the actual implementation and found:

1. **HIGH — full-stack E2E is not reproducible on clean CI.** Next rewrites are
   resolved at build time. The implementation loads the developer root `.env`
   in `next.config.mjs`, so the local prebuilt application embeds port 3001 and
   passes. On CI, where no root `.env` is required/present, `pnpm check` builds
   the web app with the fail-closed `127.0.0.1:0` target. Supplying
   `WEB_API_BASE_URL` only to `next start` cannot change that compiled rewrite.
2. **HIGH — the same-identity upsert test has no controlled overlap.** It uses
   `Promise.all`, but no barrier proves both completion transactions reached and
   contended on the advisory lock. Either operation may finish before the other
   reaches the lock, so the test would pass even without serialization.
3. **MEDIUM — the Playwright workaround is globally scoped.** Every command
   executed through `scripts/run-with-env.mjs` now inherits
   `PW_DISABLE_TS_ESM=1` and `NODE_OPTIONS=--import tsx`, including migrations,
   integration tests, and smoke commands. This must be limited to Playwright.

## Required implementation

### 1. Make E2E build/runtime deterministic without `.env`

- Ensure `pnpm test:e2e` on a clean CI checkout builds or serves the web app
  with the exact E2E API target before tests run. The target must not depend on
  a root `.env`, a previous `pnpm check` build, or a server already on port
  3000/3001.
- Prefer an explicit E2E web-server launcher/build step or a dedicated runtime
  proxy architecture. Do not teach production `next.config.mjs` to silently
  load a developer `.env` merely to make tests pass.
- Do not set `reuseExistingServer` for the full-stack proof in a way that can
  silently reuse an incorrectly configured local server. Fail clearly on port
  collision or use dedicated deterministic ports.
- Add a clean-environment verification that temporarily removes dependency on
  the root `.env` (without deleting or modifying the user's file), builds/starts
  the harness, and runs the real happy and denial flows.

### 2. Add a controlled PostgreSQL lock barrier

- Replace the nominal `Promise.all` proof with a deterministic barrier.
- Hold the exact provider-identity advisory key from a dedicated PostgreSQL
  test connection before launching both completion promises; verify both
  transactions have reached a waiting/contending state (using safe bounded
  polling of `pg_locks`/`pg_stat_activity` or an equivalent explicit hook), then
  release the blocker.
- Use bounded timeouts so a regression fails instead of hanging.
- Assert both completions settle under the documented last-writer rotation
  contract, one account/credential row exists, credentials decrypt with the
  authoritative ID, and both terminal results remain unique.
- The test must fail if the production advisory-lock acquisition is removed.

### 3. Scope the Playwright loader workaround

- Apply `PW_DISABLE_TS_ESM` and `NODE_OPTIONS=--import tsx` only when launching
  Playwright/E2E, not in the general `prepareEnvironment` path used by other
  commands.
- Preserve pre-existing `NODE_OPTIONS` safely and avoid duplicate imports.
- Add a focused script/config test proving non-Playwright commands are not
  mutated and Playwright receives the required flags on Windows/Node 24.

## Expected files

Focused changes to Playwright/package scripts, an E2E launcher if needed,
`next.config.mjs` (remove the `.env` workaround unless independently justified),
and the PostgreSQL social integration test. Preserve all unrelated untracked
files. No migration or product route changes are expected.

## Security requirements

- Production proxy configuration remains fail-closed and does not silently
  consume developer-local configuration.
- Test-only loader flags do not leak into production or unrelated commands.
- Concurrency proof has bounded waits and cannot leave advisory locks/sessions
  behind after failure.

## Acceptance criteria

1. Full-stack happy and denial E2E pass from a clean CI-like environment with
   no root `.env` dependency and no pre-existing `.next` build/server reuse.
2. The concurrency test demonstrably overlaps at the exact production advisory
   lock and fails if that lock is removed.
3. General `run-with-env` commands do not receive Playwright-only flags.
4. All prior TASK-016 acceptance criteria and gates remain green.

## Test plan

- focused config/script tests
- controlled-barrier PostgreSQL integration test
- clean CI-like happy/denial Playwright run
- `pnpm check`
- `pnpm test:integration`
- `pnpm db:migrate:validate` twice
- `pnpm test:e2e`
- `git diff --check 8ff45e2..HEAD`

Commit and push only relevant files. Report exact commands, exit codes, counts,
SHA, and deviations. Codex will review actual code and rerun proportionate
gates.

## Out of scope

No real providers, production KMS, lifecycle commands, scheduling, publishing,
analytics, or later Sprint 4 checkpoints.
