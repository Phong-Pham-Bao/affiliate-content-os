# TASK-009 - Sprint 2: Usable Product and Intelligence Vertical Slice

Status: Approved by Product Owner

Approval basis: On 2026-11-05 the Product Owner explicitly approved TASK-009 and selected Google as the managed OIDC provider and Gemini API as the AI provider. Provider secrets remain deployment configuration and must never be committed.

Sprint: 2 - Products and intelligence

Owner: Antigravity (Implementation Engineer)

Review authority: Codex (Lead Architect / CTO / Final Reviewer)

Depends on: approved and merged TASK-001 through TASK-008; clean `origin/main` at or after merge commit `4d07c78`

## Objective

Deliver Sprint 2 as one integrated, user-visible vertical slice instead of a sequence of narrowly isolated tasks.

At the end of this task, a real signed-in user must be able to:

1. enter the application through a functional web authentication experience;
2. create or select a workspace;
3. create and edit a product and its affiliate destination;
4. create, review, and confirm an immutable product fact set;
5. request real provider-backed product and niche analyses through the asynchronous AI boundary;
6. inspect grounded, versioned results and accept or reject them; and
7. see recoverable loading, empty, validation, authorization, and dependency-failure states.

The slice must compose the authentication, tenancy, authorization, audit, PostgreSQL, API, worker, and web foundations already delivered. It must create tangible user value without weakening tenant isolation, human control, provenance, auditability, or the modular-monolith architecture.

This is one implementation task with four mandatory review checkpoints. The checkpoints are delivery boundaries, not separate product tasks. Antigravity may continue work between checkpoints, but each checkpoint must remain independently reviewable and keep the repository buildable.

## Context

TASK-001 through TASK-008 established:

- the TypeScript workspace, quality gates, Next.js web, Fastify API, and Node worker process boundaries;
- PostgreSQL, forward-only migrations, transaction support, and integration-test infrastructure;
- users, workspaces, memberships, verified OIDC identities, and opaque application sessions;
- managed OIDC login/callback/current-user/logout HTTP behavior;
- workspace role authorization; and
- append-only audit primitives.

The current web application is only a runtime shell. Workspace creation exists as an internal application use case but has no public HTTP route or UI. Catalog, product facts, affiliate destinations, AI runs, analyses, asynchronous operations, outbox execution, and the Sprint 2 UI are not implemented.

Governing sources:

- `AGENTS.md`
- `docs/PRODUCT.md`, especially sections 3, 5, 6.1, 6.2, 10, and 11
- `docs/ARCHITECTURE.md`, especially sections 5 through 8, 12, 14, and 15
- `docs/API.md`, especially sections 1 through 8, 14, and 15
- `docs/DATABASE.md`, especially sections 2 through 5 and 10 through 14
- `docs/DECISIONS.md`, especially ADR-003, ADR-004, ADR-006, ADR-013, ADR-016, ADR-019, and ADR-020
- the actual merged TASK-001 through TASK-008 implementation

### Product-owner decisions for the live demo

The Product Owner selected the following provider families on 2026-11-05:

1. Google as the managed OIDC provider for real sign-in; and
2. Gemini API as the AI provider.

The exact Gemini model, Google Cloud/AI Studio project, region/data-processing terms, workspace budget, OAuth client configuration, and credentials remain deployment/configuration decisions. Antigravity must verify current official Google documentation and supported model identifiers at implementation time; it must not invent endpoints or hard-code credentials. These remaining values do not block Checkpoints A and B. Test adapters must never be exposed as successful production AI behavior.

## Delivery and review checkpoints

### Checkpoint A - First usable authenticated workspace

- Functional sign-in/sign-out web states using the existing auth endpoints.
- Authenticated application shell and current-user loading.
- Create/select workspace experience.
- `POST /api/v1/workspaces` and required workspace read behavior.
- Route-level authentication and application-level authorization composition.
- Workspace creation and its allowlisted audit event committed atomically.
- OpenAPI, unit, PostgreSQL integration, route integration, and browser-flow tests for this slice.

### Checkpoint B - Product catalog, facts, and affiliate destination

