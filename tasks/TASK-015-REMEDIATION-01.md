# TASK-015 Remediation 01 — Checkpoint E correctness and release evidence

## Objective

Correct the Checkpoint E implementation at commit `fec84c1` so the Office/Board UI is an honest, accessible projection of persisted Sprint 3 state and the browser/release evidence proves the complete required flow.

## Context

Codex reviewed the actual `dec1d92..fec84c1` diff against `TASK-015`. The visual foundation and full-lifecycle polling are useful, but the checkpoint is not approvable yet. Fix the issues below as one bounded remediation. Preserve the modular monolith, existing API authority, tenant isolation, human-only approval, and Sprint 4 boundary.

## Required implementation

### 1. Gate retry by real backend eligibility (HIGH)

- The visible action calls the existing work-order retry route, whose implementation only retries failed planning work items and failed script units. Do not show it merely because any employee is `blocked`, any work order is failed, or compliance/approval requires human action.
- Derive `canRetry` from the exact persisted work-item/task state that this route can actually retry. At minimum, failed planning tasks and the scriptwriting path supported by the existing transaction may qualify; compliance findings, review-required artifacts, canceled/completed orders, generic blockers, and unsupported failures must not.
- Keep the manager capability gate and honest action label. Do not broaden or redesign the backend retry contract in this presentation checkpoint.
- Add mapping/component tests for eligible and ineligible cases.

### 2. Associate and render real employee activity correctly (HIGH)

- Align the view-model with the actual activity query: events may be keyed to `work_order`, `operation`, `content_artifact`, or a `work_item` referenced through `changesJson.workOrderId`.
- Associate content-artifact events with the artifact author's role, work-item events with that work item/role, and operation/work-order events only when a safe deterministic role association exists in persisted fields. Never associate by `resourceType === roleKey`, because the API does not emit role names as resource types.
- If a work-order-wide event cannot be assigned to one employee, keep it out of the employee trail rather than inventing ownership. Do not display unsafe raw provider bodies, prompts, or stack details.
- Ensure activity fetch errors remain visible as an observation warning/stale partial-data condition while previously loaded detail/artifacts remain readable; do not silently turn an activity API failure into a truthful-looking empty trail.
- Add fixtures and tests that prove real `work_item` and `content_artifact` activity appears in the correct inspector and not another role.

### 3. Fail safely on unknown API enums and codes (HIGH)

- Replace unchecked casts in workforce response validation with explicit allowlists for `WorkOrderStatus`, `WorkItemStatus`, `AgentRoleKey`, mission type, and assignment office state.
- Explicitly normalize only documented legacy aliases (`working`, `waiting`, `cancelled`) if compatibility is still required. Unknown values must be rejected as a contract validation error or mapped to a deliberately safe non-success fallback; they must never flow through as an arbitrary `AssignmentOfficeState` or role key.
- Normalize operational reason/failure comparisons consistently with the real persisted lowercase codes (for example `insufficient_budget`) while retaining safe compatibility where justified. Never classify an unknown code as success.
- Add validator and view-model tests for canonical values, legacy aliases, lowercase real codes, and unknown values.

### 4. Correct lifecycle summaries and human handoff semantics (MEDIUM)

- Do not announce “Ready for human review” solely because all six role cards are `completed`.
- Derive screen-reader and visible handoff wording from persisted work-order status plus artifact lifecycle/human-action state. Distinguish review required, accepted/completed handoff, failed, canceled, and completed-without-pending-review.
- AI compliance remains advisory and must never be described as human or regulatory approval.
- Add summary tests for review-required, accepted/completed, failed, and canceled outcomes.

### 5. Complete keyboard/modal accessibility (HIGH)

- Implement genuine roving tab stop behavior for the six-person roster in both Office and Board: one roster item has `tabIndex=0`, the others `-1`; Arrow/Home/End moves focus and updates the active item; Enter/Space opens inspection.
- Give every keyboard-activated element correct interactive semantics. Avoid a keyboard handler on a plain `listitem` and avoid nested interactive controls.
- On inspector open, move focus inside. Trap/contain focus while the modal/sheet is open and make background content non-interactable as required for the responsive modal. Escape and all close paths must restore focus to the exact invoking station/card when it still exists.
- Ensure switching Office/Board and opening an artifact from the inspector does not leave focus on a removed node.
- Add component tests for tab stops, Arrow/Home/End, Enter/Space, focus containment, Escape, exact focus restoration, and viewer/read-only behavior.

### 6. Make the browser E2E prove the specified flow (HIGH)

