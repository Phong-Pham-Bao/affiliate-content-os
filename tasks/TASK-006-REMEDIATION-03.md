# TASK-006 Remediation 03: Complete Current-User Context Validation

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Remediates: Codex final review of TASK-006 at PR head `ef1ad57995911df1e67e2e491679d6f7545f2978`

Depends on: `TASK-006.md`, `TASK-006-REMEDIATION-01.md`, and `TASK-006-REMEDIATION-02.md`

## Objective

Close the one remaining TASK-006 hostile-DTO defect by requiring `getCurrentUser` to validate every field of the authenticated user snapshot before calling the workspace-summary port.

This remediation is intentionally narrow. It changes no product behavior, HTTP contract, database contract, OIDC flow, session lifecycle, CI policy, or architecture.

## Context

At PR head `ef1ad57995911df1e67e2e491679d6f7545f2978`, `getCurrentUser` enforces the exact outer context, user, and session key sets and captures own data descriptors. It then validates only the user `id`, `email`, and `displayName` values. The captured values for `identityProvider`, `identitySubject`, `status`, `createdAt`, `updatedAt`, and `version` are not validated before `workspaceSummary.listActiveWorkspaceSummaries` runs.

The exact independent reproduction passed this malformed user through the boundary:

```text
identityProvider = 42
identitySubject = { sentinel: "x" }
status = "disabled"
createdAt = "invalid"
updatedAt = "invalid"
version = 0
```

Observed result:

```json
{ "accepted": true, "workspaceCalls": 1 }
```

This repeats the closed-DTO root cause governed by TASK-006 Remediation 01. The required result is a fresh `AuthenticationRequiredError` before any workspace call.

## Required implementation

### Exact user validation in `getCurrentUser`

After the existing proxy, prototype, exact-key, symbol, and own-data-descriptor checks, validate all nine captured user fields without coercion or caller-controlled hooks:

| Field              | Exact contract                                                    |
| ------------------ | ----------------------------------------------------------------- |
| `id`               | canonical lowercase UUIDv7 string                                 |
| `identityProvider` | non-empty primitive string with no leading or trailing whitespace |
| `identitySubject`  | non-empty primitive string with no leading or trailing whitespace |
| `email`            | required key whose value is a primitive string or `null`          |
| `displayName`      | required key whose value is a primitive string or `null`          |
| `status`           | exactly the primitive string `active`                             |
| `createdAt`        | canonical UTC timestamp string in `YYYY-MM-DDTHH:mm:ss.sssZ` form |
| `updatedAt`        | canonical UTC timestamp string in `YYYY-MM-DDTHH:mm:ss.sssZ` form |
| `version`          | primitive safe integer greater than or equal to `1`               |

Require `createdAt <= updatedAt`.

Use the descriptors already captured by `getCurrentUser`. Do not read the properties again from the caller-owned object. Do not stringify, coerce, serialize, inspect, log, or attach rejected values.

Every invalid value must throw a fresh `AuthenticationRequiredError` before `workspaceSummary.listActiveWorkspaceSummaries` is called.

### Validation order

Preserve this order:

1. validate outer context object, exact keys, and own data descriptors;
2. validate `rotatedToken`;
3. validate user object, exact nine keys, and own data descriptors;
4. validate all nine captured user values and `createdAt <= updatedAt`;
5. validate session object, exact four keys, values, user-ID equality, and expiry ordering;
6. only then call the workspace-summary port;
7. validate and copy/freeze the workspace result and final response.

No dependency call may occur after a validation failure.

### Error and non-disclosure behavior

- Throw only a fresh fixed `AuthenticationRequiredError` for malformed current-user context.
- Do not expose or attach the original context, nested user, rejected value, cause, metadata, or sentinel.
- Do not invoke getters, proxy traps, `toString`, `valueOf`, `toJSON`, custom inspection, iterators, or serialization hooks.
- Preserve zero sentinel disclosure through message, stack, `String`, JSON, inspection, logging, stdout, stderr, thrown output, and HTTP Problem Details.

## Expected files

Production:

- `packages/application/src/auth/get-current-user.ts`

Tests:

- the existing focused current-user/application adversarial test files; create at most one narrowly named test file only if the existing files cannot express the complete matrix clearly.

Specification:

- `tasks/TASK-006-REMEDIATION-03.md`

No other production file is expected. Stop and report before changing another production file.

## Database changes

None. Do not change migrations, schema, SQL, adapters, constraints, indexes, or PostgreSQL configuration.

## API changes

None. Preserve every route, status, response body, Problem Details code, header, cookie, redirect, rate limit, and committed OpenAPI contract.

## Frontend changes

None.

## Backend changes

Only the exact `getCurrentUser` validation and its focused regression tests.

## Security requirements

