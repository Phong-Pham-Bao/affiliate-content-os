# Affiliate Content OS - Architecture Decision Register

Status: Sprint 0 architecture baseline, approved

Last updated: 2026-10-05

## Baseline approval record

- Approved by: Product Owner (user)
- Approved on: 2026-10-05
- Baseline scope: `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/DECISIONS.md`, and `tasks/TASK-001.md`
- Effect: ADR-001 through ADR-022 are accepted as the governing Sprint 0 architecture baseline. The open decisions listed below remain intentionally unresolved and must be decided before a dependent implementation or production beta milestone.
- Implementation boundary: approval authorizes the documented Sprint 1 workflow; it does not itself implement `TASK-001`.

## How to use this document

Accepted decisions govern implementation after Product Owner approval. A material change requires a new decision entry that supersedes the old one; history is not rewritten. Product requirements override architecture decisions when explicitly stated, but the conflict must be recorded and reconciled before implementation.

Decision states: `proposed`, `accepted`, `superseded`, `rejected`.

## ADR-001: Modular monolith

- Status: accepted
- Decision: Build one TypeScript codebase and domain model, deployed as web, API, and worker process types. Keep module boundaries explicit and use in-process application ports plus an outbox for background work.
- Rationale: The MVP needs transactional workflow consistency and a small-team operating model. Independent process scaling is enough without distributed domain ownership.
- Consequences: Modules share a release and PostgreSQL. Boundary tests and import rules are required to prevent a ball of mud.
- Rejected: microservices, Kubernetes, Kafka, service mesh, CQRS, and event sourcing for MVP because current requirements do not justify their cost.

## ADR-002: TypeScript workspace and runtime stack

- Status: accepted
- Decision: Use a `pnpm` workspace with strict TypeScript. Use Next.js for web, Fastify for the HTTP API, and a Node worker sharing domain/application packages. Pin the Node major and all package-manager/dependency versions in implementation.
- Rationale: One language supports shared validation/contracts while keeping backend module boundaries explicit. Fastify gives a narrow, testable API surface without making the web framework the domain boundary.
- Consequences: Session/auth integration across web and API needs deliberate same-origin deployment and cookie configuration. Shared types must not become shared server internals.
- Rejected: putting business logic in Next.js route handlers; separate frontend/backend languages; an unversioned global toolchain.

## ADR-003: PostgreSQL is the source of truth

- Status: accepted
- Decision: Use PostgreSQL for transactional state, scheduling records, outbox, audit, and MVP analytics. Use a Redis-compatible queue only for delivery/wakeup and worker distribution.
- Rationale: The product has relational invariants, scheduling/concurrency needs, and moderate MVP volume. PostgreSQL provides transactions, locks, constraints, and recoverability.
- Consequences: Queue loss must be recoverable from PostgreSQL. Analytical workload must be monitored; a warehouse is a later decision.
- Rejected: queue as canonical job state, document database as primary store, an MVP data warehouse.

## ADR-004: REST with schema-first compatibility controls

- Status: accepted
- Decision: Expose versioned JSON REST under `/api/v1`, describe it in OpenAPI, share/generated validated contracts, use cursor pagination, ETags/versions, idempotency keys, and Problem Details errors.
- Rationale: Resource/workflow commands are understandable and easy to inspect, secure, and test.
- Consequences: Command endpoints are used for state transitions that do not fit CRUD. OpenAPI diff checks are required.
- Rejected: GraphQL and a public event API for MVP.

## ADR-005: Managed OIDC for application identity

- Status: accepted
- Decision: Use a managed OIDC identity provider with authorization-code flow and secure server sessions. Keep application sign-in separate from social-platform OAuth.
- Rationale: Password storage and account recovery are not product differentiators. Separation prevents a connected social account from becoming an application identity by accident.
- Consequences: The specific vendor remains a deployment decision. User identity is issuer + subject, not email.
- Rejected: building passwords/authentication in-house; using Threads/TikTok connection as application login in MVP.

## ADR-006: Workspace tenancy and fixed roles

- Status: accepted
- Decision: Scope all customer data to a workspace and implement `owner`, `editor`, and `viewer` roles. Enforce authorization at route, use-case, and repository boundaries.
- Rationale: Even solo users benefit from a tenancy boundary that permits safe team growth. Three roles meet MVP needs without policy complexity.
- Consequences: Every tenant query requires workspace context and isolation tests. Editors may self-approve in MVP.
- Rejected: global user-owned resources, custom RBAC/ABAC, mandatory dual approval in MVP.

## ADR-007: Immutable content revisions and approval snapshots

- Status: accepted
- Decision: Content edits create immutable revisions. Approval binds the exact content/media hashes, destination account, disclosures/labels/settings, compliance evaluation, and actor/time. Material changes require new approval.
- Rationale: Publishing must be demonstrably human-approved and reproducible.
- Consequences: More rows and explicit state transitions; storage/history are intentional. UI must explain why approval was invalidated.
- Rejected: a mutable draft with a single Boolean `approved` field.

