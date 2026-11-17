# TASK-014 — Sprint 3 Checkpoint D: Compliance and human approval

## Objective

Turn the current immutable `script_package` revision into a compliance-evaluated, explicitly human-controlled final package. Run versioned deterministic checks plus one bounded AI advisory review, preserve exact evidence and policy snapshots, and allow only an authorized human to accept, reject, or request changes against the exact current revision/hash.

## Context

Checkpoint C is approved at commit `a0df855`. It assembles a five-video Vietnamese script package, releases the `compliance_review` work item to `ready`, supports immutable revisions and targeted change requests, and stops before compliance execution or approval. Checkpoint D must extend the same modular monolith, PostgreSQL job/lease/budget/idempotency system, provider-neutral gateway, artifact lineage, API security, and Content Studio. It must not publish, schedule, connect social accounts, generate media, or implement Checkpoint E office animation polish.

The Product Owner requires an interface that is easy to scan, easy to observe, easy to turn into finished output, and easy to report. Compliance must therefore show clear blocking versus advisory findings, exact affected video/field, evidence links, policy version, evaluation state, and the human decision history without exposing prompts or secrets.

## Required implementation

### 1. Versioned deterministic compliance policy

- Add a code-owned, versioned, canonically hashed compliance policy for `script_package` revisions.
- Deterministically validate at minimum:
  - current script-package schema and five-video structure;
  - exact tenant/product/order/artifact/revision/hash linkage;
  - package/video evidence coherence and authoritative confirmed/allowed facts or accepted analyses from the frozen context;
  - required affiliate disclosure presence and bounded placement for every video;
  - prohibited or absolute claim patterns in Vietnamese and English using explicit rule codes and bounded locations;
  - empty/malformed CTA, scenes, shots, overlays, durations, variants, and unsafe control characters;
  - planning/content-brief drift and superseded evidence.
- Findings have stable codes, severity (`info`, `warning`, `blocking`), video/field location, safe message, optional evidence IDs, and deterministic fingerprint.
- Blocking deterministic rules fail closed. There is no blocking-rule override in Sprint 3.
- Policy/configuration changes create a new policy version/hash; never rewrite historical evaluation meaning.

### 2. Durable Compliance Reviewer execution

- Add forward-only migration `0013_compliance_human_approval.sql` with the minimum tenant-bound records for compliance evaluations/findings, human review decisions, and immutable approval snapshots.
- When a script package revision becomes current, atomically prepare/enqueue compliance for that exact revision without UI polling as an orchestration dependency.
- Reuse operations, AI runs, jobs, leases, version fencing, workspace max-three capacity, exact budget reservation/settlement, one structured-output repair, durable retry, safe errors, audit, and server-side provider secrets.
- Run deterministic preflight before the provider. If blocking findings already exist, skip the AI call, persist a blocked evaluation/report, release any reservation exactly once, and move the work item to `review_required`/blocked review state honestly.
- If preflight is non-blocking, make at most one logical AI advisory review call (plus the existing single structured repair allowance). The AI output may add advisory findings but cannot remove, downgrade, or override deterministic findings and cannot approve/reject content.
- Before settlement, recompute/revalidate the exact revision/hash, policy version, context/evidence, lease/version, and deterministic result. Drift terminalizes safely without persisting a stale evaluation.
- Persist one compliance evaluation and one versioned `compliance_report` artifact revision linked to the exact script revision, policy, deterministic findings, advisory findings, provider/model/prompt provenance, usage, and prior report where applicable.
- Duplicate events, retries, worker crashes, repeated enqueue, or repeated settlement must not duplicate evaluations, findings, reports, reservations, or charges.

### 3. Revision invalidation and automatic re-evaluation

- Every material manual or AI-generated script-package revision sets the artifact lifecycle back to `review_required`, makes any older approval non-current by exact revision/hash semantics, and automatically enqueues a fresh compliance evaluation.
- Historical decisions and approval snapshots remain immutable and readable; never mutate them to pretend they applied to a newer revision.
- Only the compliance evaluation for the artifact's exact current revision/hash and current policy version may authorize acceptance.
- A failed/error/stale evaluation is not approvable and leaves the prior revision/decision history readable.

### 4. Human decision and immutable approval snapshot

