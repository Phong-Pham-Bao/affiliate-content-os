# TASK-011 — Sprint 3 Checkpoint A: AI Workforce Orchestration Foundation

Status: Approved by Product Owner on 2026-11-07

Owner: Antigravity (Implementation Engineer)

Reviewer: Codex (Lead Architect / CTO / Final Reviewer)

## Objective

Implement the internal Sprint 3 foundation for a boss-directed AI workforce: immutable context snapshots, deterministic work orders, role assignments, parallel-ready work items, explicit dependency waiting, tenant-safe queries, and an atomic audited kickoff transaction.

Checkpoint A must leave the repository buildable and fully tested. It must not call Gemini, enqueue provider jobs, expose a partial public workflow, or build the virtual-office UI.

## Context

The Product Owner approved all six recommendations in `docs/SPRINT-3-AI-WORKFORCE-PLAN.md`. ADR-023 is authoritative for orchestration. Sprint 2 already provides Google OIDC, workspace authorization, product/fact provenance, accepted analyses, AI policy, durable operations/jobs, audit, idempotency, and PostgreSQL migration infrastructure.

The reference HTML is a visual prototype only. Its timer-driven steps, generated percentages, static reports, and fake files are not implementation contracts. Real employee state must come from persisted work-order state.

Before implementation, read completely:

- `AGENTS.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/DECISIONS.md`, especially ADR-001, ADR-003, ADR-004, ADR-007, ADR-013, ADR-016, ADR-019, ADR-020, ADR-021, ADR-022, and ADR-023
- `docs/SPRINT-3-AI-WORKFORCE-PLAN.md`
- `tasks/TASK-009.md`
- `tasks/TASK-010.md`
- this task

Inspect the actual current code and contracts before editing. Report any required deviation before redesigning a boundary.

## Required implementation

### 1. Domain foundation

Add branded UUIDv7 IDs, parsers, immutable snapshots, enums/unions, and validators for:

- `WorkOrderId`
- `WorkItemId`
- `AgentRoleDefinitionId`
- `AgentAssignmentId`
- `ContextPackageId`
- `WorkItemDependencyId`

Normative role keys:

- `chief_of_staff`
- `product_strategist`
- `audience_strategist`
- `creative_director`
- `scriptwriter`
- `compliance_reviewer`

Normative mission types for Checkpoint A:

- `short_video_series`
- `product_launch_plan`
- `objection_handling_series`
- `educational_series`
- `custom`

Normative work-order states:

- `preparing`
- `in_progress`
- `waiting_review`
- `completed`
- `blocked`
- `failed`
- `canceled`

Normative work-item states:

- `ready`
- `waiting_dependency`
- `queued`
- `running`
- `review_required`
- `completed`
- `blocked`
- `failed`
- `canceled`

Normative assignment office states:

- `preparing`
- `queued`
- `running`
- `waiting_dependency`
- `review_required`
- `completed`
- `blocked`
- `failed`
- `canceled`

Do not add provider SDK, PostgreSQL, Fastify, React, mutable `Date`, request, session, cookie, logger, or environment types to domain contracts.

### 2. Approved deterministic graph

Checkpoint A supports one internal graph template named `creative_office_v1`:

- Chief of Staff assignment: `preparing`; it represents deterministic coordination and has no provider work item in Checkpoint A.
- `product_strategy`: role `product_strategist`, state `ready`, no dependencies.
- `audience_strategy`: role `audience_strategist`, state `ready`, no dependencies.
- `creative_direction`: role `creative_director`, state `ready`, no dependencies.
- `scriptwriting`: role `scriptwriter`, state `waiting_dependency`, depends on all three planning items.
- `compliance_review`: role `compliance_reviewer`, state `waiting_dependency`, depends on `scriptwriting`.

All six assignments are created atomically. This is how all employees visibly begin preparing together while only valid independent work is ready for later execution.

The graph must be built by deterministic application code from the approved template. Do not ask an AI model to create, remove, reorder, or authorize work items.

### 3. PostgreSQL migration `0008_ai_workforce_foundation.sql`

Add these tables using forward-only migration conventions, composite tenant foreign keys where applicable, bounded text/JSON, timestamp/version checks, and supporting indexes.

#### `agent_role_definitions`

