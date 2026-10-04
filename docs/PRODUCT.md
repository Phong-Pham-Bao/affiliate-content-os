# Affiliate Content OS - Product Specification

Status: Sprint 0 baseline, proposed for Product Owner approval

Last updated: 2026-10-05

## 1. Product vision

Affiliate Content OS helps a legitimate creator or small content team turn an affiliate product into compliant, approved, scheduled social content and learn from the resulting performance.

The product loop is:

`Product -> Product Analysis -> Niche Analysis -> Content Generation -> Human Approval -> Scheduling -> Publishing -> Analytics -> AI Performance Analysis -> Better Content`

The product is a decision-support and publishing workflow, not a fully autonomous growth bot. A human remains accountable for claims, disclosures, creative quality, account selection, and every publish decision.

## 2. Target user and problem

### Primary user

An affiliate creator or small creator-led team that manages a modest catalog and publishes to its own authorized social accounts.

### Jobs to be done

- Capture reliable product facts and the creator's affiliate destination.
- Understand the product, audience, niche, positioning, risks, and content angles.
- Generate channel-specific drafts grounded in known facts.
- Review, edit, disclose, approve, schedule, and publish without losing control.
- See normalized post performance and understand which choices worked.
- Turn evidence into recommendations and a better next draft.

### Success definition

The MVP succeeds when a user can complete the full loop for at least one supported platform without copying workflow state between tools, while preserving human approval and a trustworthy audit trail.

Initial product metrics:

- Time from product creation to first approved content.
- Approval rate and average revision count.
- Scheduled publication success rate, excluding platform-declared rejection.
- Percentage of published posts with analytics synchronized.
- Percentage of AI recommendations accepted or used in a later draft.
- Compliance-warning resolution rate before approval.

Engagement and affiliate conversion are outcomes to optimize, not reliability metrics. Revenue attribution is not claimed unless verified first-party conversion data is later integrated.

## 3. MVP scope

### Account and workspace

- Application sign-in through a managed identity provider.
- One or more workspaces with `owner`, `editor`, and `viewer` membership roles.
- Workspace settings for timezone, brand voice, default disclosure text, and AI usage.
- Connection and disconnection of the user's own supported social accounts through official OAuth flows.

### Product and niche intelligence

- Manual creation and editing of a product record: name, merchant, canonical URL, category, description, factual attributes, allowed claims, prohibited claims, audience notes, and affiliate URL.
- Safe metadata assistance for an explicitly supplied public URL only where permitted; fetched data is untrusted and never silently promoted to an approved fact.
- Versioned product analysis covering summary, benefits, differentiators, evidence gaps, claim risks, objections, and content angles.
- Versioned niche analysis covering target audience, pains, intent, themes, competitive positioning, seasonality notes, and risks.
- User review of analysis inputs and outputs before content generation.

### Content workflow

- Generate multiple text/caption concepts from an approved product fact set and selected analyses.
- Create platform-specific variants for Threads and TikTok.
- Attach user-provided media assets. MVP does not generate production video or images.
- Compliance linting for missing affiliate disclosure, unsupported claims, prohibited terms, channel limits, and required AI-content labels.
- Draft editing, revision history, preview, submit for approval, approve, or reject with a reason.
- Approval binds to an immutable content revision, exact social account, disclosure/label settings, and intended schedule. A material edit invalidates approval.

### Scheduling and publishing

- Schedule an approved variant in the workspace timezone, persisted as UTC.
- Publish only through official APIs and only where the app and user possess required permissions.
- Capability-aware behavior: direct publish, upload-as-draft/manual completion, or manual handoff.
- Cancel or reschedule before the publication enters execution.
- Clear states for queued, in progress, published, failed, rejected, canceled, and outcome unknown.
- Retry only errors known to be safe to retry; reconcile uncertain outcomes before another publish attempt.

### Analytics and learning

- Store platform post identifiers and permalinks after confirmed publication.
- Periodically synchronize metrics exposed by authorized official APIs.
- Show raw platform metrics, latest values, and simple deltas; do not imply identical semantics across platforms.
- AI performance analysis grounded in content, product/niche context, and observed metrics.
- Evidence-linked recommendations that a user can accept as input to a new draft. Recommendations never edit approved or scheduled content automatically.

### Initial supported content

- Threads: text posts and a single supported user-provided media attachment when official account capabilities allow it.
- TikTok: a user-provided compliant video plus caption and platform-required settings. Direct Post is release-gated by TikTok review/audit and current account capabilities; draft upload or manual handoff is the fallback.