- Add owner/editor-only commands to accept and reject the exact current script-package revision. Integrate the existing request-changes command as a recorded human decision against its exact base revision/hash.
- Every command requires authentication, `catalog.manage`, origin validation, a required idempotency key, expected artifact version, exact revision number/hash, and bounded reason/note where applicable.
- Accept requires a current completed compliance evaluation with no deterministic blocking findings and no evaluation error. AI advisory warnings remain visible to the human but cannot accept content automatically.
- Accept atomically:
  - records an immutable human decision;
  - creates an immutable approval snapshot containing exact revision/content hash, compliance evaluation/policy/result hash, evidence IDs, disclosure state, actor, and timestamp;
  - sets artifact lifecycle to `accepted` only if optimistic preconditions still match;
  - completes the work order/Chief of Staff handoff state without publishing anything;
  - writes an allowlisted audit event.
- Reject atomically records an immutable decision and bounded reason, sets the exact artifact revision/lifecycle to rejected/currently blocked for human action, and does not delete content or create a provider job.
- Request changes records an immutable `request_changes` decision before its existing targeted regeneration is enqueued; a resulting new revision returns the artifact/work order to truthful review/compliance states.
- Replayed same-key/same-payload commands return the original result. Same key/different payload, stale version/hash, competing decisions, or cross-tenant references fail safely with no partial state.
- AI/service actors cannot invoke human-decision use cases, and no background worker can create an approval snapshot.

### 5. API contracts

Add only the minimum Checkpoint D `/api/v1` routes, for example:

- `GET /workspaces/{workspaceId}/artifacts/{artifactId}/compliance`;
- `GET /workspaces/{workspaceId}/artifacts/{artifactId}/decisions`;
- `POST /workspaces/{workspaceId}/artifacts/{artifactId}/accept`;
- `POST /workspaces/{workspaceId}/artifacts/{artifactId}/reject`.

Reuse the existing request-changes route and add decision recording atomically. Reads require active membership and tenant isolation. Mutations require editor/owner capability, origin, idempotency, rate limits, exact preconditions, no-store, safe Problem Details, and allowlisted audit data. Update runtime schemas, committed OpenAPI, clients, and tests together.

### 6. Compliance and approval UX

- Extend the Content Studio with a clear compliance panel showing evaluation state, policy version, deterministic versus AI-advisory source, severity counts, blocking summary, and findings grouped by video/field.
- Evidence chips navigate or identify the supporting fact/analysis without exposing internal prompts.
- Provide accessible accept/reject/request-changes controls only to authorized users; viewer remains read-only.
- Disable acceptance when evaluation is queued/running/stale/blocked/error or the viewed revision is historical.
- Require an explicit confirmation that identifies the exact revision and shows advisory warnings before acceptance.
- Reject requires a bounded reason. Request changes continues to select videos/instruction and now visibly records the decision.
- After a mutation, show success only from persisted server confirmation, refresh the artifact/evaluation/history, and handle stale conflicts without losing the readable package.
- Support desktop/mobile, keyboard/focus management, screen-reader summaries, reduced motion, empty/loading/error/retry/provider/budget states, and no fake percentages or timer-generated success.

### 7. Documentation

Update architecture, database, API, security/threat notes, and Sprint 3 plan with implemented policy/version contracts, compliance state transitions, approval validity/invalidation, human-only authority, and the explicit Checkpoint E boundary.

## Expected files

- Domain compliance policy/finding/evaluation/decision/snapshot types and validators.
- Application ports/use cases for compliance reads and human decisions.
- Migration `0013_compliance_human_approval.sql` and PostgreSQL transactions/queries.
- AI gateway compliance prompt/schema extension and worker processor.
- API routes/schemas/OpenAPI/Problem Details/tests.
- Content Studio compliance/decision components, client validators, and tests.
- Relevant documentation.

## Database changes

Add only normalized, tenant-bound records required for exact revision compliance, immutable findings/decisions, and approval snapshots. Use composite workspace/artifact/revision/evaluation foreign keys, unique idempotency/deduplication constraints, terminal immutability triggers, bounded checks, and worker/read indexes. Do not introduce social-account or publication tables.

## API changes

Add compliance/decision reads and exact-revision accept/reject commands. Extend request-changes atomically with decision history. Do not add scheduling, publishing, OAuth, media, or platform-specific approval routes.