- Catalog database schema and constraints.
- Product list/create/read/update/archive API and UI.
- Immutable proposed/confirmed fact-set API and UI.
- Affiliate-destination list/create/update/archive API and UI.
- Tenant isolation, optimistic concurrency, idempotency, audit, validation, and safe error behavior.
- Media metadata schema may be added here, but remote object upload is not required by this task.

### Checkpoint C - Durable AI analysis pipeline

- Provider-neutral AI Gateway and versioned analysis schemas.
- Persistent operation, AI run, analysis, outbox, and job-execution behavior required for asynchronous `202` workflows.
- Worker claims and executes jobs idempotently with bounded retries and leases.
- One explicitly Product-Owner-approved real AI provider adapter.
- Product and niche analysis request/read/accept/reject API.
- Grounding, evidence, provenance, budget, timeout, output-validation, and failure policies.

### Checkpoint D - Integrated UX and release evidence

- Complete product-to-analysis web flow.
- Accessible responsive states for loading, empty, error, authorization, retry, and success.
- Browser end-to-end coverage of the primary flow and important failure flows.
- Clean-checkout, migration, full quality-gate, integration, build, and runtime evidence.
- Documentation updated to describe exactly what is usable and how to run it.

## Required implementation

### 1. Preserve architecture and delivery discipline

1. Keep the modular monolith and existing package dependency direction. Do not add a microservice, separate database, Redis, Kafka, workflow engine, ORM, CQRS, or event sourcing.
2. Keep all domain rules in `packages/domain`, orchestration and ports in `packages/application`, PostgreSQL/provider adapters in `packages/infrastructure`, HTTP composition in `apps/api`, durable background execution in `apps/worker`, and UI behavior in `apps/web`.
3. Do not deep-import package source paths. Extend public package exports intentionally.
4. Keep every checkpoint buildable. Do not merge placeholder routes that return fake success.
5. Preserve existing authentication, session, authorization, audit, configuration, migration, and process-lifecycle contracts unless this task explicitly extends them.
6. All new dependencies must be justified, pinned through the lockfile, compatible with Node.js 24.14.0, and reviewed for maintenance/security impact.

### 2. Authentication and workspace onboarding composition

1. Add a web authentication experience that calls the existing managed-OIDC flow rather than creating passwords or a parallel identity system.
2. The web application must distinguish: loading, signed out, authentication unavailable, signed in with no workspace, and signed in with accessible workspaces.
3. Add authenticated API request composition that:
   - authenticates the opaque application session;
   - resolves the current application user;
   - resolves workspace membership for workspace routes;
   - applies the exact TASK-007 capability policy; and
   - returns safe RFC 9457 problem responses without revealing cross-tenant existence.
4. Implement `POST /api/v1/workspaces` for a signed-in active user. Use the existing workspace use case and persistence foundation, extending them only where necessary for idempotency and atomic audit.
5. Workspace creation must create the workspace, active owner membership, idempotency record, and allowlisted audit event in one transaction. A transaction failure must leave none of them committed.
6. Implement the minimum read behavior needed to render/select an accessible workspace. Reuse `/api/v1/me` workspace summaries where sufficient; do not create duplicate sources of truth.
7. Do not implement invitations, member mutation, workspace deletion/export, or a complete workspace-settings screen in this task.

### 3. Product catalog domain and persistence

1. Add closed domain types and validation for product status: `draft | active | archived`.
2. Product fields in this task:
   - name;
   - merchant name;
   - canonical URL;
   - category;
   - description;
   - audience notes;
   - allowed-claims notes;
   - prohibited-claims notes;
   - status;
   - current confirmed fact-set reference;
   - standard identifiers/timestamps/version.
3. Require explicit workspace scope on all catalog ports and SQL statements.
4. Create, update, and archive mutations require `catalog.manage`; reads require `catalog.read`.
5. Updates use optimistic concurrency. A stale version/ETag returns a stable `409` and never overwrites newer data.
6. Product creation is idempotent. Reuse of an idempotency key with a different canonical request hash returns a conflict.
7. Canonical product URLs must be absolute HTTP(S), have no embedded credentials, and be normalized only where semantics are unambiguous. This task does not fetch the URL.
8. Store a workspace-scoped canonical-URL hash for duplicate warnings. Do not silently merge products.
9. Archiving is idempotent, preserves history, and blocks new analyses while keeping reads available.
10. Every successful product mutation appends an allowlisted audit event in the same transaction.

