# Affiliate Content OS - Architecture Baseline

Status: Sprint 0 baseline, proposed for Product Owner approval

Last updated: 2026-10-05

## 1. Architecture goals

The system must preserve human control, tenant isolation, truthful external state, and safe recovery while remaining operable by a small team.

Quality priorities, in order:

1. Security, compliance, and prevention of unauthorized/duplicate posts.
2. Correct workflow state and auditable human approval.
3. Resilience to platform, queue, and AI-provider failures.
4. Maintainability and testability.
5. Delivery speed and cost efficiency.
6. Scale beyond demonstrated MVP demand.

## 2. System shape

Use a TypeScript modular monolith in a `pnpm` workspace. It is one product and one domain model, deployed as three process types from the same repository:

- `apps/web`: Next.js web UI and browser-facing rendering.
- `apps/api`: Node.js HTTP API using Fastify and explicit application modules.
- `apps/worker`: background worker using the same application/domain modules.

Shared code lives in packages with enforced dependency direction:

- `packages/domain`: entities, value objects, state machines, domain errors; no framework or persistence imports.
- `packages/application`: use cases and ports; depends on domain.
- `packages/infrastructure`: PostgreSQL repositories, queue, object storage, identity, AI, and social adapters; implements application ports.
- `packages/contracts`: transport schemas and generated/shared types; no business behavior.
- `packages/config`: environment schema and safe configuration loading.
- `packages/observability`: logging, tracing, metrics, and redaction.
- `packages/test-support`: factories, fakes, and integration harnesses; test-only.

This is a modular monolith, not microservices. Web, API, and worker may scale independently, but share releases and a database. Modules communicate in-process through application interfaces or asynchronously through a transactional outbox and queue.

## 3. Runtime topology

```text
Browser
  -> Web (SSR/UI)
       -> API (REST /api/v1)
            -> PostgreSQL (system of record + outbox + job state)
            -> Redis-compatible queue (delivery/wakeup, not source of truth)
            -> S3-compatible object storage (user media)
            -> Identity provider (OIDC)
            -> AI provider(s) through AI Gateway
            -> Threads/TikTok through SocialPlatformAdapter

Scheduler/Worker
  -> PostgreSQL (claim/revalidate/record)
  -> Queue
  -> object storage / AI / official social APIs
  -> observability backend
```

Production components are private by default. Only the web/API ingress and registered OAuth/webhook callbacks are public. PostgreSQL remains the source of truth if Redis is lost.

## 4. Module boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| Identity | app users and provider subject mapping | social OAuth credentials |
| Workspaces | tenancy, memberships, roles, settings | content workflow |
| Catalog | products, fact versions, affiliate destinations | scraping campaigns |
| Intelligence | product/niche/performance analyses, AI runs | direct publishing |
| Content | briefs, variants, revisions, compliance findings | remote tokens |
| Approval | submissions, decisions, immutable approval snapshot | draft generation |
| Media | metadata, upload lifecycle, scanning state | arbitrary remote fetching |
| Social Connections | accounts, OAuth lifecycle, capabilities | app sign-in |
| Publishing | schedules, attempts, remote posts, reconciliation | content mutation |
| Analytics | metric definitions and snapshots | conversion claims |
| Audit | append-only actor/action/resource records | operational debug logs |

Each module owns its tables and repositories. Cross-module reads use application query services rather than importing another module's repository. Database foreign keys may enforce integrity across modules; they do not authorize direct write coupling.

## 5. Frontend architecture

### Structure

- Next.js App Router with React Server Components for initial authenticated reads where useful.
- Client components only for interactive forms, previews, upload progress, scheduling controls, and live job updates.
- A generated or schema-derived typed API client consumes `/api/v1`; UI code never imports server repositories or domain internals.
- Server state uses a query cache only where client revalidation is needed. Local UI state remains local; do not create a global state store without a concrete need.
- Forms share schemas from `packages/contracts` for user feedback, while the API always revalidates independently.
- Route groups align to product areas: workspace, products, content, calendar/publishing, analytics, settings/connections.

### Rendering and security