## ADR-008: Durable scheduling with outbox and at-least-once workers

- Status: accepted
- Decision: Store schedules/publication state in PostgreSQL, write transactional outbox events, and process via at-least-once workers using leases, idempotent handlers, bounded retries, and dead-letter/operator views.
- Rationale: Database commits and queue sends cannot be atomically coordinated without an outbox. At-least-once delivery is realistic and recoverable.
- Consequences: All consumers expect duplicates. Scheduler/worker concurrency and recovery need integration tests.
- Rejected: in-memory timers, platform scheduler as the only record, exactly-once claims, blind cron-to-API calls.

## ADR-009: Unknown publish outcomes require reconciliation

- Status: accepted
- Decision: Create a stable publish attempt before an external call. If the call times out after possible acceptance, set `outcome_unknown` and query official status/listing capabilities or require operator resolution before retry.
- Rationale: A blind retry can create duplicate public content and harm users/accounts.
- Consequences: Some posts can remain unresolved. Adapters must model remote operations and provide reconciliation where the platform permits it.
- Rejected: treating timeouts as safe failures; claiming local request acceptance means published.

## ADR-010: Official platform APIs behind adapters

- Status: accepted
- Decision: Use only appropriate official APIs. Isolate auth and publishing/analytics behavior behind `SocialAuthAdapter` and `SocialPlatformAdapter`. Discover capabilities per account and gate unavailable features.
- Rationale: Platform rules, scopes, limits, payloads, and review status change independently from the product domain.
- Consequences: Product UX must handle direct publish, user-action handoff, review-gated, and unavailable states. Provider SDK/payload types stay in infrastructure.
- Rejected: unofficial/private APIs, browser automation, fabricated success, bypassing review/rate/moderation limits.

## ADR-011: Threads MVP boundary