Exact media constraints, metrics, scopes, and visibility choices are adapter-owned capabilities because platform contracts change.

## 4. Non-goals for MVP

- Scraping merchants, social networks, competitors, or private data at scale.
- Automatic creation or cloaking of affiliate links.
- Affiliate-network sales or conversion attribution.
- Automated product purchasing, inventory, or pricing synchronization.
- Autonomous approval, autonomous publishing without recorded user approval, or automatic rewriting of scheduled content.
- Engagement automation, follow/unfollow, comments, direct messages, account farming, or fake engagement.
- Cross-posting identical content without a platform-specific reviewable variant.
- Social listening, competitor surveillance, trend scraping, or claims of real-time niche intelligence.
- Image or video generation/editing pipeline.
- Multi-step campaigns, A/B test automation, content recycling, or evergreen queues.
- Mobile apps or browser extensions.
- Billing, subscriptions, agency client billing, or enterprise SSO.
- Custom roles, field-level permissions, or external guest approval.
- More platforms than Threads and TikTok.
- A public API, plugin marketplace, microservices, or customer-authored automation rules.
- Legal, tax, medical, or financial advice; the system assists with compliance but does not certify legality.

## 5. Roles and authorization summary

| Capability | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Manage workspace and members | Yes | No | No |
| Connect/disconnect social accounts | Yes | No | No |
| Manage products and analyses | Yes | Yes | Read |
| Generate/edit content | Yes | Yes | Read |
| Submit/reject/approve content | Yes | Yes | Read |
| Schedule/cancel publications | Yes | Yes | Read |
| View analytics and audit history | Yes | Yes | Yes |
| Delete workspace or export data | Yes | No | No |

For MVP, editors may approve their own drafts. Separation-of-duties approval is a post-MVP policy option. Sensitive operations require recent authentication where supported.

## 6. Core user flows

### 6.1 Onboard and connect a platform

1. User signs in and creates or joins a workspace.
2. Owner configures timezone, brand context, and default disclosures.
3. Owner selects Threads or TikTok and is shown requested capabilities and data use.
4. Server starts official OAuth with anti-forgery protections.
5. Callback is validated; tokens remain server-side and are encrypted.
6. The adapter discovers account identity, scopes, and current capabilities.
7. UI reports what is available: publish, draft handoff, analytics, or reconnect required.

Failure outcome: no partial account is shown as active. The user receives a recoverable status such as denied, expired, missing scope, review-gated, or temporarily unavailable.

### 6.2 Add and analyze a product

1. Editor enters product facts, source URL, affiliate URL, allowed claims, and exclusions.
2. The system validates URLs and marks each fact as user-entered or externally suggested.
3. Editor confirms the fact set used for generation.
4. Editor requests product analysis and niche analysis.
5. AI returns schema-validated, versioned analyses with evidence references and uncertainty.
6. Editor corrects or accepts the analyses for use in content generation.

### 6.3 Generate, review, and approve

1. Editor selects a product, analysis versions, target platform/account, goal, and tone.
2. AI produces structured draft variants, not a publish action.
3. System runs deterministic channel and compliance checks.
4. Editor edits copy, attaches media, selects disclosures/labels, and previews the variant.
5. Editor submits a specific revision for approval.
6. An authorized approver approves or rejects it with an optional note.
7. Approval snapshot records the exact revision, destination account, settings, actor, and timestamp.

Any later material change creates a revision and returns the item to draft or pending approval.

### 6.4 Schedule and publish

1. Editor selects an approved revision and a future local date/time.
2. Server converts to UTC, validates daylight-saving ambiguity, account health, platform capability, and conflicts.
3. Scheduler creates one durable publication per platform/account destination.
4. Near execution, worker revalidates approval, token/scopes, creator/account capabilities, media, disclosure, and platform settings.
5. Adapter publishes, uploads for user completion, or stops with a clear gated status.
6. The system records every attempt and confirms the remote post before declaring `published`.
7. User sees permalink/status or actionable failure details.

### 6.5 Measure and improve

1. Analytics jobs synchronize metrics for confirmed posts on a bounded cadence.
2. Dashboard shows per-post platform-native metrics and time-series changes.
3. User requests or reviews an AI performance analysis.
4. Analysis separates observations from hypotheses and cites the metric snapshot window.
5. User accepts selected recommendations into a new generation brief.
6. A new draft starts a new approval cycle.

### 6.6 Disconnect or delete

1. Owner disconnects an account or requests workspace deletion.
2. New jobs are prevented immediately; pending publications for that account are canceled.
3. The system attempts official token revocation where supported, then deletes local credentials.
4. Retention/deletion work is recorded. Immutable security/audit records retain only the minimum required by policy.

