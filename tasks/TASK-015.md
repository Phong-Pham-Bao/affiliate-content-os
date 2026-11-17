# TASK-015 — Sprint 3 Checkpoint E: Virtual office experience and release

## Objective

Deliver the complete Sprint 3 “boss managing an AI company” experience using only persisted workforce state. Add a polished Office/Board command center that is easy to scan, easy to observe, easy to turn into finished deliverables, and easy to report from; finish accessibility, browser flow, operational documentation, threat review, and Sprint 3 release evidence.

## Context

Checkpoint D is approved at commit `dec1d92`. The modular monolith already exposes tenant-scoped work-order detail, assignments, dependencies, artifacts, activity, retries, compliance, exact-revision decisions, and immutable approval snapshots. The current web UI has a six-role timeline, planning artifact cards, polling, Content Studio, and an employee modal, but it is still the Checkpoint B/C operational surface:

- `pollWorkOrderUntilTerminal` stops when the three planning items finish, so later script/compliance/approval state is not observed continuously;
- web `AssignmentOfficeState` is stale and omits real states such as `running`, `waiting_dependency`, `review_required`, `blocked`, and `canceled`;
- there is no Office/Board view toggle, state-driven office layout, activity/report inspector, or equivalent compact mobile view;
- activity API exists but is not loaded into the command center;
- loading/provider/budget/rate-limit/retry/stale/error states are not presented as a coherent operational model;
- no Sprint 3 browser E2E, release runbook, or focused threat review exists.

Checkpoint E is presentation, observability, accessibility, and release hardening. Do not invent workflow state, add timer progress, change compliance authority, or begin publishing/Sprint 4.

## Required implementation

### 1. One persisted office view-model

- Create a small pure mapping layer that derives employee presentation state from `WorkOrderDetailDTO`, work items, assignments, dependencies, artifacts, and activity records.
- Synchronize web workforce enums with the domain contracts. Represent every real state: `idle`, `preparing`, `queued`, `running`, `waiting_dependency`, `review_required`, `completed`, `blocked`, `failed`, and `canceled`. Derive retry-wait, budget, rate-limit, provider-outage, and stale/error presentation from persisted status/failure/blocked/activity codes only; do not add unsupported database states.
- Expose role name, department, current task, exact status label, named dependency, latest persisted report code, deliverable count/list, timestamps, and actionable error/retry information.
- Office and Board must consume the same derived model so they cannot disagree.
- No random values, fake percentages, fake files, sample reports, animation-driven transitions, or browser-only claims of success.

### 2. Durable full-lifecycle observation

- Fix polling so it follows the entire work order through planning, script generation/change requests, compliance, and human handoff; never stop merely because the three planning items finished.
- Use bounded abortable polling with safe backoff and a visible stale/paused/manual-refresh state after its observation deadline. Polling is only for fetching authoritative state and must never advance state itself.
- On every authoritative refresh, update detail, artifacts, and work-order activity consistently without applying a response from a previously selected workspace/product/order.
- Abort in-flight polling on selection/workspace/product changes and unmount. A refresh/restart must reconstruct the same office from server state.
- Add an explicit Refresh control and honest last-updated/connection state. Network/provider/rate-limit/budget errors remain readable and retryable without clearing existing deliverables.

### 3. Office and Board views

- Add an accessible segmented toggle for `Office` and `Board`; preserve the user's view preference locally when safe, with hydration-safe fallback.
- Office view: render a responsive semantic DOM office map with Strategy, Planning, Content, and Quality areas; six employee stations; a human review/handoff area; and clear workflow/dependency paths.
- Employee position/emphasis/movement is derived only from persisted state classes. Examples: at desk for queued/running, at dependency/handoff lane for waiting/review, at archive/output for completed, and in attention area for blocked/failed. Use CSS transforms/transitions only; never use a timer to move an employee or complete work.
- Board view: show the identical six employees and information in compact operational columns/lists suitable for keyboard users, screen readers, mobile, and reduced-motion use.
- Both views must make “what is happening, what is waiting, what failed, what is ready for me, and what product/report exists” obvious at a glance.
- Use the existing visual system and CSS/native elements; do not add external image/font/CDN dependencies or a canvas that hides semantics.