- `id UUID PRIMARY KEY`
- `role_key TEXT NOT NULL`
- `display_name TEXT NOT NULL`
- `department TEXT NOT NULL`
- `role_version INTEGER NOT NULL`
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `allowed_artifact_types_json JSONB NOT NULL DEFAULT '[]'`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `version BIGINT NOT NULL DEFAULT 1`
- unique `(role_key, role_version)`
- validate approved role keys, positive versions, JSON array shape, trimmed bounded names/departments, and timestamp ordering

Seed exactly the six approved role definitions at role version 1 using deterministic UUID literals. Seed rows contain no prompts, credentials, model settings, or provider data.

#### `context_packages`

- `id UUID PRIMARY KEY`
- `workspace_id UUID NOT NULL`
- `product_id UUID NOT NULL`
- `fact_set_id UUID NOT NULL`
- `context_schema_version INTEGER NOT NULL`
- `context_hash BYTEA NOT NULL`
- `created_by_user_id UUID NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- unique `(workspace_id, id)`
- composite tenant foreign keys to workspace product and confirmed fact-set identity
- exact 32-byte hash, positive schema version, and immutable-row enforcement

#### `context_package_analyses`

- `workspace_id UUID NOT NULL`
- `context_package_id UUID NOT NULL`
- `analysis_id UUID NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- primary key `(context_package_id, analysis_id)`
- composite tenant foreign keys to context package and analysis

Only accepted analyses may be inserted by the kickoff transaction. Do not use a trigger that silently changes application data.

#### `work_orders`

- `id UUID PRIMARY KEY`
- `workspace_id UUID NOT NULL`
- `product_id UUID NOT NULL`
- `context_package_id UUID NOT NULL`
- `mission_type TEXT NOT NULL`
- `directive_text TEXT NOT NULL`
- `graph_template TEXT NOT NULL`
- `graph_version INTEGER NOT NULL`
- `status TEXT NOT NULL`
- `priority INTEGER NOT NULL DEFAULT 50`
- `created_by_user_id UUID NOT NULL`
- `failure_category TEXT NULL`
- `completed_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `version BIGINT NOT NULL DEFAULT 1`
- unique `(workspace_id, id)`
- tenant foreign keys to product and context package
- bounded trimmed directive: 1–4000 characters
- template must be `creative_office_v1`, graph version must be 1
- priority range 1–100
- state/terminal/timestamp consistency checks

#### `work_items`

- `id UUID PRIMARY KEY`
- `workspace_id UUID NOT NULL`
- `work_order_id UUID NOT NULL`
- `role_definition_id UUID NOT NULL`
- `task_key TEXT NOT NULL`
- `expected_artifact_type TEXT NOT NULL`
- `status TEXT NOT NULL`
- `blocked_reason_code TEXT NULL`
- `started_at TIMESTAMPTZ NULL`
- `completed_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `version BIGINT NOT NULL DEFAULT 1`
- unique `(workspace_id, id)` and `(work_order_id, task_key)`
- composite tenant foreign key to work order and foreign key to role definition
- approved task keys only: `product_strategy`, `audience_strategy`, `creative_direction`, `scriptwriting`, `compliance_review`
- approved expected artifact types only: `product_campaign_plan`, `audience_insight_board`, `video_series_plan`, `script_package`, `compliance_report`
- state/timestamp/blocker/version consistency checks

#### `work_item_dependencies`

- `id UUID PRIMARY KEY`
- `workspace_id UUID NOT NULL`
- `work_order_id UUID NOT NULL`
- `work_item_id UUID NOT NULL`
- `depends_on_work_item_id UUID NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- unique `(work_item_id, depends_on_work_item_id)`
- composite tenant foreign keys to the same work order's items
- prevent direct self-dependency with a check
- application graph validation must also reject cycles

#### `agent_assignments`

- `id UUID PRIMARY KEY`
- `workspace_id UUID NOT NULL`
- `work_order_id UUID NOT NULL`
- `role_definition_id UUID NOT NULL`
- `work_item_id UUID NULL`
- `office_state TEXT NOT NULL`
- `waiting_on_work_item_id UUID NULL`
- `latest_report_code TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `version BIGINT NOT NULL DEFAULT 1`
- unique `(work_order_id, role_definition_id)`
- composite tenant foreign keys and consistency checks for waiting state/reference
- the Chief of Staff assignment is the only assignment allowed to have `work_item_id IS NULL`

Do not store prompts, provider responses, secrets, OAuth data, raw session values, arbitrary tool definitions, or chain-of-thought in any new table.

