# TASK-012 — Sprint 3 Checkpoint B: Parallel Planning Pod Vertical Slice

Status: Approved for implementation by Codex on 2026-11-08

Owner: Antigravity (Implementation Engineer)

Reviewer: Codex (Lead Architect / CTO / Final Reviewer)

## Objective

Deliver the first genuinely useful, user-visible Sprint 3 vertical slice. From an active product with confirmed facts and accepted analyses, an owner or editor can assign one bounded mission to the AI team. Product Strategist, Audience Strategist, and Creative Director execute concurrently through the existing provider-neutral AI gateway and durable worker, producing three real, structured, evidence-linked planning artifacts. The web application exposes an easy-to-read command center, real status polling, employee inspection, usage/failure visibility, and safe retry.

No timer-generated progress, sample report, fake artifact, browser automation of an AI website, or autonomous approval is permitted.

## Context

Checkpoint A is approved through commit `fcaa0225acb66dcf670d996426867ac590991097`. It provides:

- deterministic `creative_office_v1` work-order graphs;
- immutable context package identity and locked-version validation;
- parallel-ready planning items and dependency-bound later items;
- six role definitions and assignments;
- atomic/idempotent kickoff persistence;
- strict tenant-safe queries and PostgreSQL evidence.

The repository already provides the reusable Sprint 2 execution substrate:

- provider-neutral `AIGatewayPort` and `GeminiAIGatewayAdapter`;
- durable `job_executions` with leases and fencing;
- `operations`, `ai_runs`, outbox events, retry/repair policy, and budget settlement;
- workspace AI policy, reservation, rate-limit enforcement, and safe failure categories;
- API authentication/origin/idempotency/problem-details patterns;
- Next.js product detail, AI policy, analysis polling, and accessible UI patterns.

Checkpoint B must extend those boundaries rather than creating a second queue, provider path, budget system, or orchestration service.

## Required implementation

### 1. Planning-role contracts

Add strict, versioned domain contracts and validators for exactly three role outputs:

1. `product_campaign_plan` from Product Strategist;
2. `audience_insight_board` from Audience Strategist;
3. `video_series_plan` from Creative Director.

Contracts must be bounded and reject unknown/oversized/malformed content. At minimum:

- stable schema version and role/prompt provenance;
- concise summary and bounded arrays;
- evidence references using allowlisted fact IDs and/or accepted analysis IDs;
- explicit distinction between verified facts and creative hypotheses/direction;
- no HTML, executable instructions, arbitrary tools, URLs, secrets, or provider payloads;
- the video-series plan contains exactly five bounded video ideas for the approved five-video mission, each with purpose, hook, narrative role, visual direction, and CTA direction but no production media.

Prompts treat product descriptions, fact text, analysis content, user directive, brand voice, and earlier artifacts as untrusted data. They must not permit those values to alter system rules, tool access, evidence requirements, schema, or approval policy.

### 2. Provider-neutral gateway extension

Extend the existing `AIGatewayPort` with planning-role execution without exposing Google SDK types outside infrastructure.

- Add versioned Gemini schemas and prompt builders for the three role outputs.
- Reuse current timeout, abort signal, response-size bound, single provider call per leased attempt, safe error classification, usage/provenance collection, and exactly one structured-output repair attempt.
- Do not log prompts, raw responses, directive text, fact content, analysis content, secrets, or chain-of-thought.
- Unit/contract tests must use an injected fake Gemini client. A live Gemini key is not required for normal tests.

### 3. Content artifact persistence foundation

Add forward-only migration `0009_workforce_planning_execution.sql` for the minimum durable Checkpoint B model. It may extend existing checks/links and must add the artifact foundation needed by the three outputs:

- `content_artifacts` with workspace/product/work-order/work-item/assignment/author-role ownership, artifact type, lifecycle status, current revision number, timestamps, and optimistic version;
- `content_artifact_revisions` with immutable revision number, strict structured JSON, 32-byte content hash, schema/prompt/provider/model provenance, safe usage metadata, creation time, and author role;
- `artifact_evidence_refs` linked to an exact artifact revision and allowlisted source kind (`product_fact` or `analysis`) plus source ID;
- explicit linkage from workforce jobs/operations/AI runs to work order and work item, either through safe columns/constraints or a small dedicated junction owned by this module;
- indexes for tenant-scoped work-order/artifact reads and worker completion paths;
- PostgreSQL constraints/triggers preventing mutation of revision content, hash, provenance, and evidence references.