- Extend the deterministic Playwright scenario to use explicit persisted stages for planning, script generation, compliance, review-required, and accepted/completed handoff.
- Open a real artifact/Content Studio surface and assert meaningful content, then close/return safely.
- Prove state does not advance merely by waiting: hold one fixture stage, wait longer than any UI transition interval, and assert status/deliverables remain unchanged until the controlled API fixture advances.
- Assert reload reconstruction at the final authoritative stage.
- Exercise keyboard inspection/focus restoration and run Axe after the populated Office/Board/inspector state, not only the initial surface.
- Keep the desktop, 320px mobile, and reduced-motion projects deterministic and bounded. Assert the mobile layout has no horizontal document overflow and the inspector remains usable.

### 7. Finish release documentation accurately (MEDIUM)

- Update the existing architecture, API, and product documentation (use the repository's canonical files) for the shared Office/Board projection, full-lifecycle polling/activity exposure, human-only approval semantics, and explicit Sprint 4 publishing boundary.
- Update `docs/SPRINT-3-AI-WORKFORCE-PLAN.md` so Checkpoints A–E and Sprint 3 completion/evidence are explicit and internally consistent. Remove the stale “Product Owner decisions requested / after approval” wording now that the decisions and implementation are complete.
- Document `pnpm test:e2e` in the canonical quality/CI documentation as required by TASK-015.
- Do not claim a gate passed until it has actually run successfully in this remediation.

## Expected files

- Workforce view-model, validators, polling state, Office/Board roster navigation, inspector/modal, and focused tests.
- Controlled Playwright fixtures/spec as needed.
- Canonical architecture/API/product/quality documentation, Sprint 3 plan, and any necessary runbook correction.
- No database migration is expected.

## Database changes

None.

## API changes

No new endpoint and no mutation-contract expansion. Consume the existing tenant-scoped work-order detail, artifacts, activity, and retry contracts honestly.

## Frontend changes

Implement the seven corrections above without fake state, fake progress, or browser-owned workflow authority.

## Backend changes

None expected. A narrowly necessary read-only contract correction must be explicitly reported and fully tested/documented; do not change orchestration or approval authority.

## Security requirements

- Preserve tenant scoping, authentication, server-side mutation authorization, CSP/no-store behavior, and safe text rendering.
- Do not expose raw prompts, provider bodies, secrets, stack traces, or cross-tenant identifiers.
- Unknown enum/status data must fail safely and never become success.
- UI retry capability is only presentation; server authorization and transactional eligibility remain authoritative.
- Modal background/inert behavior must not hide a focus escape or create an inaccessible trap.

## Edge cases

- Activity belonging to an artifact whose role has no current work item.
- Work-order-wide activity with no safe role owner.
- Unknown/legacy enum and lowercase reason codes.
- Failed compliance versus failed planning/script paths.
- Accepted artifact after all assignments completed; canceled terminal order; completed order with no pending review.
- Invoking station removed by view switch or refresh while inspector is open.
- Activity refresh failure after valid detail/artifacts were already displayed.
- 320px width, reduced motion, long text, and keyboard-only operation.

## Acceptance criteria

1. Retry is visible only when the existing retry transaction can act on persisted failed planning/script work.
2. Real activity is deterministically associated with the correct employee, and observation failures are visible without erasing valid data.
3. Workforce API enums are explicitly validated and unknown values cannot masquerade as supported/success states.
4. Review-required, accepted/completed, failed, and canceled summaries are truthful.
5. Both views have genuine roving navigation; inspector focus is contained and restored exactly.
6. Playwright proves planning → script → compliance → review → accepted/completed, real artifact access, no timer-created progress, reload persistence, populated-state accessibility, mobile reflow, and reduced motion.
7. Canonical architecture/API/product/quality docs and Sprint 3 release plan are complete and accurate.
8. No migration, social OAuth/publishing, unofficial API, microservice, or Sprint 4 implementation is introduced.
9. All focused and repository gates pass.

## Test plan

- Run focused workforce validator/view-model/component/accessibility/polling tests.
- Run `pnpm test:e2e` across all configured projects.
- Run `pnpm check`.
- Run `pnpm test:integration`.
- Run `pnpm db:migrate:validate` twice.
- Run `git diff --check dec1d92..HEAD` and `git diff --check a0df855..HEAD`.
- Verify OpenAPI synchronization and production build through repository gates.
- Run a diff-scoped secret scan and confirm no timer/sample/synthetic-success implementation was introduced.

## Out of scope

- Database schema changes unless an unavoidable blocker is proven to Codex first.
- Social OAuth, scheduling, publishing, analytics ingestion, media generation, or any Sprint 4 feature.
- New retry endpoints or broad orchestration redesign.
- WebSockets, microservices, Kafka, Kubernetes, event sourcing, or a second database.
