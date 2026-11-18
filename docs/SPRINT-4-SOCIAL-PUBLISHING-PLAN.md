# Sprint 4 — Social Connections and Publishing Plan

Status: In progress; Product Owner approved on 2026-11-18. Checkpoint A was
completed and approved by Codex on 2026-11-18 (`STATUS: APPROVED`).

## 1. Outcome

Sprint 4 extends the approved Sprint 3 content package into a human-controlled,
auditable publication workflow for Threads. A creator can connect an owned
account through official OAuth, bind an approved immutable revision to that
destination, schedule it, and observe one durable publication execution or a
truthful gated/manual outcome.

The implementation remains a modular monolith. PostgreSQL is authoritative for
OAuth transactions, account state, credentials, capabilities, schedules,
attempts, reconciliation, and audit evidence.

## 2. Product-owner requirements

- The interface must be easy to read and observe, with plain states and clear
  next actions.
- Publishing must remain human-approved. AI cannot connect accounts, approve,
  schedule, or publish.
- Only official platform APIs are permitted. No browser automation, private
  endpoints, engagement automation, moderation bypass, or fabricated success.
- Long implementation work is delegated to Antigravity and reviewed by Codex
  against actual code, migrations, tests, and diffs.
- Tokens stay server-side, encrypted, narrowly accessible, and absent from
  browser payloads, logs, audit metadata, queues, and errors.

## 3. Checkpoints

### Checkpoint A — Social connection foundation (`TASK-016`)

Status: Complete and Codex-approved on 2026-11-18 after
`TASK-016-REMEDIATION-01`, `TASK-016-REMEDIATION-02`, and
`TASK-016-REMEDIATION-03`.

- Domain/application adapter contracts and account/capability states.
- Forward-only persistence for social accounts, isolated encrypted
  credentials, and one-time OAuth transactions.
- Owner-only authorize/callback/list flows with a deterministic fake adapter.
- Connection settings UI, safe configuration, audit, tenant isolation,
  idempotency, and adversarial OAuth tests.
- No real platform publishing.

### Checkpoint B — Threads account lifecycle (`TASK-017`)

- Official Threads OAuth/token/identity adapter behind the Checkpoint A ports.
- Capability discovery and freshness, reconnect, refresh, disconnect/revoke,
  credential rotation, degraded/reauth/review-gated states, and kill switch.
- Contract tests use sanitized fixtures and mocked provider transport. Live
  smoke tests remain explicit, non-destructive, and opt-in.
- Provider API version, URLs, scopes, app-review status, and granted
  capabilities are configuration/runtime facts rather than permanent domain
  promises.

### Checkpoint C — Durable scheduling and publication core (`TASK-018`)

- Destination-bound publication approval/consent snapshot derived from an
  accepted Sprint 3 content approval.
- Publications, append-only attempts, consent evidence, schedule/reschedule/
  cancel/read APIs, PostgreSQL leases, outbox-compatible execution, bounded
  retries, idempotency, and a deterministic fake publication adapter.
- Revalidation at execution time: approval, exact revision/hash, destination,
  connection health, capability freshness, disclosure/settings, kill switch,
  and consent.
- No external post is called inside an HTTP transaction.

### Checkpoint D — Threads publication, reconciliation, UX, and release (`TASK-019`)

- Official Threads text publication and one supported user-provided media mode
  only when current account capabilities permit it.
- Stable attempt identity before provider calls, remote processing/status
  polling, safe failure classification, rate-limit deferral, and reconciliation
  for uncertain outcomes. Blind retry of `outcome_unknown` is forbidden.
- Accessible Connections and Calendar/List experiences with honest partial,
  gated, stale, retryable, and terminal states.
- Browser E2E through fake adapters, adapter contract tests, PostgreSQL
  concurrency/recovery tests, threat review, operations runbook, and final
  Sprint 4 release evidence.

## 4. Cross-cutting invariants

1. All customer data and joins are workspace-scoped; cross-tenant identifiers
   fail closed without leaking existence.
2. Social OAuth is distinct from application OIDC and never authenticates an
   Affiliate Content OS user.
3. OAuth state is high entropy, short-lived, stored hashed where possible,
   bound to the initiating workspace/user/platform/redirect, and consumed once.
4. Credentials use authenticated encryption with key versioning and
   resource-bound additional authenticated data. Production requires an
   external managed key integration; the local key mechanism is explicitly
   non-production.
5. Approval and consent snapshots are immutable and bind exact content,
   destination, settings, capability version/freshness, actor, and time.
6. A scheduler stores UTC plus the original local value and IANA timezone and
   rejects ambiguous/nonexistent local times unless the API contract provides
   an explicit unambiguous choice.
7. Publication is at-least-once internally but must not create duplicate remote
   posts. Stable attempts, leases, compare-and-swap, adapter idempotency where
   available, and reconciliation protect the boundary.
8. `published` requires a confirmed remote post identifier. Request acceptance,
   a container ID, timeout, or local job completion is not publication success.
9. Provider payloads, SDK types, endpoint details, limits, and error codes stay
   inside infrastructure adapters.
10. Feature flags and global/per-platform kill switches may stop new work but
    never bypass authorization, approval, consent, or audit requirements.

## 5. Explicit boundaries

- TikTok Direct Post, TikTok media validation/transfer, and TikTok release audit
  remain Sprint 5.
- Analytics synchronization and the AI learning loop remain Sprint 6.
- Production media generation/editing, autonomous approval/publishing,
  engagement automation, account farming, scraping, and unofficial APIs are
  out of scope.
- No microservices, Kafka, Kubernetes, CQRS, event sourcing, or second database.

## 6. Release definition

Sprint 4 is complete only when Checkpoints A–D are individually approved by
Codex, all repository quality gates pass, migrations validate twice, PostgreSQL
integration and browser E2E evidence pass, and the fake-adapter flow proves:

`accepted revision -> connected account -> destination approval/consent ->`
`schedule -> one worker execution -> confirmed post or truthful gated outcome`

Real Threads release remains feature-gated until the deployment has valid app
credentials, required Meta review/access, verified redirect URIs, and a
non-destructive live smoke test.