Do not add review-decision tables or final approval transitions yet; those belong to later checkpoints. Existing migrations `0001` through `0008` must not be edited.

### 4. Atomic planning enqueue

Extend kickoff so a new, non-replayed work order atomically:

- revalidates the immutable context under locks;
- validates AI policy and active role definitions;
- calculates a deterministic maximum of three planning provider calls;
- reserves the total bounded budget before enqueue;
- enforces the workspace rate limit for all three calls without race conditions;
- creates three linked operations, AI runs, durable jobs, and outbox events for the three independent planning work items;
- transitions those three work items/assignments to `queued` and the work order to `in_progress`;
- leaves Scriptwriter and Compliance Reviewer honestly dependency-bound with no provider job;
- preserves the Chief of Staff as deterministic coordination without a provider call;
- stores only IDs, versions, hashes, safe configuration, and bounded job metadata in payloads;
- emits allowlisted audit events without directive or source content.

Idempotent replay creates no additional reservation, job, operation, AI run, outbox event, artifact, audit event, or provider call. Any failure rolls back the full kickoff and reservation.

The maximum concurrent provider calls per workspace is three. Reuse PostgreSQL leases and existing worker concurrency configuration; do not add an in-memory-only concurrency truth.

### 5. Worker execution and settlement

Extend the durable worker to recognize and strictly validate workforce planning jobs while preserving existing analysis jobs.

For each planning job:

1. cross-check job columns, payload, operation, AI run, work order, work item, assignment, role, workspace, product, and context package;
2. reconstruct authoritative input from the immutable context package, confirmed fact set, accepted analyses, workspace brand voice/disclosure, AI policy, and directive treated as untrusted content;
3. verify the locked/source versions still match the context descriptor where relevant;
4. transition job, operation, AI run, work item, assignment, and work-order projections atomically with lease/version fencing;
5. call the correct role gateway contract;
6. validate structured output and every evidence reference against authoritative context sources;
7. persist one artifact and immutable revision with canonical hash, provenance, usage, and evidence refs atomically;
8. settle/release that job's exact budget reservation;
9. mark the planning item and assignment `completed`, or expose `retry_wait`/`failed` honestly;
10. when all three required planning items complete, release `scriptwriting` from `waiting_dependency` to `ready` without enqueuing it in Checkpoint B.

Transient provider failures use the existing bounded durable retry/backoff. Invalid output receives at most one repair attempt. Terminal failures must not create an artifact and must leave downstream work visibly blocked or waiting with a safe reason. Lease loss/fencing prevents stale workers from persisting or charging.

### 6. API surface

Add and document the Checkpoint B `/api/v1` routes:

- `POST /workspaces/{workspaceId}/products/{productId}/work-orders`;
- `GET /workspaces/{workspaceId}/work-orders`;
- `GET /workspaces/{workspaceId}/work-orders/{workOrderId}`;
- `GET /workspaces/{workspaceId}/work-orders/{workOrderId}/activity`;
- `GET /workspaces/{workspaceId}/work-orders/{workOrderId}/artifacts`;
- `GET /workspaces/{workspaceId}/artifacts/{artifactId}`;
- `POST /workspaces/{workspaceId}/work-orders/{workOrderId}/retry` limited to recoverable failed/retryable planning items.

Requirements:

- reuse session authentication, workspace membership, origin validation, idempotency, rate limits, no-store headers, safe Problem Details, cursor conventions, and request-abort handling;
- kickoff/retry require the existing compatible management capability (`catalog.manage`); active members with read access may view;
- strict workspace/product predicates on every query;
- kickoff input is bounded: approved mission type, directive up to the established 4,000-character limit, priority, and selected accepted analysis IDs;
- return useful budget estimate/maximum calls before or with kickoff without exposing provider secrets;
- polling responses contain authoritative states/timestamps, not arbitrary percentages;
- artifact responses expose validated structured content and safe provenance/usage only;
- update runtime schemas and `openapi/openapi.json` together.

### 7. Boss command-center web experience

Integrate a clear planning command center into the selected product experience. It must prioritize the Product Owner's stated needs: easy to see, easy to observe, easy to initiate product work, and easy to understand/report the resulting deliverables.

Required UI:

