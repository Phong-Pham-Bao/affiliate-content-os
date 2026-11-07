# TASK-011-REMEDIATION-01 — Sprint 3 Checkpoint A Review Findings

Status: Changes required by Codex review on 2026-11-08

Owner: Antigravity (Implementation Engineer)

Reviewer: Codex (Lead Architect / CTO / Final Reviewer)

## Objective

Remediate the blocking correctness and test-evidence gaps found in Codex's review of commit `0a2bcb9` for `TASK-011`, without expanding Checkpoint A into provider execution, HTTP routes, or UI work.

Checkpoint A must preserve the repository's established idempotency semantics, bind every immutable context hash to the exact versions revalidated under transaction locks, fail closed when persistence rows violate contracts, and provide the PostgreSQL evidence required by the approved task.

## Context

Codex reviewed the actual diff `9293bbb..0a2bcb9` against `AGENTS.md`, `TASK-011`, ADR-023, and the current application/infrastructure conventions.

The implementation passes format, lint/boundary checks, typecheck, 1,647 unit tests, OpenAPI consistency, and build when gates are run without `.next` concurrency races. PostgreSQL tests could not be executed during review because Docker Desktop was not running; `pnpm infra:up` failed because the Docker API pipe was unavailable.

Review findings:

1. **HIGH — Expired idempotency rows are never reclaimed.** `executeKickoffWorkOrderTransaction` selects any matching row without checking `expires_at`. It therefore replays or conflicts forever, unlike the established catalog/workspace transaction behavior.
2. **HIGH — Locked source versions are read but not bound to the context hash.** The application computes the hash before the transaction. The transaction selects product, fact-set, and analysis versions under locks but does not compare them with the versions used to compute the hash or recompute/verify the hash. A concurrent update between the application reads and transaction locks can persist a stale context descriptor.
3. **MEDIUM — Required integration evidence is incomplete.** The suite lacks expired-key reuse, version-change TOCTOU, cross-tenant/cross-product source rejection at the transaction boundary, and rollback injection after each insertion stage.
4. **MEDIUM — Persistence mapping fails open.** Workforce mappers replace invalid mission/status/task/artifact/office-state values with plausible defaults. Invalid persisted values must throw a sanitized database mapping error rather than be misreported as legitimate workflow state.
5. **MEDIUM — Mutable byte/collection boundaries are not proven safe.** Add explicit defensive-copy and mutation-safety coverage for context hashes, idempotency hashes, analysis ID collections, graph collections, and returned read DTO collections.

The `TASK-011` phrase `catalog.write` is not a valid repository capability. The implementation's use of the existing closed capability `catalog.manage` is the intended compatible interpretation and is not a finding.

## Required implementation

### 1. Restore established idempotency expiry semantics

- Select and validate the complete idempotency row shape, including `expires_at`.
- While holding the existing transaction-scoped advisory lock, compare expiry to the transaction's authoritative database time using the same semantics as existing catalog/workspace commands.
- If the row is expired, delete/reclaim it inside the same transaction and continue with a fresh kickoff.
- If the row is live and the request fingerprint matches, replay the original work order without creating any graph, context package, audit event, or billable unit.
- If the row is live and the fingerprint differs, throw `IdempotencyKeyReusedError`.
- Do not return raw `response_json` as a successful fallback when the referenced work order is missing or invalid. Treat that as a sanitized persistence consistency error.
- Use constant-time byte comparison where repository conventions require it.

### 2. Bind the context hash to locked source versions

- Extend the application/persistence command snapshot as needed so the transaction can prove which product, fact-set, and accepted-analysis versions were hashed.
- Under transaction locks, revalidate:
  - product identity, active status, current fact-set identity, and exact product version;
  - fact-set identity, product identity, confirmed status, and exact fact-set version;
  - every normalized analysis identity, workspace, product identity, accepted status, and exact analysis version.
- Either recompute the canonical SHA-256 descriptor from the locked rows and compare it with a defensive copy of the supplied hash, or compare every locked version with the immutable descriptor values and then recompute before insertion. A stale descriptor must fail atomically and visibly; it must never create a context package using mismatched versions.
- Keep the canonical descriptor limited to approved IDs, versions, and schema version. Do not add product text, fact content, analysis content, or directive text.
- Preserve deterministic analysis ordering and duplicate normalization.

### 3. Fail closed at persistence mapping boundaries

- Replace all fallback defaults in workforce row mappers with strict validation.
- Unknown mission types, work-order states, work-item task keys, artifact types, work-item states, role keys, assignment states, invalid versions, invalid timestamps, malformed hashes, missing required joined fields, and unsafe nullable combinations must throw a sanitized `DatabaseError` (or the established equivalent).
- Do not leak SQL, row payloads, directive text, hashes, or tenant data in error messages.
- Keep PostgreSQL row types inside infrastructure.

### 4. Defensive-copy immutable boundaries

- Copy mutable `Uint8Array`/`Buffer` inputs when constructing application/domain snapshots and before persistence ownership changes.
- Freeze or copy returned arrays/collections deeply enough that caller mutation cannot alter a retained command, graph, stored hash, cached result, or subsequent read result.
- Do not attempt to rely on TypeScript `readonly` alone for runtime immutability.

### 5. Complete the required PostgreSQL evidence

Add focused integration tests that prove:

- an expired kickoff idempotency row is reclaimed and the same key can create a new work order with a different valid command;
- a live same-key/same-command request replays exactly one graph and audit event;
- a live same-key/different-command request conflicts;
- concurrent identical and conflicting requests serialize correctly;
- changing the product, fact set, or selected analysis version after the application snapshot but before locked persistence causes atomic failure and zero inserted workforce/audit/idempotency rows;
- cross-workspace and same-workspace/wrong-product analyses are rejected inside the transaction;
- each insertion stage can be fault-injected and leaves zero partial context packages, links, work orders, work items, dependencies, assignments, idempotency rows, and audit events;
- strict mappers reject malformed rows instead of substituting defaults;
- mutable caller arrays/bytes cannot change the persisted descriptor or retained command;
- migration `0008` applies on a clean database, validates twice through the repository migration validator, and preserves all prior integration suites.

Use deterministic fault-injection seams local to tests/infrastructure. Do not add production-only flags, environment backdoors, or partial commits.

## Expected files

- `packages/application/src/workforce/*` where immutable descriptor/version data or defensive copying must be added
- `packages/application/test/workforce/*`
- `packages/domain/src/workforce/*` only if runtime snapshot/hash-copy helpers belong in the domain boundary
- `packages/domain/test/workforce/*`
- `packages/infrastructure/src/workforce/*`
- `packages/infrastructure/test/integration/workforce-*.integration.test.ts`
- migration `0008_ai_workforce_foundation.sql` only if a proven schema invariant is missing; do not edit prior migrations
- documentation only if a contract changes or the implementation revealed an inaccurate statement

Do not modify unrelated `plans/` artifacts.

## Database changes

No new migration number is expected. Modify migration `0008_ai_workforce_foundation.sql` only if required to satisfy an already-approved `TASK-011` invariant and only while Checkpoint A remains unmerged/unreleased.

Do not alter migrations `0001` through `0007`. Do not add destructive backfills.

## API changes

None. Do not add Fastify routes or modify OpenAPI.

## Frontend changes

None. The Product Owner's usability goals—easy observation, product entry, and merchandise reporting—remain authoritative for later Sprint 3 UI checkpoints, but this remediation must not expose a partial or simulated workflow.

## Backend changes

- Correct the kickoff transaction's expiry and locked-version behavior.
- Make workforce persistence mapping strict and sanitized.
- Add defensive copying at mutable boundaries.
- Add the required unit and real-PostgreSQL regression tests.
- Do not enqueue jobs, reserve AI budget, call Gemini, or change worker scheduling.

## Security requirements

- Preserve strict workspace scoping and composite tenant predicates.
- Revalidate every context source under transaction locks.
- Never store or log prompt text, provider responses, chain-of-thought, secrets, session/cookie values, email, URLs, or arbitrary tools.
- Audit payloads remain allowlisted and must not contain directive or source content.
- Persistence errors must be sanitized and fail closed.
- Idempotent replay must not create duplicate audits, graphs, or future billable units.

## Edge cases

- Expiry exactly equal to transaction time.
- Expired row with a different request hash.
- Live row whose resource is missing or belongs to another workspace.
- Product version changes without current fact-set identity changing.
- Fact-set or analysis version changes without status changing.
- Analysis order differs but normalized set is identical.
- Duplicate normalized analysis IDs.
- Concurrent first request, identical replay, and conflicting reuse.
- Fault after every insert group.
- Mutation of input hashes/arrays before and during an asynchronous persistence call.
- Malformed database enums, timestamps, versions, hashes, and joined role keys.

## Acceptance criteria

1. Expired kickoff idempotency rows are reclaimed atomically; live replay/conflict behavior matches existing repository semantics.
2. The context hash persisted by kickoff is proven to describe the exact product, fact-set, and analysis versions locked in the transaction.
3. Any stale source version causes complete rollback with no workforce, idempotency, or audit residue.
4. Workforce mappers reject invalid persistence data without plausible default substitution or sensitive leakage.
5. Mutable caller inputs and returned collections cannot mutate retained or persisted state.
6. Real PostgreSQL tests cover expiry, TOCTOU, tenant/product isolation, per-stage rollback, replay, mismatch, and concurrent kickoff.
7. Migration `0008` validates on a clean database and on repeated validation; prior schema/data remain valid.
8. No HTTP route, UI, provider call, worker execution, fake progress, or AI approval is added.
9. All repository quality gates and all PostgreSQL integration suites pass.

## Test plan

Run and report exact exit codes and counts for:

- focused workforce domain/application unit tests;
- focused workforce PostgreSQL integration tests;
- `pnpm check`;
- `pnpm test:integration` with the repository's disposable-database safety variables and PostgreSQL running;
- `pnpm db:migrate:validate` twice as required by `TASK-011`;
- `git diff --check 0a2bcb9..HEAD`;
- a secret scan of the remediation diff.

Do not run build, typecheck, and unit/boundary tests concurrently against the same `.next` directory; that creates nondeterministic generated-file races unrelated to product correctness.

## Out of scope

- Checkpoint B execution, Gemini calls, prompt/output schemas, artifacts, retry/repair, or budget reservation
- HTTP routes, OpenAPI additions, virtual-office UI, board UI, animation, polling, or reporting screens
- Content approval, publishing, social OAuth, scheduling, analytics, or media generation
- Redesigning the closed workspace capability model
- New infrastructure, services, queues, databases, or provider dependencies

## Implementation handoff

Antigravity must implement this remediation on `agy/task-011-sprint3-checkpoint-a`, commit and push the result, and report:

- final commit SHA;
- changed-file list;
- any deviation from this specification before redesigning a boundary;
- exact PostgreSQL and quality-gate evidence;
- confirmation that unrelated untracked `plans/` files were not staged or committed.

Codex must then review the actual remediation diff and rerun proportionate gates. `TASK-011` remains incomplete until Codex explicitly returns `STATUS: APPROVED`.