### 4. Product facts and provenance

1. Add product fact-set status: `proposed | confirmed`.
2. A fact set has a monotonically increasing revision number unique within its product.
3. Fact fields:
   - bounded `factKey`;
   - bounded `valueText`;
   - `sourceType`: `user | merchant_page | document | other`;
   - optional safe source URL and bounded source excerpt;
   - `confidence`: `confirmed | suggested | uncertain`;
   - `claimUsage`: `allowed | context_only | prohibited`.
4. Creation validates that the product belongs to the route workspace and records the current user as creator.
5. Confirmation requires `catalog.manage`, records the reviewer/time, is idempotent for the same state, and atomically updates the product's current fact-set reference.
6. Confirmed fact sets and their facts are immutable. Corrections create a new revision; no route may overwrite confirmed rows.
7. Only facts with confirmed confidence in a confirmed fact set may ground affirmative AI claims. Prohibited facts may be supplied only as constraints, never as affirmative evidence.
8. Source text is untrusted data, bounded, clearly delimited in any AI context, and never interpreted as system/developer instructions.
9. Confirmation and creation append allowlisted audit events atomically.

### 5. Affiliate destinations

1. Implement workspace/product-scoped affiliate destinations with label, URL, optional network name, status, timestamps, and version.
2. Status is `active | archived`.
3. URLs must be absolute HTTP(S), reject credentials, control characters, and malformed encodings, and have safe bounded length.
4. Do not follow, scrape, resolve, shorten, cloak, or validate the remote destination in this task.
5. Never log raw query parameters. API responses may return the configured URL to an authorized editor, but logs, audit changes, errors, telemetry, request IDs, and test snapshots must redact query and fragment values.
6. Mutations use optimistic concurrency/idempotency as applicable and append audit events atomically.

### 6. Media metadata

1. Add only the `media_assets` schema and domain metadata required by the approved database architecture if it can be delivered without selecting an object-storage vendor.
2. Do not expose a fake upload URL, accept server-local production uploads, fetch arbitrary remote media, or mark unscanned media as safe.
3. If storage is not selected, the web UI must not present media upload as available. The absence of storage configuration must be explicit and non-fatal to the product-analysis flow.

### 7. AI Gateway and structured analyses

1. Implement provider-neutral application ports for product and niche analysis. Domain/application packages must not import a provider SDK.
2. A concrete production adapter requires the Product Owner's explicit provider/model decision and must use official documented APIs/SDKs. Never invent an endpoint or silently substitute a model.
3. Define versioned input and output schemas. Persist prompt-template identifier/version, input schema version, output schema version, provider/model, input/output hashes, usage, latency, safety result, terminal status, and safe error category.
4. Product analysis output must cover, at minimum:
   - summary;
   - benefits;
   - differentiators;
   - evidence gaps;
   - claim risks;
   - objections; and
   - content angles.
5. Niche analysis output must cover, at minimum:
   - target audience;
   - pains;
   - intent;
   - themes;
   - competitive positioning;
   - seasonality notes; and
   - risks.
6. Evidence-bearing statements must reference fact IDs or accepted source-analysis IDs from the submitted context. Unknown IDs, missing required evidence, prohibited affirmative claims, and schema-invalid output fail deterministic validation.
7. Invalid structured output may receive at most one bounded repair attempt. The repair uses the same grounding constraints and is recorded as part of the same logical operation/attempt history.
8. Provider calls have explicit timeouts, abort propagation, bounded response sizes, and sanitized errors. Retries are limited to classified transient failures with bounded exponential backoff and jitter.
9. No prompt, provider body, fact value, affiliate query value, session token, OIDC secret, API key, or raw user instruction may appear in logs or public errors.
10. Enforce workspace AI enablement and configurable budget/rate limits before enqueueing work. Budget exhaustion returns a stable safe error and creates no provider call.
11. AI output remains `generated` until a human accepts or rejects it. AI cannot confirm facts, approve content, mutate a product, or publish.