### 4. Responsive employee inspector and deliverables

- Replace or evolve the current employee modal into a responsive inspector: side panel on wide screens and a well-contained modal/sheet on narrow screens.
- Show role mandate, persisted execution state, exact work item, named dependencies, report/status code, timestamps, related artifacts/revisions/lifecycle, and relevant activity entries.
- Provide direct routes/actions to open real artifacts and Content Studio where supported. Do not expose prompts, secrets, raw provider errors, or internal stack details.
- Add a deliverables/report section that groups real artifacts by stage/role, clearly identifies accepted/review-required/rejected state, revision, provenance/usage when available, and human-action readiness.
- Keep viewer users read-only and hide/disable mutation controls according to actual capability. Retry/assign controls must respect `canManage`.

### 5. Honest operational states

- Provide deliberate UI for:
  - no work order / no assignments;
  - initial loading and background refreshing while keeping prior data readable;
  - waiting dependency with the dependency named;
  - queued and live running lease state without fake percent;
  - review required/human decision needed;
  - retry wait and retry-in-progress;
  - budget disabled/exhausted;
  - provider outage/rate limiting;
  - stale polling/manual refresh;
  - safe terminal failure, canceled, completed, and accepted handoff.
- Never label compliance as regulatory sign-off or imply that the Compliance Reviewer is the human approver. AI compliance is advisory; the authenticated human owns acceptance.
- Success banners and completed movement appear only after persisted server confirmation.

### 6. Accessibility and responsive behavior

- Office employee stations and Board entries are keyboard reachable. Implement documented Arrow/Home/End navigation within the office roster and Enter/Space inspection without trapping focus.
- The view toggle, inspector, refresh, retry, artifact links, and activity filters use native controls and visible focus.
- Add a concise screen-reader workforce summary with `aria-live` updates based on authoritative changes, without announcing every poll when nothing changed.
- Inspector focus moves in on open, Escape/close returns focus to the invoking employee, and background content is not interactable as a modal on narrow layouts.
- Honor `prefers-reduced-motion`: eliminate employee travel/ambient motion while preserving state color, text, icon/shape, and layout cues.
- Do not rely on color alone. Meet readable contrast, touch target, zoom/reflow, long Vietnamese/English text, and 320px mobile constraints.

### 7. Tests and browser flow

- Add pure mapping tests covering every persisted state, dependency naming, failures, human-review readiness, and Office/Board equivalence.
- Add component tests for semantic regions, accessible names, screen-reader summary, view toggle, employee selection/keyboard behavior, viewer read-only behavior, refresh/retry states, inspector content, and real artifact/activity rendering.
- Add a deterministic browser E2E flow using an appropriate repository-local test runner (Playwright is acceptable): load a product/work order from controlled API fixtures, switch Office/Board, inspect an employee, observe planning-to-script-to-compliance-to-review persisted responses, refresh/reload, open a real artifact surface, and verify no timer-created progress/success.
- Include automated accessibility assertions appropriate to the chosen test tooling and explicit reduced-motion/mobile viewport coverage. Keep browser fixtures bounded and free of secrets.
- Add the E2E command to the repository scripts and CI-quality documentation; do not silently omit it from release evidence.

### 8. Sprint 3 release documentation

- Update `docs/SPRINT-3-AI-WORKFORCE-PLAN.md` to mark Checkpoints A–E and Sprint 3 complete only after implementation/gates pass, including exact final state semantics and release evidence.
- Update architecture/API/product documentation for the Office/Board projection, polling lifecycle, activity exposure, human-only approval, and explicit Sprint 4 boundary.
- Add a concise Sprint 3 operations runbook covering local startup, migrations, API/web/worker health, worker/provider outage, stuck/expired jobs, budget exhaustion, retries, manual refresh, safe logs, backup/restore expectations, and rollback/forward-fix policy for forward-only migrations.
- Add a focused threat review covering tenant data exposure, prompt/provider leakage, unsafe activity rendering, stale/race UI, authorization of mutations, clickjacking/XSS/untrusted artifact content, denial-of-wallet/rate limits, approval spoofing, and the fact that office animation has no authority.
- State clearly that Sprint 3 produces a human-approved package but never publishes, schedules, connects social accounts, or calls unofficial platform APIs.