### 4. Application use cases and ports

Add a `KickoffCreativeWorkOrder` command/use case with named immutable inputs:

- workspace ID
- product ID
- mission type
- bounded directive text
- optional accepted analysis IDs
- idempotency key
- actor user ID

Application behavior:

1. Parse and validate all IDs/enums/text before side effects.
2. Require an active member with `catalog.write`; viewer is denied. Owner and editor are allowed to create.
3. Load the workspace-scoped product and require a current confirmed fact set.
4. Load every optional source analysis in the same workspace/product and require `accepted` status.
5. Compute an immutable canonical context descriptor from IDs and versions only, then SHA-256 it. Do not copy product descriptions, fact values, analysis content, or the directive into job/audit payloads.
6. Build and validate `creative_office_v1` deterministically, including acyclic dependencies.
7. Execute one atomic persistence call that creates context package, analysis links, work order, five work items, six assignments, dependencies, an idempotency result, and one safe audit event.
8. Return the created/replayed work-order summary and whether it was replayed.

Add read use cases/ports for workspace-scoped `getWorkOrder` and cursor-paginated `listWorkOrders`. Reads require active membership and return assignment/work-item summaries without content bodies that do not yet exist.

Ports must expose domain/application DTOs only. PostgreSQL clients, SQL rows, hashes as mutable buffers, Fastify types, and provider types may not cross the infrastructure boundary.

### 5. Atomic persistence and idempotency

Implement a PostgreSQL adapter and one transaction for kickoff.

- Lock/revalidate the product current fact set and selected analysis states inside the transaction.
- Use the existing idempotency key contract and fingerprint semantics. Same key/same command returns the original completed result; same key/different command conflicts; in-progress and expired behavior remains consistent with existing commands.
- Duplicate/replayed kickoff must not create another work order, context package, assignment, dependency, audit event, or future billable unit.
- IDs are generated before the transaction by injected ID generation and validated.
- Audit action: `creative.work_order.created`.
- Audit resource type: `work_order`.
- Audit changes may include only safe IDs, mission type, graph template/version, role/task counts, and initial states. Never include directive text, product/fact/analysis content, email, URLs, prompt text, or provider data.
- No workspace AI budget reservation occurs in Checkpoint A because no provider job is enqueued. Checkpoint B will add reservation and execution atomically.

### 6. Dependency readiness query

Implement and integration-test a persistence operation that returns all `ready` work items for a work order and a deterministic application function that identifies which waiting items become eligible after a supplied set of completed item IDs.

Checkpoint A must not mutate waiting items into queued/running states and must not insert `job_executions`, `ai_runs`, or provider operations. Those transitions belong to Checkpoint B.

### 7. Documentation

Update:

- `docs/DATABASE.md` with the migration and invariants.
- `docs/ARCHITECTURE.md` with the deterministic graph/context boundary.
- `docs/API.md` only to state that public Sprint 3 HTTP routes are intentionally deferred to Checkpoint B.

Do not modify the approved Sprint 3 plan or ADR semantics without reporting a deviation.

## Expected files

- `packages/domain/src/workforce/*` and controlled exports
- `packages/application/src/workforce/*` and controlled exports
- `packages/infrastructure/migrations/0008_ai_workforce_foundation.sql`
- `packages/infrastructure/src/workforce/*` and controlled exports
- focused domain/application/unit/integration tests
- migration and documentation updates listed above

Exact internal filenames may follow existing package conventions. Do not move unrelated modules.

## Database changes

Migration `0008_ai_workforce_foundation.sql` only. It must be forward-only, atomic, checksum-managed, idempotently discoverable by the existing migration engine, and valid against a clean PostgreSQL database plus the current seven migrations.

No change to Sprint 2 tables or existing migration files is permitted. Existing data must remain valid without destructive backfill.

## API changes

None in Checkpoint A. Do not register Fastify routes or modify OpenAPI. Public work-order APIs arrive in Checkpoint B when real execution and user-visible recovery exist.

## Frontend changes

None in Checkpoint A. Do not copy the reference HTML into the application and do not add simulated office UI.

## Backend changes

- New workforce domain/application/infrastructure modules.
- Migration and transaction adapter.
- No provider call, worker claim, scheduler, or background loop change.

## Security requirements