## 7. Product state rules

- A draft is never publishable.
- Only a specifically approved immutable revision can be scheduled.
- Approval is invalid if content, media, disclosure, AI label, platform settings, or destination account changes.
- A schedule owns its execution state; content records do not pretend one global status applies to every destination.
- `published` means the remote platform accepted and identified the post, not merely that a request was sent.
- `outcome_unknown` prevents automatic duplicate publishing until reconciliation or explicit human resolution.
- Analytics are attached only to a confirmed remote post.
- AI recommendations produce new inputs or drafts and never mutate historical records.

## 8. Compliance requirements

- The user must be able to enter conspicuous disclosure text appropriate to their jurisdiction and platform; a configurable warning blocks approval when required disclosure is absent.
- Product claims must be grounded in the confirmed product fact set. Missing evidence is surfaced, not invented.
- Regulated and high-risk claims receive warnings and may be workspace-blocked; MVP does not certify claims.
- Platform-required paid-partnership, commercial-content, privacy, interaction, and AI-generated-content settings must be represented explicitly and passed without silent defaults where the platform requires user choice.
- The final preview must show caption/text, media, disclosure, labels, destination, and visibility as close as the official API permits.
- User consent to the publish configuration is timestamped. TikTok transfer starts only after explicit consent and capability validation.
- Watermarks or promotional overlays forbidden by a platform must be rejected where detectable and covered by user attestation otherwise.
- OAuth scopes follow least privilege and are explained before connection.
- Account disconnection, data export, correction, and deletion workflows are supported.
- Every approval, schedule change, publish attempt, credential lifecycle event, and privileged action is auditable.
- Platform terms and capability rules must be revalidated before an adapter is released and periodically thereafter.

## 9. UX principles

- Show source, freshness, uncertainty, and ownership of important data.
- Keep AI suggestions visibly distinct from confirmed facts and human decisions.
- Use plain state names with next actions; never hide platform rejection behind generic success.
- Preview before approval and reconfirm when platform-required choices have changed.
- Preserve history rather than overwriting it.
- Default to safe, private, and least-permissive settings when a platform allows a default; require explicit choice when platform rules require it.
- Accessibility target: WCAG 2.2 AA for core workflows.

## 10. MVP acceptance outcomes

Sprint-level implementation is complete only when the integrated product can demonstrate:

1. A workspace-scoped user creates a product and confirmed fact set.
2. The user obtains versioned product and niche analyses.
3. The user generates, edits, validates, and approves a platform-specific revision.
4. The user schedules it and the system executes exactly one safe publication workflow through a capability-enabled adapter or clearly returns a manual/gated outcome.
5. A confirmed remote post receives platform-native metric snapshots.
6. AI creates an evidence-linked performance analysis and a human elects whether to use its recommendations.
7. Tenant isolation, approval invariants, idempotency, audit history, and failure recovery are covered by automated tests.

## 11. Development roadmap

### Sprint 0 - Specification and architecture

- Approve product scope, architecture, database model, API contract, and decisions.
- Produce the first implementation task; no application code.

### Sprint 1 - Foundation

- Establish the TypeScript workspace, quality gates, web/API/worker process shells, configuration validation, local infrastructure, and CI.
- Add authentication, workspace tenancy, role authorization, and audit primitives.

### Sprint 2 - Products and intelligence

- Product CRUD, fact provenance, affiliate URL handling, media metadata.
- AI gateway, prompt/schema versioning, product analysis, niche analysis, and usage records.

### Sprint 3 - Content and approval

- Content briefs, variants, immutable revisions, compliance linting, approval state machine, preview, and audit history.

### Sprint 4 - Social connections and publishing

- OAuth lifecycle, capability discovery, adapter contract, sandbox/mock adapter, Threads adapter, scheduler, durable worker, publish reconciliation.
- TikTok adapter remains feature-gated until platform audit and release requirements are satisfied.

### Sprint 5 - TikTok and media hardening

- User-provided video validation, TikTok creator-info/consent flow, direct-post or draft-handoff modes, and platform-specific integration tests.

### Sprint 6 - Analytics and learning loop

- Metrics synchronization and dashboards, AI performance analysis, recommendation acceptance, and next-draft traceability.

### Sprint 7 - Production readiness

- Accessibility, security review, threat-model closure, load/recovery tests, retention/deletion jobs, operational runbooks, platform compliance review, and controlled beta.

Roadmap order may change only through an explicit decision record and Product Owner approval when it affects scope.