- Validate captured descriptor values only; never re-read untrusted properties.
- Reject proxies, revoked proxies, accessors, inherited substitutes, missing keys, extra keys, symbols, and malformed primitive values before the workspace call.
- Reject inactive/unknown status values and noncanonical timestamps.
- Do not normalize omitted or `undefined` values to `null`.
- Do not freeze caller-owned values as a substitute for validation and copying.
- Preserve all TASK-006 Remediation 01 hostile-boundary and child-process non-disclosure guarantees.

## Edge cases

Tests must independently cover at least:

- numeric, object, symbol, bigint, empty, and whitespace-padded `identityProvider`;
- the same invalid matrix for `identitySubject`;
- missing, `undefined`, numeric, object, and symbol `email`/`displayName`, while accepting primitive strings and `null`;
- `disabled`, unknown, empty, object, and symbol `status`;
- missing milliseconds, offsets, space-separated timestamps, invalid calendar values, empty strings, objects, and symbols for both timestamps;
- `createdAt > updatedAt`;
- non-number, `NaN`, infinity, fractional, zero, negative, and unsafe `version`;
- accessor-backed fields, inherited fields, extra string keys, symbol keys, hostile proxies, and revoked proxies;
- a fully valid exact user context that still reaches the workspace port and returns the unchanged public response shape.

For every malformed case, assert:

- exact `AuthenticationRequiredError` type and fixed message;
- `workspaceSummary.listActiveWorkspaceSummaries` call count is zero;
- no hostile hook or trap executes where non-observing rejection is required; and
- no sentinel appears on any required output surface.

## Acceptance criteria

1. `getCurrentUser` validates all nine user values from captured own data descriptors.
2. `identityProvider` and `identitySubject` are exact non-empty trimmed primitive strings.
3. `email` and `displayName` are required primitive-string-or-null fields.
4. `status` is exactly `active`.
5. `createdAt` and `updatedAt` are canonical timestamps and satisfy `createdAt <= updatedAt`.
6. `version` is a safe integer at least `1`.
7. Every malformed case fails before the workspace-summary call.
8. The exact reproduction at the reviewed SHA changes from accepted/workspaceCalls `1` to rejected/workspaceCalls `0`.
9. Valid contexts retain the exact public `/api/v1/me` result and OpenAPI contract.
10. All prior TASK-006 and remediation tests remain passing.
11. The final diff contains no unrelated production change.
12. All required verification gates pass on one exact final SHA, and local, remote, and PR heads agree.

## Test plan

Run focused tests for the current-user validation matrix and hostile/non-disclosure behavior, then run the complete inherited TASK-006 gate set:

1. `corepack pnpm install --frozen-lockfile`
2. `corepack pnpm env:local`
3. `docker compose config --quiet` with validation environment
4. `corepack pnpm verify:infrastructure-pins`
5. start pinned PostgreSQL and wait for health
6. `corepack pnpm db:migrate:validate`
7. `corepack pnpm test:integration`
8. `corepack pnpm format:check`
9. `corepack pnpm lint:boundaries`
10. `corepack pnpm lint`
11. `corepack pnpm typecheck`
12. `corepack pnpm test`
13. `corepack pnpm build`
14. deterministic OpenAPI drift check
15. `corepack pnpm check`
16. `corepack pnpm audit --prod --audit-level high`
17. `corepack pnpm verify:trivy-exception`
18. pinned-image manifest inspection
19. both blocking Trivy scans and the expected-failing no-ignore negative control
20. compiled API and worker runtime smokes
21. infrastructure shutdown in `finally`
22. `git diff --check origin/main...HEAD`
23. external clean-checkout verification at the final exact SHA
24. final clean worktree and exact local/remote/PR SHA agreement

Report every skipped or unavailable gate honestly. A skipped required gate is not a pass.

## Out of scope

- Any change outside the current-user validation defect.
- New routes, DTO fields, API/OpenAPI behavior, database changes, dependencies, configuration, CI changes, or documentation changes.
- OIDC, login transaction, session rotation, PostgreSQL adapter, crypto, frontend, worker, authorization, social OAuth, product, vendor, Redis, KMS, hosting, retention, or deployment work.
- Refactoring into a generic validator or framework.
- Weakening, deleting, skipping, suppressing, or rewriting existing tests/security gates.

## Implementation handoff requirements

Antigravity must report:

- baseline and final full SHAs;
- exact changed files and diff summary;
- the implemented nine-field validation matrix and ordering;
- before/after output for the exact reproduction;
- focused tests with zero workspace-call and zero-sentinel evidence;
- every required gate with command, exit status, and summary;
- generated/OpenAPI non-change evidence;
- final local/remote/PR SHA equality and clean worktree; and
- confirmation that PR #6 remains open and unmerged.

Codex will independently inspect and reproduce the implementation. Agy's report is context, not proof. TASK-006 remains incomplete until Codex returns `STATUS: APPROVED`.
