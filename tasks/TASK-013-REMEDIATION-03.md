# TASK-013 REMEDIATION 03 — Long-running polling deadline correctness

## Objective

Fix the remaining Checkpoint C HIGH issue so long-running script change requests remain observable for their realistic 30–50 minute duration and never leave the Content Studio permanently stuck in a local `running` state after the poll budget expires.

## Context

Commit `6cd62af` added polling, but `pollChangeRequestUntilTerminal` currently polls every second for 60 attempts and then returns one final response even when it is still `pending`/`in_progress`. The caller has no non-terminal branch after that return, clears its active request reference, and leaves the banner at `running` forever. This fails the Product Owner's observability requirement and `TASK-013-REMEDIATION-02` acceptance criteria. Script generation may legitimately take 30–50 minutes.

## Required implementation

1. Replace the fixed 60-second behavior with bounded exponential/backoff polling suitable for at least a 60-minute legitimate request duration.
2. The polling helper must only resolve normally with a terminal `completed`, `failed`, or `canceled` response.
3. If the configured elapsed-time/request budget is exhausted while the server is still non-terminal, throw a distinct safe polling-deadline error; never return a non-terminal response as if terminal.
4. Keep polling abortable during delay and fetch, with no timers/listeners left after abort, workspace/artifact switch, or unmount.
5. The Content Studio must map polling-deadline/network interruption to an honest Vietnamese message/state and retain enough request identity to let the user resume status checking without creating a new change request or reservation.
6. Resuming status checking must reuse the existing `changeRequestId`; it must not call the mutation endpoint again and must not generate a new idempotency key.
7. Do not use fake completion, fake percentages, or optimistic revision refresh.

## Expected files

- `apps/web/src/lib/workforce-operation-polling.ts`
- Content Studio state/banner controls as minimally required
- Focused web unit tests

## Database changes

None.

## API changes

None. Reuse the existing change-request read endpoint.

## Frontend changes

Implement long-duration bounded backoff, a distinct deadline state/message, and resume-polling behavior using the existing request ID.

## Backend changes

None expected.

## Security requirements

- Resume only the same tenant-scoped workspace/artifact/change-request read.
- No new mutation, reservation, or idempotency key during poll resume.
- No stale response may update a switched workspace/artifact.

## Edge cases

- Request remains in progress for 30–50 minutes.
- Deadline expires milliseconds before completion.
- User resumes and the first response is completed.
- Abort occurs during fetch or backoff timer.
- Workspace/artifact switches after deadline and before resume.

## Acceptance criteria

1. A simulated 50-minute in-progress request continues polling and then refreshes the persisted completed revision.
2. Poll helper never resolves with a non-terminal response.
3. Deadline exhaustion produces an honest non-running terminal-local state and a resume action.
4. Resume polls the existing request ID and never calls request-changes mutation again.
5. Abort/switch/unmount clears timers and prevents stale UI updates.
6. All existing behavior and quality gates remain green.

## Test plan

- Fake-timer test for a 50-minute lifecycle followed by completion.
- Test deadline exhaustion throws the distinct error rather than returning `in_progress`.
- Test resume uses the same ID and zero mutation calls.
- Test abort during backoff and fetch cleanup.
- Run `pnpm check`, relevant web tests, `pnpm test:integration`, `pnpm db:migrate:validate` twice, `git diff --check 6cd62af..HEAD`, and secret scan.

## Out of scope

- Backend schema/API changes, Compliance execution, publishing, media generation, or broader UX redesign.