- The web tier obtains an application session and sends an HttpOnly same-site cookie; browser code never receives social tokens.
- State-changing requests use same-origin enforcement and CSRF protection appropriate to the selected identity/session library.
- Content Security Policy uses nonces/hashes and restricts scripts, frames, connections, and media to required origins.
- Remote media is served through controlled, time-limited URLs or an image proxy with allowlists; no arbitrary URL passthrough.
- Optimistic UI is limited to reversible local changes. Approval, scheduling, connection, and publish state is confirmed by the API.
- Accessibility: semantic navigation, keyboard operation, visible focus, non-color status cues, labeled errors, and timezone-explicit date controls.

### State presentation

The UI displays content workflow state, each publication state, account capability health, and analytics freshness separately. It never compresses a partial multi-destination outcome into a single success badge.

## 6. Backend architecture

### Request path

1. Parse request and correlation ID.
2. Authenticate the application principal.
3. Resolve workspace from the URL and verify active membership.
4. Authorize action against role and resource ownership.
5. Validate the request contract.
6. Execute one application use case within an explicit transaction when needed.
7. Append audit/outbox records in the same transaction.
8. Map domain result/error to the API contract and emit telemetry.

Controllers remain thin. Domain rules live in domain state machines; orchestration lives in application use cases; external calls live behind ports in infrastructure.

### Transactions and consistency

- PostgreSQL transactions protect workflow invariants.
- Mutations use optimistic concurrency (`version` or strong ETag) for user-edited resources.
- The transactional outbox records asynchronous work atomically with state changes.
- Workers are at-least-once. Handlers must be idempotent and acquire a database lease/lock before side effects.
- External API calls never occur inside a long-held database transaction.
- External results are persisted with request correlation, attempt, and sanitized response metadata.

## 7. Database architecture

- PostgreSQL is the primary relational system of record.
- IDs are application-generated UUIDv7 values to avoid enumeration and improve index locality.
- All tenant-owned rows include `workspace_id`; repository APIs require workspace context.
- Timestamps are `timestamptz` in UTC. User timezone is an IANA identifier stored on workspace/schedule context.
- Mutable aggregates have a monotonic `version` and `updated_at`.
- Flexible provider payload fragments may use `jsonb`, but core queryable state, permissions, relationships, money, times, and workflow states use typed columns.
- Secrets are never stored in general JSON. OAuth credentials use envelope encryption and are isolated from ordinary account queries.
- Migrations are forward-only, reviewed, and applied separately from process startup. Destructive schema changes use expand/migrate/contract.
- Backups, point-in-time recovery, restore drills, retention, and deletion are production requirements.

The canonical logical schema and invariants are in `docs/DATABASE.md`.

## 8. AI architecture

### AI Gateway

All model calls pass through an application-owned AI Gateway with these ports:

- `generateProductAnalysis`
- `generateNicheAnalysis`
- `generateContentVariants`
- `analyzePerformance`

The gateway owns provider selection, model configuration, timeouts, retries, structured-output validation, token/cost budgets, redaction, and telemetry. Domain modules consume typed results and do not import a vendor SDK.

### Grounding and provenance

- Inputs are an explicit context package: confirmed product fact version, selected analysis versions, workspace voice, channel constraints, compliance policy, and user brief.
- External/fetched text is delimited and treated as untrusted data, never as instructions.
- Outputs must match versioned schemas and include evidence references to context item IDs where claims or observations are made.
- Unsupported or uncertain claims are labeled. Deterministic validation follows model validation.
- Store prompt template/version, model/provider identifier, input/output hashes, token usage, latency, finish status, and safety outcome. Store full prompts/outputs only under the product retention policy and never include OAuth tokens or secrets.
- A content revision records which AI run helped create it, but becomes human-owned editable content.

### Human control and failure policy

- AI cannot approve, schedule, connect accounts, or publish.
- Performance recommendations are hypotheses linked to a metric window, not causal claims.
- Invalid structured output may receive one bounded repair attempt; persistent failure returns a typed error.
- Transient provider failures use bounded exponential backoff. User-triggered duplicate generation requires an idempotency key.
- Model changes are configuration releases with offline golden-set evaluation and canary monitoring.

## 9. SocialPlatformAdapter architecture

Application code depends on a versioned interface, not provider endpoints:

```ts
interface SocialPlatformAdapter {
  platform: "threads" | "tiktok";
  getCapabilities(connection): Promise<AccountCapabilities>;
  validatePublication(input, capabilities): Promise<ValidationResult>;
  publish(input, attemptContext): Promise<PublishResult>;
  getPublishStatus(remoteReference): Promise<RemotePublishStatus>;
  fetchMetricSnapshot(remotePost, window): Promise<MetricSnapshot>;
  revokeConnection?(connection): Promise<void>;
}
```