- a prominent **Assign to AI Team** action on an eligible active product;
- mission selector, bounded directive, priority, selected accepted analyses, confirmed-fact/context preview, maximum three calls, and estimated reservation;
- disabled/explanatory states for missing confirmed facts, no accepted analyses when required, AI disabled, insufficient budget, or unauthorized role;
- work-order list and detail/timeline with the six employees, real task state, named dependency, timestamps, retry state, and safe failure message;
- planning artifact cards for product campaign plan, audience/angle board, and five-video series plan;
- employee inspector showing assignment, latest real status, artifact, usage, and failure/retry information;
- bounded polling with cancellation on workspace/product switch and component unmount;
- manual retry for recoverable failures with clear busy/error states;
- useful empty, loading, provider-outage, rate-limit, budget-blocked, and partial-success states;
- responsive layout, semantic headings, keyboard navigation, visible focus, screen-reader status text, and reduced-motion compliance.

Checkpoint B does not implement the animated office map. Use an accessible board/timeline presentation now; Checkpoint E will add optional state-driven office animation with parity.

Do not display fake progress percentages, fake reports, placeholder artifacts presented as real, or optimistic success before persisted confirmation.

### 8. Documentation

Update architecture, database, API, and Sprint 3 status documentation to reflect actual Checkpoint B behavior. Do not rewrite ADR-023 or expand scope.

## Expected files

- `packages/domain/src/workforce/*`
- `packages/application/src/workforce/*`
- `packages/application/src/analysis/ai-gateway-port.ts` where provider-neutral role execution belongs
- `packages/infrastructure/migrations/0009_workforce_planning_execution.sql`
- `packages/infrastructure/src/workforce/*`
- `packages/infrastructure/src/analysis/gemini-*`
- `apps/worker/src/*`
- `apps/api/src/workforce/*` plus API composition/OpenAPI files
- `apps/web/src/components/workforce/*`, API clients/validators/types, and selected product integration
- focused unit, adapter, integration, concurrency, API, worker, and web tests
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, and status wording in the Sprint 3 plan if appropriate

Avoid unrelated rewrites and do not modify untracked `plans/` artifacts.

## Database changes

Migration `0009_workforce_planning_execution.sql` only. It must be forward-only, atomic, checksum-managed, valid on a clean database after migrations `0001` through `0008`, and repeatably validated by the repository migration validator.

Never edit migrations `0001` through `0008`.

## API changes

Add only the work-order, activity, artifact-read, and bounded retry routes listed above. No approval, publishing, social OAuth, scheduling, analytics, or media-generation routes.

## Frontend changes

Add the accessible planning command center, work-order board/timeline, employee inspector, artifact readers, bounded polling, and retry UX. Do not add simulated office animation.

## Backend changes

- Three versioned planning schemas/prompts through the existing gateway.
- Atomic reservation/enqueue of three durable jobs.
- Strict workforce job validation and authoritative context reconstruction.
- Artifact/revision/evidence persistence and exact settlement.
- Dependency release after all three planning artifacts complete.
- Tenant-safe API projections and activity reads.

## Security requirements

- Strict tenant isolation in every SQL predicate and composite foreign key.
- No provider SDK type outside infrastructure.
- No provider key, prompt, directive, raw response, fact text, analysis content, cookie/session value, email, URL, or secret in jobs, context hashes, audit payloads, logs, or error details.
- User/source/artifact text is untrusted data and cannot modify system instructions or tool access.
- Only confirmed facts and accepted context analyses can support affirmative claims.
- Evidence validation fails closed.
- Artifact type must be allowed for the assigned role.
- Budget reservation/settlement is exact, non-negative, fenced, and idempotent.
- No AI role can approve content, change policy, publish, access shell/browser/social/payment tools, or call arbitrary tools.
- Mutation routes require authorization, origin protection, idempotency where applicable, and safe errors.
- Read responses use no-store and cannot cross workspace boundaries.

## Edge cases

- Duplicate/concurrent kickoff with same or conflicting idempotency command.
- Three-call reservation races against other AI work in the same workspace.
- Rate limit has capacity for fewer than three calls.
- Worker lease expires during provider execution or before persistence.
- One role succeeds while another retries or fails.
- Provider timeout, rate limit, safety block, malformed JSON, oversized response, invalid schema, and second invalid repair.
- Invalid or cross-product evidence reference.
- Context source changes after kickoff.
- Artifact insertion succeeds but evidence/job settlement fails: full transaction rollback.
- Retry request races with a running worker or repeated retry request.
- Refresh/restart during partial completion.
- Workspace/product switch while polling.
- AI policy disabled or budget reduced before retry.
- Missing/inactive role definition or artifact type mismatch.

