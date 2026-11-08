# TASK-013 REMEDIATION 02 — Observable change requests and terminal-state correctness

## Objective

Complete Checkpoint C by making targeted script regeneration observable end to end, preserving one idempotency key across ambiguous transport failures, and ensuring stale/context-drift/terminal paths reach honest durable states without repeated provider calls or stuck assignments.

## Context

Commit `7c086fc` passes the automated gates but is not approved. Codex reviewed the actual runtime flow and found HIGH-severity gaps: the Content Studio discards the returned change-request ID and remains in a local `running` state forever; user retries after an ambiguous network failure generate a new idempotency key; unavailable Web Crypto falls back to the shared literal `key`; and failed/stale assembly paths can leave the Scriptwriter assignment marked `running`. Authoritative-context drift currently throws from assembly after provider execution, rolling back the successful settlement and causing repeated provider execution instead of an honest terminal state.

## Required implementation

1. Implement observable change-request lifecycle in the Content Studio.
   - Retain the exact `changeRequestId` returned by the 202 response.
   - Poll the existing tenant-scoped change-request endpoint with bounded, abortable polling tied to workspace/artifact/component lifetime.
   - Map pending/in-progress/completed/failed/canceled and safe failure categories to honest UI states; never use fake percentages or timer-generated success.
   - On completion, reload artifact detail and immutable revision history, select the persisted resulting revision, and show `ready` only after server confirmation.
   - On failure/stale conflict/provider/budget failure, stop polling and show a useful Vietnamese state/message while keeping the prior revision readable.
   - Prevent stale responses from a previous workspace/artifact from updating the current screen.

2. Preserve idempotency across ambiguous client retries.
   - Generate one cryptographically strong key per logical manual-save or request-changes submission.
   - Retain and reuse that same key when the request has an ambiguous network/timeout failure and the user retries the identical logical payload.
   - Clear/rotate the key only after a definitive server response or when the logical payload/submission changes or is canceled.
   - Never fall back to a constant, predictable, timestamp, or `Math.random` key. If Web Crypto is unavailable, fail visibly before sending.
   - Keep API client mutation signatures requiring a non-empty idempotency key rather than optional omission.

3. Make change-request terminal states consistent across backend and UI.
   - When a change request becomes completed, failed, canceled, or stale-conflicted, transition the Scriptwriter assignment out of `running` to the appropriate honest review/failure state without changing artifact approval.
   - A stale-base conflict must remain distinguishable from provider failure through a bounded safe code/state, not only a free-text string.
   - Ensure duplicate terminalization is idempotent and tenant/order scoped.

4. Prevent authoritative-context drift from causing repeated provider calls.
   - Revalidate the exact content brief/planning revision authority before invoking the provider for every script unit.
   - Retain the assembly-time race check, but if drift occurs after the provider call, settle/terminalize deterministically without rolling back into repeated provider execution.
   - Release or settle reservations exactly once, terminalize affected initial/change-request workflow state honestly, and do not create an artifact revision from stale context.
   - Do not report context drift as provider timeout or retry it as a transient provider failure.

5. Correct attempt accounting.
   - `claimNextJob` already increments `attempt`; script transient settlement must not increment it a second time.
   - Prove the configured maximum number of provider attempts is honored exactly and exhausted jobs release reservations once.

## Expected files

- Content Studio state hook/components and web API client/tests
- Worker pre-provider authoritative-context validation
- Script settlement/assembly and change-request state helpers/tests
- Application/API DTOs or safe status codes if minimally required
- PostgreSQL integration tests for terminal-state and retry accounting
- Relevant API/architecture documentation if response contracts change

## Database changes

Prefer no migration. If a bounded structured failure code is not representable safely in the current schema, add only a forward-only minimal migration; do not rewrite migrations `0010` or `0011`.

## API changes

Reuse the existing change-request polling endpoint. Any added status/failure code must be bounded, safe, documented, tenant-scoped, and reflected in OpenAPI. Mutation endpoints continue to require `Idempotency-Key`.

## Frontend changes

Add abortable server-driven polling, persisted completion refresh, honest terminal messaging, stale-workspace protection, and stable retry keys. No optimistic revision creation and no static idempotency fallback.

## Backend changes

Add pre-provider context validation, deterministic post-provider drift terminalization, exact attempt accounting, and consistent assignment/change-request terminal transitions with lease/version/tenant fencing.

## Security requirements

- No static/predictable idempotency keys.
- No cross-workspace polling updates or tenant data leakage.
- Context drift never reaches provider when detectable beforehand and never creates stale artifacts.
- Provider keys, prompts, and raw errors remain server-only.
- AI cannot approve content or execute Compliance Review.

## Edge cases

- Server commits a change request but the 202 response is lost; the user retries.
- Web Crypto is unavailable.
- Workspace/artifact changes while a poll is in flight.
- Component unmounts while polling.
- Change request completes between two polls.
- Manual edit wins while regeneration is in flight.
- Planning revision changes before provider invocation or between provider response and assembly.
- One selected unit terminally fails while other units are queued/running.
- Lease expires and a job is reclaimed at the final configured attempt.

## Acceptance criteria

1. A successful request-changes submission automatically reaches the persisted new revision in the Content Studio without page reload.
2. Failed/stale/canceled requests stop polling and show honest terminal state while the prior revision remains readable.
3. Polls are bounded/abortable and cannot update a different workspace/artifact screen.
4. An ambiguous retry of the identical logical submission reuses one key and creates one request/reservation; changed payload gets a new key.
5. No request is sent if a cryptographically secure key cannot be generated.
6. Scriptwriter assignment never remains `running` after a terminal change-request outcome.
7. Context drift creates no revision, does not repeat provider calls, and releases/settles budget exactly once.
8. Script provider attempts equal the configured maximum; settlement does not double-increment attempts.
9. All existing tenant, lease, evidence, revision, and idempotency protections remain intact.
10. All quality gates pass.

## Test plan

- Web tests with fake timers/server responses for in-progress to completed refresh, failed/stale stop, abort on switch/unmount, and no fake completion.
- Web tests for ambiguous retry key reuse, payload change key rotation, and Web Crypto unavailable failure without fetch.
- Worker/PostgreSQL tests for pre-provider context drift (gateway call count zero) and post-provider race terminalization (gateway call count one).
- PostgreSQL tests for assignment state on completed, terminal failure, and stale conflict.
- Job tests proving exact attempt count and one reservation release.
- Run `pnpm check`, `pnpm test:integration`, `pnpm db:migrate:validate` twice, `git diff --check 7c086fc..HEAD`, and a secret scan.

## Out of scope

- Compliance execution/approval, publishing, media generation, scheduling, analytics, or social OAuth.
- Replacing PostgreSQL jobs/idempotency or redesigning the Content Studio.