OAuth authorization URL creation, callback exchange, and refresh are provider-specific implementations of a separate `SocialAuthAdapter`. This separation prevents a publish worker from owning browser callback concerns.

Normalized results include:

- capability set and expiry/freshness;
- remote operation/post ID and permalink when available;
- `confirmed`, `processing`, `requires_user_action`, `rejected`, `rate_limited`, `transient_failure`, `permanent_failure`, or `unknown`;
- retry eligibility and provider retry-after value;
- sanitized provider error code and correlation ID.

Adapters must:

- use official documented APIs only;
- pin/test an API version where the provider supports it;
- keep provider payloads and changing limits inside the adapter;
- enforce least-privilege scopes and capability discovery;
- never log credentials, signed upload URLs, or full sensitive payloads;
- use explicit connect/read/publish timeouts;
- classify errors, respect retry/rate-limit headers, and expose circuit-breaker health;
- implement contract tests using fixtures and a provider sandbox/test account when available.

## 10. Threads integration boundary

The Threads adapter owns official Threads API details: OAuth/scopes, long-lived token handling where applicable, publishing container creation, media readiness/status polling, final publication, post lookup, insights mapping, rate limits, and provider error classification.

MVP boundary:

- Connect a user's own eligible Threads account using official authorization.
- Request only identity/basic access, content publishing, and insights capabilities needed by enabled features.
- Publish an approved text or single-media variant when the account and API support it.
- Poll asynchronous media/container state before final publish where required.
- Synchronize only official metrics granted to the app/account.
- Replies, moderation, mentions, search, follower automation, and engagement automation are out of scope.

Implementation must verify exact current Meta permissions, review requirements, API versions, media constraints, and metric availability against official documentation before release. Those values are configuration/capability data, not hard-coded product promises.

## 11. TikTok integration boundary

The TikTok adapter owns Login Kit/OAuth, token refresh, creator capability query, Content Posting API media transfer, post-status polling, Display API reads where authorized, platform labels/settings, rate limits, and provider error classification.

MVP boundary:

- User-provided video only; supported photo publishing is deferred despite API availability.
- Direct Post requires app approval and user grant for the publishing scope; release to public visibility is gated on TikTok's required audit/review.
- Before transfer, obtain current creator information/options and preserve the user's explicit privacy, interaction, commercial-content, and AI-generated-content choices.
- Record express user consent to the final preview and transfer. Revalidate settings at execution; do not silently substitute an unavailable privacy option.
- Use verified-domain pull only when configured and eligible; otherwise use the official upload flow with short-lived upload URLs.
- Poll post status before declaring publication.
- When Direct Post is unavailable, use an approved official draft-upload/user-completion flow if its scope and UX requirements are satisfied; otherwise generate a manual handoff package and never claim publication.
- Respect TikTok's anti-spam caps, creator posting limits, media rules, and watermark/content-sharing guidelines.

Follower automation, comments, DMs, trend scraping, research APIs, arbitrary public-video analytics, and bypassing audit restrictions are out of scope.

## 12. Scheduler and queue architecture

### Durable scheduling

- A `publications` row is the source of truth for each revision/account destination and its `scheduled_for` UTC timestamp.
- A scheduler loop uses a PostgreSQL advisory lock so only one active leader scans due work per shard/window.
- It atomically claims due rows with `FOR UPDATE SKIP LOCKED`, transitions them to queued, and writes outbox events.
- An outbox dispatcher delivers queue messages and marks delivery; duplicate messages are expected.
- The queue provides wakeup, retry delay, and horizontal worker distribution, not canonical status.

### Execution

1. Worker claims a publication lease and checks terminal state.
2. Revalidate immutable approval, account connection/scopes, capabilities, compliance snapshot, media readiness, and scheduled cancellation/version.
3. Create a `publish_attempt` with a stable internal idempotency key before the external call.
4. Call the adapter outside the transaction.
5. Record normalized result and move to a valid next state.
6. If outcome is uncertain, enter `outcome_unknown` and enqueue reconciliation, not a blind republish.

Retries use exponential backoff with jitter and honor provider `Retry-After`. A maximum attempt count and time horizon route exhausted work to a dead-letter view for operator action. Permanent validation, permission, or policy errors do not retry. Token refresh uses a per-connection lock to prevent refresh races.