- Status: accepted
- Decision: Support authorized account connection, text and one supported media attachment, publish-status processing, and granted official insights. Exclude engagement automation and moderation features.
- Rationale: This is the smallest Threads surface that completes the product loop.
- Consequences: Exact scopes, review requirements, media rules, API version, and available metrics must be verified during adapter implementation and before each release.
- Rejected: hard-coding current endpoint behavior as a permanent domain contract.
- Official reference for implementation-time verification: [Threads API documentation](https://developers.facebook.com/docs/threads/).

## ADR-012: TikTok is capability- and audit-gated

- Status: accepted
- Decision: MVP accepts user-provided video and supports Direct Post only after required app approval/audit and user authorization. Query creator options, capture explicit final consent/settings, poll status, and otherwise use a compliant official draft-upload/manual handoff path.
- Rationale: TikTok's official Content Posting API requires the relevant scopes and creator choices; unaudited Direct Post has visibility restrictions. Product correctness cannot promise a capability the app does not possess.
- Consequences: TikTok direct publishing may remain disabled during early beta. Product state distinguishes remote processing and user completion from confirmed publication.
- Rejected: private-only test posts represented as public success, hidden/default privacy choices, watermarked promotional media that violates sharing guidance, automated re-posting around limits.
- Official references verified 2026-10-05: [Direct Post getting started](https://developers.tiktok.com/docs/en/content-posting-api-get-started), [Direct Post API reference](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [Login Kit for Web](https://developers.tiktok.com/docs/en/login-kit-web), and [Content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines).

## ADR-013: AI gateway with structured, grounded outputs

- Status: accepted
- Decision: Route all model calls through a vendor-neutral AI Gateway. Use explicit context packages, versioned prompt/output schemas, evidence references, deterministic validation, budgets, and recorded provenance.
- Rationale: AI output is non-deterministic and may hallucinate or follow hostile source text. The system needs testable contracts and vendor flexibility.
- Consequences: Invalid output fails visibly or receives one bounded repair. Model/prompt changes require evaluations. AI cannot approve or publish.
- Rejected: provider SDKs in domain modules, storing opaque prose without provenance, autonomous learning that mutates content.

## ADR-014: User-provided media only in MVP

- Status: accepted
- Decision: Accept scanned, validated user media through object storage. Do not generate or edit production images/video in MVP.
- Rationale: Media generation/editing adds cost, moderation, rights, and pipeline complexity unrelated to proving the core workflow.
- Consequences: TikTok users must supply a compliant video. Media asset scanning and metadata validation are still required.
- Rejected: server-local uploads, arbitrary remote media fetch, AI media generation in initial scope.

## ADR-015: Platform-native analytics first

- Status: accepted
- Decision: Store append-only metric snapshots with platform-qualified definitions and observation windows. Normalize only semantics reviewed as genuinely equivalent. Use PostgreSQL for MVP analysis.
- Rationale: Similar metric names can differ between platforms, and overwritten counters destroy evidence needed for learning.
- Consequences: Cross-platform dashboards may show separate measures. AI analysis must cite window/freshness and cannot claim causality or conversions.
- Rejected: one universal engagement score as source data; scraping analytics; warehouse before measured need.

## ADR-016: Compliance is layered and human-accountable

- Status: accepted
- Decision: Combine deterministic versioned policy checks, platform validation, product-fact grounding, visible disclosures/settings, user attestations, and an immutable audit trail. AI can add warnings but cannot be the sole gate.
- Rationale: Compliance depends on jurisdiction, product category, platform, and actual claims. A model output is not a legal guarantee.
- Consequences: Blocking checks fail closed. Product copy must state that users remain responsible and legal review is outside the MVP.
- Rejected: “AI-approved compliance,” invisible disclosures, silently chosen commercial/AI labels.

## ADR-017: Encrypt social credentials with managed keys

- Status: accepted
- Decision: Store access/refresh tokens server-side in an isolated table using envelope encryption with a managed KMS/key version. Decrypt only in narrowly authorized paths and redact at the logger boundary.
- Rationale: Social credentials can publish publicly and are the highest-impact stored secret class.
- Consequences: Local development uses a documented non-production key mechanism. Rotation and compromise runbooks are required.
- Rejected: plaintext database tokens, client-side token storage, tokens in queue messages or logs.

## ADR-018: Object storage for media

- Status: accepted
- Decision: Use S3-compatible private object storage with constrained signed uploads, quarantine/scanning, content inspection, and short-lived reads. Persist metadata/references in PostgreSQL.
- Rationale: Media should not transit or reside permanently on application disks.
- Consequences: Object/database consistency and orphan cleanup need jobs and restore procedures.
- Rejected: public buckets, caller-selected object keys, permanent public URLs.

## ADR-019: Observability uses OpenTelemetry and separate audit records

- Status: accepted
- Decision: Emit correlated structured logs, metrics, and traces through OpenTelemetry-compatible tooling. Store product/security audit events in PostgreSQL separately from operational telemetry.
- Rationale: Operational debugging and durable accountability have different access, structure, and retention needs.
- Consequences: Correlation IDs cross outbox/queue boundaries; redaction tests are required. Audit history is not reconstructed from logs.
- Rejected: vendor-specific instrumentation throughout domain code; logging full payloads.

## ADR-020: Test pyramid includes real infrastructure and adapter contracts

- Status: accepted
- Decision: Use fast domain tests, PostgreSQL/queue integration tests, shared adapter contract suites, fake-provider end-to-end tests, narrow live-provider smoke tests, AI evaluations, accessibility tests, and security matrices.
- Rationale: The highest risks are boundaries, concurrency, and external uncertainty, which mocked unit tests alone cannot establish.
- Consequences: CI needs service containers and test fixtures. Live provider tests remain controlled and non-destructive.
- Rejected: snapshot-only testing, prose-exact AI assertions, live social posting on every pull request.

## ADR-021: Capability flags, feature flags, and publication kill switches

- Status: accepted
- Decision: Distinguish provider/account capabilities (facts discovered from integrations) from product feature flags (controlled rollout). Provide global and per-platform switches that stop new execution without deleting schedules.
- Rationale: App review, outages, policy shifts, and regressions require fast, honest containment.
- Consequences: Flags cannot bypass approval/authorization. Their changes are restricted and audited.
- Rejected: compiling provider availability into UI assumptions; emergency database edits as the normal kill mechanism.

## ADR-022: Retention is explicit and deletion is asynchronous

- Status: accepted
- Decision: Classify data, set bounded retention before beta, immediately block work/remove credentials on deletion, then asynchronously purge tenant content with auditable completion.
- Rationale: Immediate multi-store deletion is failure-prone; indefinite retention is unnecessary risk.
- Consequences: Product must explain deletion-pending/recovery behavior. Audit/security remnants are minimized and separately governed.
- Rejected: indefinite prompt/log retention, synchronous workspace cascade in an HTTP request.

## Open decisions before production beta

These are intentionally unresolved because no Product Owner or deployment constraints were supplied:

1. Cloud/region, managed PostgreSQL, Redis-compatible queue, object storage, KMS, and observability vendors.
2. Managed OIDC vendor and supported sign-in methods.
3. AI provider/model choices, regional processing, zero-retention terms, and workspace cost limits.
4. Exact data retention periods, recovery objectives, privacy jurisdictions, and terms/privacy copy.
5. Affiliate categories/markets initially allowed and required disclosure policy by jurisdiction.
6. Whether editor self-approval remains acceptable after beta.
7. TikTok app review/audit status and whether draft upload is permitted/desirable for initial users.
8. Threads app review status, exact approved permissions, and currently available insights.
9. Hosting domains and same-origin topology.
10. Beta scale targets and SLO/error-budget numbers.

None of these should be silently guessed in implementation. Tasks that depend on one must either resolve it explicitly or use a documented local/test abstraction that does not constrain the production choice.