## Frontend changes

Implement an accessible compliance report and human decision surface inside the existing Content Studio, with exact revision visibility, blocking/advisory distinction, decision history, confirmation, and honest state refresh.

## Backend changes

Implement deterministic policy evaluation, bounded AI advisory review, durable exact-revision orchestration, report persistence, invalidation-by-revision semantics, human-only decisions, and immutable approval snapshots.

## Security requirements

- Confirmed facts and accepted analyses remain the only support for affirmative claims.
- Treat scripts, directives, prior artifacts, product text, and AI findings as untrusted data.
- Deterministic blocking findings cannot be downgraded by AI or client input.
- Provider keys/raw prompts/raw error bodies never enter jobs, reports, audits, or browser responses.
- Lease/version/idempotency/budget/tenant checks fail closed with full rollback.
- Approval authority derives only from the authenticated human session and capability check.
- No action publishes, schedules, connects accounts, changes AI budget, confirms facts, or bypasses platform moderation.

## Edge cases

- Revision changes before provider call, during provider call, or before human accept.
- Evidence is revoked/superseded after evaluation.
- Deterministic blocker plus conflicting AI advisory output.
- Duplicate completion/settlement and expired worker lease.
- Provider outage after deterministic preflight.
- Two users accept/reject/request changes concurrently from the same base.
- Same idempotency key replayed with same/different payload.
- Previously accepted revision receives a manual edit or targeted regeneration.
- Compliance policy version changes before acceptance.
- Viewer attempts mutation or AI/service actor attempts approval.
- Workspace/product switch while polling or deciding.

## Acceptance criteria

1. Every current script revision automatically obtains exactly one evaluation for the current policy version, without UI-driven orchestration.
2. Deterministic blocking findings skip/override AI advisory, remain blocking, and prevent acceptance.
3. Controlled fake-provider execution produces one evidence-linked compliance report with exact provenance and usage.
4. Stale leases/revisions/policies and duplicate events create no duplicate evaluation/report/charge.
5. Accept/reject/request-changes decisions bind the exact current revision/hash and authenticated human actor.
6. Acceptance creates one immutable approval snapshot and no AI path can create it.
7. A material new revision immediately makes the prior approval non-current and requires fresh compliance.
8. Rejected/blocked/error content cannot complete the handoff; accepted current content completes Sprint 3 work-order handoff but publishes nothing.
9. API auth/authz/origin/idempotency/precondition/tenant/no-store/error contracts are proven.
10. The UI clearly distinguishes deterministic blockers, advisory warnings, exact revision, and human decision state across desktop/mobile/accessibility modes.
11. No Checkpoint E animation polish or Sprint 4 publishing behavior is introduced.
12. All repository quality gates pass.

## Test plan

- Domain tests for policy version/hash, deterministic rules, finding fingerprints, severity, and immutable decision/snapshot contracts.
- Gateway tests for advisory schema, injection boundaries, output bounds, provider failures, and one repair.
- PostgreSQL tests for automatic enqueue, deterministic block/no-call, exact reservation, lease fencing, duplicate settlement, evaluation/report idempotency, tenant constraints, and revision/policy drift.
- Human decision integration tests for authorization, exact preconditions, idempotency replay/conflict, accept/reject races, immutable snapshots, revision invalidation, and request-changes decision linkage.
- API tests for authentication, capability, origin, headers, rate limits, Problem Details, no-store, tenant isolation, OpenAPI, and safe reads.
- Web tests for loading/running/blocked/warning/error states, grouped findings, exact-revision confirmation, viewer read-only mode, stale conflicts, persisted refresh, keyboard/focus/screen-reader behavior, and no fake progress.
- Controlled fake-provider end-to-end scenario from current script through human acceptance.
- Run `pnpm check`, `pnpm test:integration`, `pnpm db:migrate:validate` twice, `git diff --check a0df855..HEAD`, and a secret scan.

## Out of scope

- Checkpoint E office/board visual polish and employee movement animation.
- Production image/video/audio generation.
- Social OAuth, scheduling, publishing, analytics, engagement, or platform consent.
- Compliance overrides for deterministic blocking rules.
- Microservices, Kafka, WebSockets, or a second database.