Cancellation is accepted only before an execution lease begins. Once the external request may have been sent, cancellation cannot assert remote cancellation; the outcome must be reconciled.

## 13. Analytics architecture

- Analytics collectors operate only on confirmed remote posts and authorized metrics.
- Metric names map to a small canonical vocabulary only when semantics truly match; otherwise retain a platform-qualified metric key.
- Raw numeric snapshots are append-only and include platform timestamp/window, collection time, source, and schema version.
- Derived deltas and rates are calculated in queries/materialized summaries and can be rebuilt.
- Cadence is freshness-aware: more frequent soon after publication, then taper, stop after the configured horizon, and honor rate budgets.
- Backfills are bounded and separately rate-limited.
- UI shows the platform, collection timestamp, unavailable metrics, and semantic caveats.
- Performance AI receives an immutable metric snapshot set plus content/product context. It cannot infer clicks, conversions, or revenue absent those data.

MVP uses PostgreSQL for analytical queries. A warehouse is deferred until measured data volume or query workload justifies it.

## 14. Authentication and authorization

### Application identity

- Use a managed OIDC provider and Authorization Code flow with PKCE where applicable.
- API sessions use secure, HttpOnly, same-site cookies with rotation and short idle lifetime; production requires HTTPS.
- Identity provider subject is the stable external key. Email alone is not authorization identity.
- App login and social-account authorization are distinct; connecting TikTok does not sign a user into Affiliate Content OS.

### Authorization

- Every tenant route includes `workspace_id`; the server resolves active membership on each request or from a short-lived cache invalidated by membership changes.
- Role matrix is defined in `docs/PRODUCT.md`. Use cases enforce permissions; UI hiding is convenience only.
- Repository queries include workspace scope as defense in depth. Selected high-risk tables may add PostgreSQL row-level security after operational validation; application checks remain mandatory.
- Workers carry explicit workspace and initiating-actor/system context and use the same authorization invariants where relevant.
- Privileged changes and impersonation (if ever added) require audit events; impersonation is not in MVP.

## 15. Security model

Primary threats: cross-tenant access, social-token theft, unauthorized or duplicate publishing, OAuth CSRF/account confusion, stored XSS in generated content, SSRF via product/media URLs, malicious uploads, prompt injection/data exfiltration, dependency compromise, and sensitive-data leakage through logs.

Controls:

- Tenant-scoped access checks at route, use-case, and repository boundaries; automated isolation tests.
- OAuth `state`, PKCE where supported, exact redirect allowlists, one-time callback records, account identity confirmation, and server-side token exchange.
- Envelope-encrypted social credentials using a cloud KMS; key version stored with ciphertext; decrypt only in the worker/API path that needs it.
- Secrets in a managed secret store, validated configuration, rotation runbooks, and no secrets in source or client bundles.
- Strict output escaping/sanitization, CSP, secure cookies, CSRF defenses, and dependency scanning.
- URL parsing, DNS/IP checks, redirect limits, egress allowlists/proxy, size/time limits, and no fetches to private/link-local ranges.
- Direct-to-object-store uploads with signed constraints, MIME/signature validation, virus scanning, quarantine, and media limits before use.
- AI input delimiting, secret exclusion, output schema validation, content policy checks, and provider data-retention configuration.
- Rate limits by principal/workspace/IP and tighter limits for AI generation, OAuth, uploads, and publication mutations.
- Signed webhook verification and replay protection if a provider integration uses webhooks.
- Encrypted transport and storage, least-privilege service identities, private database/cache networking, backups, and restore testing.
- Audit logs exclude secret values and full content unless required; application logs use structured redaction.

Security-sensitive failures fail closed. A platform or compliance check that cannot complete does not publish.

## 16. Compliance architecture

Compliance combines deterministic policy checks, platform capability validation, user attestations, and an auditable decision. AI may suggest warnings but cannot be the sole blocking control.

- A versioned `CompliancePolicy` defines required disclosure patterns, prohibited claims/terms, regulated-category flags, and platform rules.
- A compliance evaluation stores policy version, findings, severity, evidence location, and resolution/override actor.
- Blocking findings prevent approval. Any authorized override policy must be explicit, narrowly scoped, and audited; MVP has no override for platform-blocking rules.
- Approval snapshot includes compliance evaluation, disclosure, labels, and attestations.
- Publish-time validation checks current adapter capabilities and platform-required settings again.
- Privacy inventory maps each data category to purpose, lawful basis/consent where applicable, processor, retention, export, and deletion behavior.
- Data minimization is default: do not ingest audiences, private messages, contacts, or unrelated profile data.