- Strict tenant scoping and composite foreign keys.
- Active membership plus capability enforcement.
- Confirmed fact set and accepted-analysis revalidation inside the transaction.
- Bounded directive and enum validation before persistence.
- Immutable context package rows and hash copying at boundaries.
- Safe audit payload allowlist.
- No secret, prompt/provider response, chain-of-thought, raw content, session, cookie, email, URL, or arbitrary JSON leakage into jobs/audit/logs.
- No dynamic tools, shell/browser access, provider accounts, or external calls.

## Edge cases

- Viewer kickoff attempt.
- Cross-workspace product, fact set, analysis, work item, or dependency.
- Missing/unconfirmed current fact set.
- Rejected/generated/nonexistent/source-product-mismatched analysis.
- Duplicate analysis IDs.
- Empty/oversized/untrimmed/control-character directive.
- Unknown mission, role, task, artifact, graph template/version, or state.
- Direct self-dependency, duplicate edge, cycle, disconnected required item, or missing required role.
- Same idempotency key with same command, different directive, different analysis order, and duplicate normalized analysis IDs.
- Concurrent identical and conflicting kickoff requests.
- Transaction failure at every insertion stage leaves no partial graph.
- Returned mutable arrays/bytes cannot mutate stored/domain state.

## Acceptance criteria

1. Migration 0008 creates exactly the approved foundation tables, seeds six roles, preserves prior schema/data, and validates cleanly twice.
2. One kickoff atomically creates one immutable context package, one work order, five work items, six assignments, four dependency edges, one idempotency result, and one audit event.
3. Product, audience, and creative items are `ready`; scriptwriting and compliance are `waiting_dependency`; all assignments begin in the correct honest office state.
4. Graph validation rejects cycles, missing roles/items, invalid edges, and non-approved templates.
5. Tenant authorization and confirmed/accepted source rules are enforced before and inside persistence.
6. Identical idempotent replay returns the original result without duplicate rows or audit; mismatched reuse conflicts.
7. Concurrent kickoff tests prove atomicity and duplicate safety on real PostgreSQL.
8. Get/list queries are tenant-safe, versioned DTOs with deterministic cursor order.
9. No new HTTP route, UI, provider call, worker job, fake output, or AI approval exists.
10. All repository gates and PostgreSQL integration tests pass.

## Test plan

At minimum add and run:

- Domain ID/enum/snapshot/graph invariant tests.
- Application kickoff validation, authorization, deterministic graph, idempotency fingerprint, and mutation-safety tests.
- Migration schema/constraint/seed/immutability tests.
- PostgreSQL kickoff success, rollback injection, tenant isolation, accepted-analysis locking/revalidation, exact row counts, safe audit, replay, mismatch, and concurrency tests.
- Get/list pagination and workspace isolation tests.
- Existing full unit, boundary, typecheck, lint, OpenAPI consistency, build, migration validation, and all PostgreSQL integration suites.

Required final commands include:

- `pnpm check`
- PostgreSQL integration suite using the repository's disposable-database safety variables
- `pnpm db:migrate:validate`
- `git diff --check`

## Out of scope

- Gemini calls, prompts, output schemas, content artifacts, or AI repair.
- Job execution, worker concurrency, provider budget reservation/settlement, retry, or dependency release mutation.
- HTTP routes, OpenAPI changes, or web UI.
- Chat, office animation, canvas, avatars, fake progress, fake files, or WebSockets.
- Content revisions, compliance execution, approval, publishing, social OAuth, scheduling, analytics, or media generation.
- New dependencies unless unavoidable and explicitly reported before addition.
- Microservices, Redis, Kafka, Kubernetes, CQRS, event sourcing, or a second database.

## Implementation and handoff rules

Antigravity must implement the entire approved Checkpoint A independently and report only when it is ready for Codex review or when a genuine specification blocker requires Product Owner/CTO authority.

Before requesting review, Antigravity must provide:

- exact final commit SHA and branch;
- concise implementation summary and any deviations;
- complete changed-file list;
- migration evidence and exact row/invariant evidence;
- exact test/typecheck/lint/build/integration commands, exit codes, and counts;
- confirmation that no secrets or unrelated `plans/` artifacts were committed;
- known limitations confined to the approved out-of-scope list.

Antigravity must not claim architectural approval. Codex will inspect the actual diff and rerun proportionate gates. Completion requires Codex to return `STATUS: APPROVED`.
