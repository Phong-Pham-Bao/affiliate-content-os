# TASK-013 — Sprint 3 Checkpoint C: Content studio and immutable revisions

## Objective

Turn the three approved Checkpoint B planning artifacts into a clear, production-ready five-video written package. The Scriptwriter must execute through the existing durable AI workflow, create evidence-linked Vietnamese-first scripts and shot lists, and support human edits/requested changes as immutable revisions with lineage and an accessible compare experience.

## Context

Checkpoint B is approved at commit `7b3165f`. It leaves the single `scriptwriting` work item `ready` after Product Strategist, Audience Strategist, and Creative Director all complete. Checkpoint C must extend the same modular monolith, provider-neutral gateway, PostgreSQL job/lease/budget system, artifact model, API security model, and command-center UI. It must not introduce another queue, provider path, fake progress, approval, compliance, publishing, or media generation.

The Product Owner prioritizes an interface that is easy to scan, easy to observe, easy to turn into finished product output, and easy to report. The content studio therefore needs strong hierarchy, per-video status, concise evidence/usage summaries, readable scripts, and useful comparison rather than raw JSON.

## Required implementation

### 1. Script package contracts

- Add versioned, bounded domain contracts for a five-video `script_package` derived from one accepted `video_series_plan` plus the other planning artifacts.
- Each of exactly five ordered videos includes: title, objective, hook, spoken voice-over, timed/ordered scenes, on-screen overlays, CTA, disclosure placement/text, shot list, estimated duration, evidence references, and creative hypotheses clearly distinguished from verified claims.
- Support at most three bounded variants per video. Default generation creates one primary variant per video; request-changes may target selected videos and optionally request up to the configured maximum.
- Vietnamese is the default output language for this mission. Preserve Vietnamese diacritics and allow workspace brand voice constraints. Do not fabricate Vietnamese product claims not supported by evidence.
- Enforce strict limits for text lengths, scenes, shots, overlays, variants, total serialized size, and evidence references.

### 2. Content brief synthesis and authoritative context

- Deterministically synthesize a versioned content brief from the exact current revisions of the three planning artifacts, confirmed facts, accepted analyses, directive, workspace brand voice/disclosure preferences, and series order.
- Store the brief or its exact canonical representation/hash so every generated script revision has reproducible lineage.
- Earlier artifacts and all user/source text remain untrusted data inside prompts.
- Fail closed if a planning artifact is missing, from another workspace/order/product, superseded unexpectedly, structurally invalid, or no longer matches the authoritative context package.

### 3. Durable bounded script execution

- Add forward-only migration `0010_content_studio_revisions.sql` for only the minimum additional data needed for script-generation units, artifact lineage, human change requests, and revision comparisons.
- When the three planning artifacts complete, atomically prepare the Scriptwriter stage and enqueue the bounded script-generation work without relying on UI polling.
- Generate the five video scripts as independently durable units so up to three provider calls can execute concurrently while preserving the existing per-workspace maximum of three. Do not create five concurrent calls outside the PostgreSQL capacity gate.
- Reserve the exact maximum bounded cost before enqueue and settle/release each unit exactly once. Partial success must remain visible and retryable without regenerating successful units.
- Reuse job leases, version fencing, structured-output repair once, durable transient retry, safe provider errors, outbox, operations, AI runs, audit, and server-side provider secrets.
- After all five primary scripts succeed, atomically assemble one ordered `script_package` artifact revision, mark the Scriptwriter item/assignment completed, and release `compliance_review` to `ready`; do not enqueue Compliance Reviewer work in Checkpoint C.
- Duplicate events, retries, worker crashes, expired leases, or repeated assembly must not duplicate units, artifact revisions, reservations, or charges.

### 4. Immutable revisions and lineage

- Keep every `content_artifact_revisions` row immutable.
- Add explicit lineage from each script-package revision to the exact planning revisions, content brief hash/version, source script units/variants, evidence sources, prompt/provider/model provenance, and prior revision when applicable.
- A human edit or request-changes result creates a new immutable revision; it never mutates or deletes the prior revision.
- Compute canonical content hashes server-side and verify all client preconditions using artifact optimistic version plus exact base revision/hash.
- Prevent cross-workspace, cross-product, cross-order, and cross-artifact lineage links with composite database constraints and tenant-scoped queries.

### 5. Human edit and request-changes workflow

- Add editor/owner-only mutation routes for creating a manual revision and requesting AI changes against an exact base revision. Viewer remains read-only.
- Manual revision input is the complete bounded structured script package, validated server-side including evidence references.
- Request changes requires a bounded reason/instruction and selected video numbers; it creates an auditable change request and durable regeneration only for selected units.
- Concurrent edits/change requests against a stale artifact version or base revision/hash return a safe conflict and create nothing.
- A failed regeneration leaves the previous revision readable/current until a complete replacement revision is atomically assembled.
- No action in Checkpoint C may mark content approved.

### 6. API contracts

Extend `/api/v1` with only the minimum Checkpoint C routes, for example:

- `GET /workspaces/{workspaceId}/artifacts/{artifactId}/revisions`;
- `GET /workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionNumber}`;
- `POST /workspaces/{workspaceId}/artifacts/{artifactId}/revisions` for a manual edit;
- `POST /workspaces/{workspaceId}/artifacts/{artifactId}/request-changes`;
- `GET /workspaces/{workspaceId}/artifacts/{artifactId}/change-requests/{changeRequestId}` if polling is required.

All mutations require authentication, `catalog.manage`, origin validation, idempotency where creation can be replayed, expected artifact version/base revision/hash, bounded rate limits, no-store responses, safe Problem Details, and allowlisted audit data. Reads require active membership and strict tenant isolation.