## 17. Error-handling strategy

Errors use stable categories:

- `validation`: request can be corrected; no retry.
- `authentication`: sign-in/session invalid; reauthenticate.
- `authorization`: action forbidden; no information leakage.
- `conflict`: stale version, invalid state transition, or already scheduled.
- `rate_limited`: retry after specified time.
- `transient_dependency`: bounded retry permitted.
- `permanent_dependency`: reconnect/change content/contact support.
- `outcome_unknown`: reconcile before retry.
- `internal`: unexpected; opaque user message plus correlation ID.

REST errors follow Problem Details and never return secrets, raw provider bodies, stack traces, or model prompts. Domain errors are typed and centrally mapped. UI messages state what happened, what is safe, and what the user can do. Background failures persist structured status and sanitized provider codes, emit telemetry, and surface in an operator/user view as appropriate.

## 18. Observability

- OpenTelemetry traces across web request, API use case, outbox, queue, worker, AI call, and platform call using correlation/causation IDs.
- Structured JSON logs with environment, release, workspace hash/ID where policy permits, job/attempt ID, provider, outcome, and redaction.
- Metrics: request/error latency, authorization denials, queue depth/age, scheduler lag, outbox lag, job retries, publication success/failure/unknown, token refresh failures, platform rate limiting, analytics freshness, AI latency/token/cost/schema failures, and database pool/lock health.
- SLO candidates: API availability/latency, scheduler timeliness, no duplicate confirmed publications, analytics freshness, and background-job success.
- Alerts favor user impact and sustained burn rate. Runbooks cover provider outage, queue loss, expired credentials, stuck/outcome-unknown publication, migration failure, and secret compromise.
- Audit events are product records; logs/traces are operational records. They have separate access and retention.

## 19. Testing strategy

- Domain unit tests: state transitions, approval invalidation, permissions, timezone conversion, retry classification, and metric semantics.
- Contract/schema tests: request/response compatibility and generated API client.
- Repository integration tests against real PostgreSQL, including tenant isolation, constraints, locks, leases, and migrations.
- Queue/worker integration tests for duplicates, retry, cancellation races, token-refresh races, and outbox recovery.
- Adapter contract tests shared across fake, Threads, and TikTok implementations; recorded sanitized fixtures plus provider sandbox/test-account smoke tests.
- AI tests: schema validation, prompt-injection corpus, prohibited/unsupported claims, deterministic validators, golden evaluation sets, and provider failure simulation. Do not assert prose exactness.
- Frontend component/accessibility tests and critical browser journeys.
- End-to-end tests for core loop using fake AI/social adapters; narrowly scoped live-provider tests are non-destructive and never run on every pull request.
- Security tests: cross-tenant matrix, IDOR, CSRF/OAuth state replay, SSRF, upload validation, XSS, secret/log scanning, dependency and container scans.
- Migration and backup-restore tests before production release.
- Load tests focus on schedule bursts, worker backpressure, and rate-limit behavior rather than vanity throughput.

Pull requests require formatting, lint, typecheck, unit tests, affected integration tests, migration validation, and build. Releases require E2E, security gates, and manual checks for provider contract changes.

## 20. Deployment and environments

- Environments: local, test/CI, staging, production. Each has isolated databases, buckets, queues, identity clients, provider apps/accounts, and keys.
- Infrastructure is defined as code once a provider is selected; provider selection is deferred by decision record.
- Build immutable artifacts once and promote them; configuration changes by environment.
- API/worker use backward-compatible expand/migrate/contract deployments.
- Feature flags gate platform adapters, AI model changes, and risky workflows. A kill switch prevents new publications globally or per platform without corrupting scheduled state.
- No production data is copied to lower environments without approved anonymization.

## 21. Architecture fitness rules

Architecture review rejects changes that:

- allow publishing without an immutable human approval snapshot;
- leak provider SDK types outside infrastructure adapters;
- treat queue delivery as canonical state;
- retry an uncertain publish blindly;
- omit workspace scope from tenant data access;
- store tokens unencrypted or expose them to the browser;
- allow AI to approve or publish;
- claim normalized metrics have equivalent meaning without evidence;
- add distributed infrastructure before measured need and an approved decision record.