### 8. Durable asynchronous execution

1. `POST /api/v1/workspaces/{workspaceId}/products/{productId}/analyses` requires `Idempotency-Key` and returns `202 Accepted` with a `Location` for an operation resource.
2. In one transaction, enqueueing creates the operation/AI-run request, idempotency record, outbox event, and audit event. No provider network call occurs inside that transaction or HTTP request.
3. Extend the worker to claim durable PostgreSQL work using a lease/lock safe for at-least-once execution. It must remain idle without polling spin; a bounded polling/wakeup mechanism may be introduced and must shut down cleanly.
4. Concurrent workers must not execute the same active lease simultaneously. Expired leases may be reclaimed safely.
5. Re-delivery must be idempotent. A succeeded operation is never run again; uncertain outcomes must not be reported as succeeded.
6. Persist attempt count, lease metadata, next-attempt time, safe failure category, and terminal state. Do not persist secret provider payloads in job rows.
7. `GET /api/v1/workspaces/{workspaceId}/operations/{operationId}` exposes only safe status/progress/error metadata and a result location on success.
8. Operation and analysis reads are tenant-scoped and require `catalog.read`.

### 9. Analysis lifecycle

1. Implement list/read endpoints and status filters defined in `docs/API.md`.
2. Analyses are immutable and versioned per product/type.
3. Product analysis requires a confirmed fact set belonging to the same product/workspace.
4. Niche analysis requires a confirmed fact set and may reference only accepted source analyses in the same workspace/product.
5. Accept/reject commands require `catalog.manage`, are idempotent for the same decision, preserve generated content, record reviewer/time, and append audit events atomically.
6. Conflicting second decisions return a stable `409`; they do not rewrite review history.
7. The API never returns hidden system prompts, API keys, provider request/response bodies, or internal chain-of-thought. It may return safe provider/model provenance and evidence mappings.

### 10. HTTP API and contracts

Implement and document at least:

- `POST /api/v1/workspaces`
- `GET /api/v1/workspaces/{workspaceId}/products`
- `POST /api/v1/workspaces/{workspaceId}/products`
- `GET /api/v1/workspaces/{workspaceId}/products/{productId}`
- `PATCH /api/v1/workspaces/{workspaceId}/products/{productId}`
- `POST /api/v1/workspaces/{workspaceId}/products/{productId}/archive`
- `GET /api/v1/workspaces/{workspaceId}/products/{productId}/fact-sets`
- `POST /api/v1/workspaces/{workspaceId}/products/{productId}/fact-sets`
- `GET /api/v1/workspaces/{workspaceId}/products/{productId}/fact-sets/{factSetId}`
- `POST /api/v1/workspaces/{workspaceId}/products/{productId}/fact-sets/{factSetId}/confirm`
- affiliate-destination list/create/update/archive routes nested under the product
- `POST /api/v1/workspaces/{workspaceId}/products/{productId}/analyses`
- `GET /api/v1/workspaces/{workspaceId}/products/{productId}/analyses`
- `GET /api/v1/workspaces/{workspaceId}/analyses/{analysisId}`
- `POST /api/v1/workspaces/{workspaceId}/analyses/{analysisId}/accept`
- `POST /api/v1/workspaces/{workspaceId}/analyses/{analysisId}/reject`
- `GET /api/v1/workspaces/{workspaceId}/operations/{operationId}`

All routes must use runtime-validated schemas that generate or are checked against committed OpenAPI. Unknown mutation fields are rejected. Collection endpoints use bounded cursor pagination. Errors use the existing safe problem-details convention.

### 11. Web experience

1. Replace the shell-only page with a functional, accessible application flow.
2. Required screens/states:
   - signed-out landing with sign-in action;
   - authentication unavailable/error state;
   - signed-in workspace selector;
   - create-workspace form and validation;
   - product list with empty state;
   - create/edit/archive product flow;
   - affiliate-destination management;
   - fact-set editor, provenance fields, confirmation warning, and immutable confirmed view;
   - analysis request controls;
   - queued/running/failed/succeeded operation state;
   - structured product/niche analysis viewer with evidence references;
   - accept/reject controls and review state; and
   - sign-out.