## Acceptance criteria

1. One authorized kickoff atomically creates exactly three independently claimable planning jobs and one reservation covering exactly those calls.
2. Duplicate replay creates zero additional rows, reservations, audits, or calls; conflicting reuse fails safely.
3. Three planning jobs can be leased/executed concurrently with a configured per-workspace maximum of three.
4. Controlled fake-provider execution produces exactly one validated, evidence-linked artifact revision for each planning role.
5. Invalid evidence, output, linkage, lease, or provenance cannot create an artifact or charge incorrectly.
6. Transient failure is visible and recoverable through durable retry; terminal failure never appears completed.
7. Scriptwriter becomes `ready` only after all three planning work items complete; it is not executed in Checkpoint B.
8. API authorization, origin, idempotency, tenant isolation, safe errors, polling, and no-store contracts are proven.
9. The web UI lets the user initiate and observe the work clearly, inspect each employee and real artifact, and retry recoverable failures without fake progress.
10. The UI is responsive and keyboard/screen-reader usable, with loading/empty/partial/error/budget/rate-limit/provider states.
11. Migration `0009` validates cleanly and repeatably without editing prior migrations.
12. Existing analysis jobs, product/catalog behavior, and all prior tests remain green.
13. No Checkpoint C/D/E approval, revision-editing, compliance approval, animated-office, publishing, or media generation is added.

## Test plan

Add and run:

- domain validator/state-transition tests for all three artifact contracts;
- gateway adapter tests for correct prompt/schema/provenance, abort, timeout, safety, oversized/invalid output, and one repair;
- PostgreSQL tests for atomic three-job enqueue, tenant/product isolation, duplicate/conflicting concurrency, rate/budget races, reservation rollback, lease fencing, artifact immutability, evidence integrity, retry, settlement, and dependency release;
- worker tests for strict payload/linkage reconstruction, three role dispatches, partial failure, restart/reclaim, and analysis-job regression;
- API tests for auth, capabilities, origin, idempotency, validation, no-store, pagination, polling, retry races, and safe Problem Details;
- web tests for command submission, context preview, polling cancellation, timeline/inspector/artifact rendering, retry, partial failure, workspace switch, accessibility semantics, and no fake progress;
- controlled fake-provider end-to-end path from kickoff through three completed planning artifacts;
- `pnpm check`;
- `pnpm test:integration` with PostgreSQL;
- `pnpm db:migrate:validate` twice;
- `git diff --check fcaa022..HEAD`;
- secret scan of the checkpoint diff.

Do not run build/typecheck/unit suites concurrently against the same generated Next.js directory.

## Out of scope

- Scriptwriter execution, content brief synthesis, scripts, shot lists, captions, or variant generation (Checkpoint C)
- Artifact editing/diff/request-changes and human approval (Checkpoints C/D)
- Compliance Reviewer execution and blocking final-package approval (Checkpoint D)
- Animated office map, walking/handoff animation, and final release polish (Checkpoint E)
- Image/video generation or editing
- Social connections, scheduling, publishing, analytics, or Sprint 4+
- General-purpose tools, browsing, shell execution, crawling, or autonomous research
- Microservices, Kafka, Kubernetes, CQRS, event sourcing, or a second database

## Implementation handoff

Antigravity must implement the entire Checkpoint B independently on `agy/task-012-sprint3-checkpoint-b`. Before implementation, read `AGENTS.md`, the approved Sprint 3 plan/ADR, `TASK-011` plus remediation tasks, and this task.

Use `gemini-3.8-flash-high`. Do not stop at a plan. Implement, test, review the diff, commit, and push. Report only when ready for Codex review or when a genuine Product Owner/architecture decision is required. The final report must include:

- final commit SHA;
- changed-file list and migration summary;
- deviations or blockers;
- exact focused/full test commands, exit codes, and counts;
- confirmation that unrelated untracked `plans/` files were not staged or modified.

Checkpoint B is incomplete until Codex reviews the actual diff, reruns proportionate gates, and explicitly returns `STATUS: APPROVED`.