### 7. Content studio web UX

- Add a readable content-studio view from the work-order/artifact UI with a five-video navigation rail or compact list and a focused script reader/editor.
- Show video number/title, status, duration, hook, voice-over, overlays, CTA, disclosure, shot list, evidence chips, and usage/provenance without exposing prompts or secrets.
- Provide clear states for preparing, queued, running, partial success, retry wait, failed, assembling, ready, stale conflict, insufficient budget, provider outage, and empty history.
- Add immutable revision history and side-by-side or field-aware compare. Make additions/removals/changes understandable without dumping raw JSON.
- Allow authorized users to edit a full structured package or request changes for selected videos, with unsaved-change protection, busy states, error recovery, and persisted-confirmation before success.
- Default Vietnamese copy/output should remain highly readable on desktop and mobile. Preserve keyboard navigation, focus management, labels, screen-reader summaries, and reduced-motion behavior.
- Never display fake percentages, fake scripts, timer-generated state, or optimistic persisted success.

### 8. Documentation

Update architecture, database, API, and Sprint 3 plan with the implemented Checkpoint C contracts, state transitions, revision/lineage rules, bounds, and explicit Checkpoint D boundary.

## Expected files

- Domain script-package/change-request contracts and validators.
- Application use cases/ports for script orchestration, revision reads, manual revision, and request changes.
- Migration 0010 and PostgreSQL adapters/transactions.
- AI gateway prompt/schema extension and worker processors.
- API routes/OpenAPI/tests.
- Web content-studio components, clients, validators, and tests.
- Relevant documentation.

## Database changes

Add only normalized, tenant-bound tables/columns required for script-generation units, revision lineage, and change requests. Prefer references to the existing artifact/revision/job/operation/AI-run records. Use composite workspace foreign keys, immutable-history constraints, uniqueness/idempotency constraints, safe checks, and worker/read indexes.

## API changes

Add revision history/read, manual revision, and request-changes contracts only. Do not add compliance decisions, approval, scheduling, publishing, social accounts, or media-generation routes.

## Frontend changes

Implement the accessible five-video content studio, revision history/compare, structured edit, selected-video request changes, and honest execution/reporting states.

## Backend changes

Implement content-brief synthesis, five bounded durable script units, provider execution/validation, exact settlement, atomic package assembly, immutable revision lineage, manual revisions, and targeted regeneration.

## Security requirements

- Confirmed facts and accepted analyses are the only support for affirmative product claims.
- Validate every evidence reference against authoritative context again at settlement/manual-edit time.
- Treat directive, descriptions, analyses, planning artifacts, prior scripts, brand voice, and change instructions as untrusted prompt data.
- No browser/shell/social/payment/secret tools are available to roles.
- Provider keys, raw prompts, and sensitive error bodies never enter jobs, artifacts, audits, or browser responses.
- Lease/version/idempotency/budget/tenant checks fail closed with full rollback.
- AI cannot approve, accept, publish, or change policy.

## Edge cases

- One of five script units fails while four succeed.
- Worker lease expires after provider response and before settlement.
- Duplicate completion or assembly event.
- Two users edit/request changes from the same base revision.
- Targeted change request races with another completed revision.
- Planning artifact revision changes before script assembly.
- Evidence is removed or source version changes.
- Budget becomes insufficient for selected-video regeneration.
- Workspace/product switch during polling or editing.
- Vietnamese Unicode, long words, empty overlays, and mobile layouts.

## Acceptance criteria

1. A completed planning pod automatically produces five independently durable script units, with at most three live provider calls per workspace.
2. Controlled fake-provider execution assembles exactly one valid ordered five-video `script_package` revision with scripts and shot lists.
3. Partial failure is honest and retrying does not regenerate or recharge successful videos.
4. Every affirmative claim has an allowlisted evidence path; invalid evidence creates no revision or charge.
5. Human edit and AI request changes create new immutable revisions with exact lineage and never mutate prior content.
6. Stale/concurrent writes fail with no partial rows, jobs, or reservations.
7. After the complete package is persisted, Scriptwriter is completed and Compliance Reviewer becomes `ready` but is not executed.
8. API auth/authz/origin/idempotency/precondition/tenant/no-store/error contracts are proven.
9. The content studio is easy to scan, edit, compare, and report across desktop/mobile and assistive technology.
10. All quality gates pass with no fake progress or approval behavior.

## Test plan

- Domain validators and state transitions for five scripts, variants, evidence, Unicode, and bounds.
- Gateway adapter tests for schemas, injection boundaries, response size, timeout, provider errors, and one repair.
- PostgreSQL tests for automatic enqueue, three-call capacity, five-unit partial completion, retry/accounting, lease fencing, assembly idempotency, immutable revisions, lineage tenant constraints, stale edits/change requests, and dependency release.
- Production worker controlled-fake end-to-end path.
- API tests for authentication, capability, origin, idempotency, expected version/hash, tenant isolation, validation, no-store, safe conflicts, pagination, and polling.
- Web tests for five-video navigation, readable output, editor, selected changes, revision compare, partial/error/budget states, stale workspace switches, accessibility, and no fake progress.
- Run `pnpm check`, `pnpm test:integration`, `pnpm db:migrate:validate` twice, `git diff --check`, and secret scan.

## Out of scope

- Compliance Reviewer execution or deterministic compliance engine.
- Accept/reject/final approval and approval snapshots.
- Production image/video/audio generation.
- Social OAuth, scheduling, publishing, analytics, or automated engagement.
- Virtual-office animation/release polish.