3. Use server components for server-owned data where practical and client components only for necessary interaction. Do not expose server configuration or secrets to the browser.
4. Keep selected workspace in a validated route or application state, not as an authorization source. The server remains authoritative.
5. Forms must prevent accidental duplicate submission while server idempotency remains the real guarantee.
6. Provide keyboard navigation, visible focus, semantic labels, useful validation messages, sufficient contrast, and responsive behavior.
7. Do not present generated analysis as approved or factually verified. Display its source fact-set revision, status, evidence, and uncertainty/risk fields.

### 12. Database changes

Add forward-only migrations for the minimum durable Sprint 2 schema:

- catalog tables: `products`, `product_fact_sets`, `product_facts`, `affiliate_destinations`;
- optional provider-neutral `media_assets` metadata table under the restrictions above;
- intelligence tables: `ai_runs`, `analyses`, and `analysis_subjects`;
- durable delivery tables required by this slice: operation records, `outbox_events`, `job_executions`, and `idempotency_keys` if not already present.

Requirements:

1. Every tenant-owned row has `workspace_id` and enforced ownership relationships wherever PostgreSQL can express them.
2. Prevent cross-workspace parent/child references with composite unique/foreign keys or equivalent database constraints, not application checks alone.
3. Use application-generated UUIDv7 IDs and UTC `timestamptz`.
4. Mutable resources have monotonic version and timestamp invariants.
5. Confirmed fact sets/facts and analysis content cannot be silently updated. Enforce immutability in PostgreSQL where practical and prove it with real integration tests.
6. Add only indexes justified by actual query/cursor/claim patterns.
7. Migration validation must pass from an empty database and across the existing migration history.

### 13. Security requirements

1. Authenticate every non-public route and authorize every workspace route with the existing closed capabilities.
2. Preserve non-disclosure: another workspace's product/fact/analysis/operation must not be distinguishable from a missing resource to unauthorized callers.
3. Protect cookie-authenticated mutations with the existing same-origin policy and an approved CSRF strategy. CORS remains closed by default.
4. Validate all body, path, query, header, pagination, idempotency, and concurrency inputs before use.
5. Never fetch user-supplied URLs in this task. URL acceptance is not permission to perform SSRF-capable metadata retrieval.
6. Never hard-code or log secrets. Provider credentials remain server-side validated configuration.
7. Limit request size, fact count, fact text, source excerpts, analysis instructions, provider output, collection page size, and retry counts.
8. Sanitize database/provider errors and hostile objects. Do not execute untrusted getters, coercion hooks, or proxy traps in domain/application validation.
9. Audit changes use allowlisted scalar summaries only. Do not place full facts, affiliate URLs, prompts, AI output, tokens, or credentials in audit rows.
10. Rate-limit workspace creation, catalog mutations, analysis generation, and operation polling appropriately.

### 14. Error handling and recovery

1. Use stable error codes for validation, authentication, authorization, missing resources, version conflicts, idempotency conflicts, disabled AI, budget exhaustion, provider unavailability, invalid provider output, and terminal operation failure.
2. A provider outage must not roll back the already-confirmed product facts or corrupt a previous analysis.
3. Failed operations remain inspectable with safe actionable state and may be retried only through an explicit idempotent command or classified automatic retry policy.
4. Worker shutdown must release or allow expiry of leases without reporting unfinished work as success.
5. UI errors must preserve user-entered non-secret form data where safe and provide a clear recovery action.

## Expected files

Expected areas, subject to architecture-preserving refinement:

- `apps/web/app/**`
- `apps/web/src/**`
- `apps/web/test/**`
- `apps/api/src/**`
- `apps/api/test/**`
- `apps/worker/src/**`
- `apps/worker/test/**`
- `packages/domain/src/catalog/**` or equivalent cohesive domain modules
- `packages/domain/src/analysis/**` or equivalent
- `packages/domain/test/**`
- `packages/application/src/workspaces/**`
- `packages/application/src/catalog/**`
- `packages/application/src/analysis/**`
- `packages/application/src/operations/**`
- `packages/application/test/**`
- `packages/infrastructure/src/tenancy/**`
- `packages/infrastructure/src/catalog/**`
- `packages/infrastructure/src/analysis/**`
- `packages/infrastructure/src/jobs/**`
- `packages/infrastructure/test/unit/**`
- `packages/infrastructure/test/integration/**`
- `packages/infrastructure/migrations/0005_*.sql` and later forward migrations
- `openapi/openapi.json`
- `docs/API.md`, `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, and `README.md` where actual contracts/runbooks change
- configuration package files and `.env.example` only for newly approved provider/budget/worker settings
- package manifests and lockfile only for justified dependencies

Do not treat this list as permission for unrelated refactors.

## API changes

- Add the authenticated workspace/catalog/fact/affiliate/analysis/operation endpoints listed above.
- Extend the generated/verified OpenAPI contract from runtime schemas.
- Preserve all TASK-006 authentication endpoints and response contracts.
- No public third-party API is introduced.

## Frontend changes

- Replace the runtime shell with the complete authenticated Sprint 2 experience described above.
- Keep the visual system small and coherent; prioritize the primary workflow, accessibility, clear state, and recoverability over a broad design system.
- Do not implement content generation, publishing, or analytics UI in this task.

## Backend changes

- Compose existing authentication, tenancy, authorization, transaction, and audit boundaries into real routes.
- Add catalog, fact, affiliate, AI analysis, operation, outbox, and worker modules.
- Add a concrete AI provider adapter only after explicit Product Owner provider/model selection.
- Keep external provider calls outside database transactions.

## Edge cases

At minimum, handle and test:

- signed-in user with zero, one, or multiple workspaces;
- inactive/disabled user or suspended/removed membership;
- duplicate slug and concurrent workspace creation attempts;
- viewer attempting any mutation;
- cross-workspace IDs at every nesting level;
- malformed UUIDs, URLs, pagination cursors, ETags, and idempotency keys;
- duplicate product URL warning without automatic merge;
- concurrent product update and stale version;
- empty, oversized, duplicate-key, prohibited, uncertain, or malformed facts;
- concurrent creation of the next fact-set revision;
- repeated confirmation and attempted mutation of a confirmed fact set;
- affiliate URLs containing credentials, fragments, sensitive query values, Unicode/control characters, or malformed encoding;
- archived product analysis request;
- analysis requested with an unconfirmed or foreign fact set;
- repeated analysis request with same and different idempotency payloads;
- provider timeout, abort, rate limit, transient outage, permanent error, oversized response, invalid JSON, schema mismatch, unknown evidence ID, and repeated invalid repair;
- worker crash after provider response but before persistence;
- lease expiry and concurrent worker claim;
- user polls an operation or reads an analysis from another workspace;
- accept/reject races and repeated decisions;
- transaction failure between domain mutation and audit/outbox insertion;
- authentication expiry while a web form is open;
- JavaScript disabled/basic server response where reasonable, slow network, and double click.

## Acceptance criteria

1. From a clean database and approved provider configuration, a real user can sign in, create a workspace, create a product, add and confirm facts, request product and niche analyses, inspect evidence-linked results, and accept or reject them through the web UI.
2. No production-visible action returns fake success. If OIDC or AI is not configured, the UI/API shows an explicit safe unavailable state.
3. Every tenant route authenticates and authorizes correctly; viewer/editor/owner behavior matches `docs/PRODUCT.md`; cross-tenant tests prove non-disclosure.
4. Workspace/product/fact/affiliate/analysis mutations use the required transaction, idempotency/concurrency controls, and atomic append-only audit event.
5. Product and affiliate validation is bounded and safe; the system performs no user-directed URL fetch.
6. Confirmed fact sets are immutable and only eligible confirmed facts ground affirmative analysis claims.
7. Analysis execution is asynchronous and durable. HTTP requests do not hold database transactions open around provider calls.
8. AI output is schema-validated, evidence-validated, versioned, attributable to safe provenance, and remains human-reviewed state. Invalid output never becomes a successful analysis.
9. At-least-once worker execution, leases, retries, shutdown, and re-delivery do not create duplicate successful analyses or false success.
10. OpenAPI matches runtime validation and all public errors use safe stable problem details.
11. The web flow is keyboard-operable, responsive, and exposes clear loading/empty/error/status/recovery states.
12. Existing TASK-001 through TASK-008 tests and contracts continue to pass.
13. New domain/application/route/worker tests, real PostgreSQL integration tests, and browser end-to-end tests cover the primary flow and the security/concurrency edge cases above.
14. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm openapi:check`, `pnpm build`, migration validation, and the relevant integration/E2E suites pass from a clean checkout.
15. README documents exact local startup, migration, provider configuration, worker execution, and demo steps without including secrets.

