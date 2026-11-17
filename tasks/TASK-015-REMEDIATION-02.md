# TASK-015 Remediation 02 — Actual event mapping, terminal polling, modal isolation, and truthful release docs

## Objective

Fix the four remaining review defects in commit `d4f4559` so Checkpoint E can proceed to final independent quality gates.

## Context

Codex reviewed the actual remediation diff and compared it with the persisted backend contracts. Do not redesign the implementation. Apply only the corrections below, add regression coverage, run all gates, commit, and push.

## Required implementation

### 1. Map the real planning failure audit event (HIGH)

`workforce-planning-failure-handlers.ts` persists the real event as:

- `action = 'artifact.failed'`
- `resource_type = 'work_item'`
- `resource_id = <work item id>`
- `changes_json` contains `workOrderId`, `errorCategory`, and safe `errorMessage`, but not necessarily `workItemId`

`isActivityForRole` currently enters the artifact-action branch first and returns false before using the authoritative `resource_type/resource_id` work-item association. Make resource type authoritative and order/nest the logic so this real event maps to the correct role. Preserve content-artifact author association and exclusion of unowned work-order-wide events. Add a regression fixture matching the exact persisted shape above and prove it appears only for the owning role.

### 2. Stop polling on canonical canceled status (HIGH)

The domain canonical work-order terminal value is `canceled`; the validator also normalizes legacy `cancelled` to `canceled`. Both `pollWorkOrderUntilTerminal` and the caller's terminal/stale check still test only `cancelled`, so a canceled order keeps polling until its deadline and is then falsely marked stale.

- Use one consistent terminal predicate covering canonical `completed`, `failed`, and `canceled` (plus a legacy alias only if a pre-validation path truly requires it).
- Apply it in polling and caller state handling; avoid duplicated divergent terminal logic where practical.
- Add unit coverage proving canonical canceled returns immediately and is not classified stale. Preserve bounded abort/backoff behavior.

### 3. Make modal background actually non-interactable (HIGH)

The current inspector traps Tab inside its dialog, but `aria-modal` plus a visual backdrop does not make the rest of the document non-interactable. While the inspector is open:

- Isolate the background using a robust React/DOM approach (`inert` on the appropriate application/background container, with carefully restored prior state, or an equivalent accessible modal implementation).
- Preserve the dialog itself as interactive and do not inert an ancestor containing the dialog.
- Restore background state on every close/unmount path; support repeated opens and React Strict Mode without leaving the app inert.
- Keep exact invoking-control focus restoration, Escape, click close, artifact-open transition, and focus containment working.
- Add a behavioral DOM test showing an actual background control/container becomes non-interactable while open and is restored after close/unmount. Do not rely only on rendered markup or Axe.

### 4. Correct Sprint plan claims and canonical semantics (MEDIUM)

`docs/SPRINT-3-AI-WORKFORCE-PLAN.md` currently contains inaccurate claims:

- It says polling is `1s–5s` with a `2-minute deadline`, but the production defaults are `2s`, max `10s`, max duration `60 minutes`, and max `120` attempts (the attempt cap normally bounds it sooner).
- Its “Definitive Workforce State Semantics” list does not match the domain canonical arrays in `mission-types.ts` and `work-item-types.ts` (for example it lists work-item `pending` and omits canonical states).
- It says all A–E work is delivered/verified even though AGENTS.md requires Codex to issue `STATUS: APPROVED` first.

Update the document from the domain source of truth and production polling code. State that implementation and engineer gates are complete but final Checkpoint E/Sprint 3 approval remains pending Codex review until that status is issued. Do not invent release evidence or change runtime values merely to match documentation.

## Expected files

- Workforce activity mapper/view-model and regression test.
- Work-order polling/caller terminal handling and regression test.
- Employee inspector modal isolation and behavioral accessibility test.
- `docs/SPRINT-3-AI-WORKFORCE-PLAN.md`.

## Database changes

None.

## API changes

None.

## Security requirements

- Render activity as safe text and retain tenant-scoped API behavior.
- Modal isolation must always be reversed on close/unmount and must not strand the whole application as inert.
- Do not expose provider bodies, prompts, secrets, or stack traces.

## Acceptance criteria

1. The exact persisted `artifact.failed` + `work_item` event maps only to its work item's role.
2. Canonical `canceled` is terminal everywhere and never becomes a false stale polling state.
3. Inspector background is actually non-interactable while open and restored on close/unmount, with focus behavior preserved.
4. Sprint plan matches domain enums and production polling defaults and does not claim Codex approval prematurely.
5. No database/API/orchestration/Sprint 4 behavior changes.
6. All focused and complete repository gates pass.

## Test plan

- Run focused workforce view-model, polling, and accessibility/component tests.
- Run `pnpm test:e2e`.
- Run `pnpm check`.
- Run `pnpm test:integration`.
- Run `pnpm db:migrate:validate` twice.
- Run `git diff --check dec1d92..HEAD` and `git diff --check a0df855..HEAD`.
- Run diff-scoped secret scan and confirm local HEAD equals origin after push.

## Out of scope

- New endpoints, migrations, retry redesign, orchestration changes, publishing, social integrations, or Sprint 4 work.