## Expected files

- New Office/Board/view-model/status-summary/inspector/activity/deliverable web components and focused helpers.
- `use-workforce-orders.ts`, polling/client/types/validators updates.
- `apps/web/app/globals.css` responsive and reduced-motion styles.
- Web unit/component/browser E2E tests and runner configuration/scripts.
- Sprint plan, architecture/product/API documentation, Sprint 3 runbook, and threat review.

## Database changes

None expected. Do not add a migration unless an unavoidable release blocker is proven to Codex. Office position/view preference is presentation state, not workflow authority.

## API changes

Prefer existing work-order detail, artifacts, activity, retry, compliance, revision, and decision routes. Do not add a fake progress or animation endpoint. If a minimal read-contract correction is unavoidable, keep it tenant-scoped, authenticated, no-store, documented, OpenAPI-synchronized, and tested.

## Frontend changes

Build the complete state-derived Office/Board command center, responsive inspector, activity/deliverables surfaces, honest full-lifecycle polling, accessibility behavior, and operational errors described above.

## Backend changes

None expected beyond a narrowly justified read-contract correction. Do not change orchestration, approval, budget, or publishing behavior for visual convenience.

## Security requirements

- Render all directives, artifact/report text, activity fields, codes, and provider metadata as untrusted text; no unsafe HTML execution.
- Never expose raw prompts, secrets, provider bodies, internal stack traces, or cross-tenant identifiers.
- UI capability checks are presentation only; server authorization remains mandatory for mutations.
- Office motion/state cannot enqueue, approve, retry, settle budget, or mutate workflow.
- Abort and identity-check async responses to prevent workspace/product/order switch data leakage.
- Keep CSP/security headers and no-store contracts intact; document threat mitigations.

## Edge cases

- Workspace/product/order changes during a poll or activity/artifact refresh.
- Refresh while jobs are queued/running, worker restart, expired lease, provider outage, or retry wait.
- Work order completes while Office view is hidden or the tab is backgrounded.
- Assignment missing, chief-of-staff without work item, dependency ID missing, unknown safe status/code, or artifact absent.
- Viewer opens inspector and review-required content but cannot mutate.
- Long role/report/error text, six employees at 320px width, 200% zoom, reduced motion, keyboard-only use.
- API error after prior valid data; old data remains visibly stale rather than disappearing or becoming success.

## Acceptance criteria

1. Office and Board render the same six-role persisted model and survive refresh/restart without timer-driven progress.
2. Full-lifecycle polling continues beyond planning through script/compliance/human handoff, aborts safely, and exposes manual refresh/stale states.
3. Every real state and operational error has an honest visible and screen-reader-readable presentation.
4. Employee inspection exposes real dependencies, artifacts/reports, activity, timestamps, and actionable safe errors with no fake data.
5. Keyboard, focus return, screen-reader summary, reduced motion, contrast/non-color cues, mobile/reflow, and viewer read-only behavior are proven.
6. Browser E2E proves Office/Board switching, persisted state evolution, inspection, reload preservation, artifact access, mobile/reduced-motion, and no synthetic success.
7. Runbook and threat review are complete; Sprint plan accurately marks Sprint 3 complete and preserves the Sprint 4 publishing boundary.
8. No database migration, microservice, WebSocket, social OAuth/publishing, or unofficial API behavior is introduced.
9. All repository and E2E quality gates pass.

## Test plan

- Run focused mapping/component/accessibility tests.
- Run the new browser E2E command in desktop and mobile/reduced-motion projects.
- Run `pnpm check`.
- Run `pnpm test:integration`.
- Run `pnpm db:migrate:validate` twice even though no migration is expected.
- Run `git diff --check dec1d92..HEAD` and `git diff --check a0df855..HEAD`.
- Verify OpenAPI synchronization and run a diff-scoped secret scan.
- Review the production build output and confirm no timer-based progress/sample report code remains in the Sprint 3 command center.

## Out of scope

- Image/video/audio generation or rendering production media.
- Social OAuth, account connection, scheduling, publishing, analytics ingestion, engagement automation, or Sprint 4.
- WebSockets, microservices, Kafka, a second database, or canvas-only workflow UI.
- Compliance overrides, AI approval, or changes to deterministic policy authority.