## Test plan

### Domain and application tests

- Product/fact/affiliate validation and state transitions.
- Capability matrix and authorization composition.
- Fact-set revision/confirmation immutability.
- Analysis schema, evidence, review, budget, and error behavior.
- Idempotency and optimistic-concurrency behavior.
- Hostile input/proxy/getter/coercion tests for public boundaries.

### API tests

- Runtime schema/OpenAPI parity.
- Authentication/origin/CSRF/rate-limit behavior.
- Role matrix and cross-tenant non-disclosure for every route family.
- Problem-details codes/statuses and secret/redaction assertions.
- `202` operation and polling lifecycle.

### PostgreSQL integration tests

- Empty-database migration sequence and checksums.
- Workspace/catalog/fact/affiliate/AI/outbox constraints and indexes.
- Cross-tenant composite foreign-key rejection.
- Atomic mutation + audit + outbox rollback behavior.
- Confirmed fact/analysis immutability.
- Concurrent revisions, updates, idempotency keys, leases, and worker claims.

### AI adapter contract tests

- Valid structured response mapping.
- Timeout/abort, transient/permanent failures, rate limits, invalid/oversized output, one repair maximum, evidence mismatch, and redaction.
- Recorded usage/provenance without secret or prompt leakage.
- No live provider call in normal CI. A narrow opt-in smoke test may be documented for approved credentials.

### Web and end-to-end tests

- Signed-out, unavailable, no-workspace, product-empty, and error states.
- Primary sign-in-to-accepted-analysis flow using controlled test infrastructure.
- Viewer read-only UI and server enforcement.
- Duplicate submission, stale update, expired session, failed operation, retry/recovery, and accessibility smoke coverage.

### Final evidence

- Run all repository gates.
- Run PostgreSQL integration tests against the pinned database image.
- Run browser end-to-end tests against built applications where practical.
- Provide exact commands, exit codes, test counts, and any intentionally skipped opt-in live-provider smoke test.

## Out of scope

- Content briefs, content generation, platform variants, compliance evaluation, revision history, and approval workflow (Sprint 3).
- Social-account OAuth, Threads/TikTok adapters, scheduling, publishing, and reconciliation (Sprints 4 and 5).
- Analytics synchronization, dashboards, performance analysis, and recommendation adoption (Sprint 6).
- Product metadata scraping/fetching, merchant crawling, competitor research, social listening, or automatic fact promotion.
- Production image/video generation or editing.
- Complete media object-storage upload/scan pipeline unless separately approved after a storage decision.
- Workspace invitation/member management, workspace deletion/export, billing, subscriptions, custom roles, enterprise SSO, or a public API.
- Autonomous fact confirmation, analysis acceptance, content approval, scheduling, or publishing.
- Microservices, Redis, Kafka, Kubernetes, CQRS, event sourcing, or a second database.

## Implementation handoff rules

Antigravity must:

1. read `AGENTS.md`, the governing docs, this task, and the actual merged code before implementation;
2. work only within this Sprint 2 scope and report any necessary deviation before making it;
3. present each checkpoint as a focused diff/PR with migrations and tests included;
4. never claim a provider integration passed without running the applicable contract/smoke evidence;
5. run all relevant gates before requesting review; and
6. provide the exact branch, commits, diff scope, commands, results, and known limitations.

Codex will review each checkpoint against the user requirement, this specification, architecture, actual code/diff, database/API/frontend/backend/security behavior, and executed evidence. Sprint 2 is complete only after final Codex review returns:

`STATUS: APPROVED`
