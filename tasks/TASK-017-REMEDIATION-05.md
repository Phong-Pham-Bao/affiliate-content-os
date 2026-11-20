# TASK-017 Remediation 05 — Final failure fencing and secret-sentinel constraints

## Objective

Close the two remaining HIGH defects found by Codex while reviewing actual commit
`fe2ecba`: unchecked operation-failure fencing and incomplete database enforcement
of terminal revocation secret sentinels.

## Context

TASK-017 Remediation 04 correctly closes terminal replay, lease budgeting, most
CAS transitions, durable revocation handoff, timeout uncertainty, and runtime
secret wiping. Two requirements from `TASK-017-REMEDIATION-04.md` remain
incomplete:

1. `executeMutationWithIdempotency` executes `SQL_FAIL_OPERATION` after a failed
   mutation but ignores its `rowCount`. A stale operation owner can therefore
   lose its fence without surfacing `SocialOperationFenceLostError`.
2. Migration 0019 constrains terminal `encrypted_token` to be empty, but does not
   constrain `token_iv` and `token_auth_tag` to their defined zero-byte sentinels.
   Application SQL currently writes the right sentinels, but malformed terminal
   rows remain database-valid.

## Required implementation

### 1. Check the operation failure transition

- Capture the result of `SQL_FAIL_OPERATION` in the mutation catch path.
- Require exactly one updated row. If the result is zero or otherwise not one,
  throw `SocialOperationFenceLostError` instead of propagating the original
  mutation error.
- Do not add a provider retry or another side effect.
- Add a focused test proving a stale/invalid lease token on the failure path is
  detected and the stored operation is not overwritten.

### 2. Enforce every terminal secret sentinel in PostgreSQL

- Add forward-only migration `0020_threads_terminal_secret_sentinels.sql`; do not
  edit migrations 0015–0019.
- Replace or extend the existing revocation secret-wipe constraint so that:
  - terminal rows require `encrypted_token` length 0;
  - terminal rows require `token_iv` to equal the defined 12-byte all-zero
    sentinel;
  - terminal rows require `token_auth_tag` to equal the defined 16-byte all-zero
    sentinel;
  - nonterminal rows continue to require usable nonempty token material and
    valid IV/auth-tag lengths.
- Add controlled PostgreSQL tests proving malformed terminal IV or auth-tag
  values are rejected, valid terminal sentinels are accepted, and valid active
  rows remain accepted.

## Expected files

- `packages/infrastructure/src/social/postgres/social-mutation-idempotency.ts`
- `packages/infrastructure/migrations/0020_threads_terminal_secret_sentinels.sql`
- focused unit/integration tests for the two changes

## Database changes

One forward-only migration, numbered 0020, hardening revocation secret-sentinel
constraints. No historical migration edits.

## API changes

None.

## Frontend changes

None.

## Backend changes

Checked failure-transition CAS and complete terminal-secret database constraints.

## Security requirements

- A stale operation owner must never overwrite the terminal state selected by a
  current owner.
- Every terminal revocation row must be cryptographically unusable by database
  invariant, not only application convention.
- Never persist or log real tokens, IVs, auth tags, provider payloads, or raw
  transport errors in tests or production observations.

## Edge cases

- Failed mutation with a valid current lease.
- Failed mutation after its operation lease/fence was replaced.
- Terminal row with correct empty ciphertext but nonzero IV.
- Terminal row with correct empty ciphertext but nonzero auth tag.
- Active row with correctly sized credential material.

## Acceptance criteria

1. `SQL_FAIL_OPERATION` must affect exactly one row or raise
   `SocialOperationFenceLostError`.
2. Migration 0020 rejects every malformed terminal secret-sentinel combination.
3. Valid terminal sentinel rows and valid active revocation rows remain legal.
4. Migrations 0015–0019 are unchanged.
5. No provider retry or additional external side effect is introduced.
6. All required quality gates pass.

## Test plan

Run and report:

- focused failure-fencing tests;
- controlled PostgreSQL terminal-secret constraint tests;
- `pnpm check`;
- `pnpm test:integration`;
- `pnpm db:migrate:validate` twice;
- `pnpm test:e2e:clean`.

## Out of scope

- New social platforms or endpoints.
- UI changes.
- Redesign of the operation/revocation lifecycle.
- Changes unrelated to these two verified defects.
