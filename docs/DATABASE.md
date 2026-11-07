# Affiliate Content OS - Database Specification

Status: Sprint 3 Checkpoint A implemented through migration `0008_ai_workforce_foundation.sql`

Last updated: 2026-11-07

## 1. Conventions

- Database: PostgreSQL.
- Names: `snake_case`, plural table names, singular foreign-key prefixes.
- Primary keys: application-generated UUIDv7 in `id uuid`.
- Tenant data: every tenant-owned table has `workspace_id uuid not null`, even when derivable through another relation.
- Time: `timestamptz` UTC; workspace timezones use IANA names such as `Asia/Ho_Chi_Minh`.
- Mutable aggregates: `created_at`, `updated_at`, and `version bigint not null default 1`.
- Actor references may be nullable only for documented system actions; an accompanying actor type is required.
- Workflow enums are PostgreSQL check constraints or lookup-safe text values. Application enums must not be the only enforcement.
- Money, percentages, counts, and timestamps use typed columns, never floats or opaque JSON.
- `jsonb` is reserved for versioned provider details, structured AI artifacts, and non-query-critical snapshots.
- Secrets and tokens never appear in ordinary JSON or audit payloads.
- User-facing deletion generally uses tombstone/status plus asynchronous purge; immutable audit/security records follow the retention policy.

The exact Sprint 2 DDL is implemented by migrations `0001` through `0007`; this document also retains the approved later-sprint logical model.

### Sprint 2 intelligence durability

Migration `0007_intelligence.sql` adds `workspace_ai_policies`, `operations`, `ai_runs`, `analyses`, `analysis_subjects`, `job_executions`, and `outbox_events`. Existing workspaces are backfilled with a safe policy; new workspace creation provisions its policy in the same transaction.

Analysis content is immutable except for the bounded human-review fields. Tenant relationships use composite keys where applicable. Durable jobs store safe IDs, versions, attempt/repair counters, leases, scheduling metadata, and sanitized categories—not prompts, provider responses, or credentials. Budget reservation/settlement, operation/AI-run/job terminal state, analysis insertion, and audit events are transactionally coordinated.

## 2. Identity and tenancy

### `users`

| Column | Notes |
| --- | --- |
| `id` | PK |
| `identity_provider` | OIDC issuer/provider key |
| `identity_subject` | Stable provider subject |
| `email` | Display/contact, not authorization identity |
| `display_name` | Nullable |
| `status` | `active`, `disabled`, `deletion_pending` |
| timestamps/version | Standard fields |

Constraints: unique (`identity_provider`, `identity_subject`). Normalize email for lookup only; do not merge identities by email automatically.

### `workspaces`

`id`, `name`, `slug`, `timezone`, `brand_voice`, `default_disclosure`, `ai_enabled`, `status`, standard fields.

Constraints: unique normalized `slug`; valid IANA timezone at application boundary; `status` is `active`, `suspended`, or `deletion_pending`.

### `workspace_memberships`

`id`, `workspace_id`, `user_id`, `role`, `status`, `invited_by_user_id`, `joined_at`, standard fields.

Constraints: unique (`workspace_id`, `user_id`); role in `owner`, `editor`, `viewer`; at least one active owner must remain, enforced transactionally by the workspace use case.

### `oidc_login_transactions`

Stores pending one-time login state and browser-binding hashes with encrypted PKCE/nonce secrets.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Generated UUIDv7 |
| `state_hash` | `BYTEA NOT NULL UNIQUE` | Exactly 32 bytes (SHA-256 of raw state) |
| `browser_binding_hash` | `BYTEA NOT NULL` | Exactly 32 bytes (SHA-256 of transaction cookie) |
| `secrets_ciphertext` | `BYTEA NULL` | AES-256-GCM ciphertext of `{pkceVerifier, nonce}` payload |
| `secrets_iv` | `BYTEA NULL` | Exactly 12 random bytes while pending |
| `secrets_auth_tag` | `BYTEA NULL` | Exactly 16 bytes while pending |
| `key_version` | `TEXT NOT NULL` | Safe key identifier |
| `return_to` | `TEXT NOT NULL` | Validated relative application path (max 2048 chars) |
| `status` | `TEXT NOT NULL` | Exact `'pending'` or `'consumed'` |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation instant |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Creation plus configured transaction TTL |
| `consumed_at` | `TIMESTAMPTZ NULL` | Set on one-time consumption |
| `version` | `BIGINT NOT NULL DEFAULT 1` | Positive row version |

Constraints:
- Fixed hash lengths (`octet_length(state_hash) = 32`, `octet_length(browser_binding_hash) = 32`).
- Fixed IV and auth tag lengths when present (`octet_length(secrets_iv) = 12`, `octet_length(secrets_auth_tag) = 16`).
- Timestamp ordering: `expires_at > created_at`.
- Pending rows require all encrypted fields and `consumed_at IS NULL`.
- Consumed rows require `consumed_at IS NOT NULL`, null encrypted fields (`secrets_ciphertext IS NULL`, `secrets_iv IS NULL`, `secrets_auth_tag IS NULL`), and `created_at <= consumed_at`.
- Indexes: lookup index on `(state_hash, browser_binding_hash)` where status = `'pending'`; maintenance index on `(expires_at)` where status = `'pending'`.
- Sensitive data rules: raw state, raw nonce, raw PKCE verifier, and raw transaction cookies never persist in plaintext. All secrets are immediately scrubbed upon atomic consumption. Retention purge requires a separate approved task.

### `application_sessions`

Stores opaque server-side application sessions. Browser holds a 32-byte secure random token; PostgreSQL stores only SHA-256 hashes.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Generated UUIDv7; never sent to browser |
| `user_id` | `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT` | Application user |
| `current_token_hash` | `BYTEA NULL` | Exactly 32 bytes while active |
| `previous_token_hash` | `BYTEA NULL` | Exactly 32 bytes during rotation grace only |
| `previous_token_valid_until` | `TIMESTAMPTZ NULL` | Expiry of previous token during grace |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation instant |
| `last_seen_at` | `TIMESTAMPTZ NOT NULL` | Last touch instant |
| `idle_expires_at` | `TIMESTAMPTZ NOT NULL` | Sliding idle expiry |
| `absolute_expires_at` | `TIMESTAMPTZ NOT NULL` | Fixed maximum session expiry |
| `rotated_at` | `TIMESTAMPTZ NOT NULL` | Last current token rotation instant |
| `revoked_at` | `TIMESTAMPTZ NULL` | Set on revocation/logout |
| `revocation_reason` | `TEXT NULL` | `'logout'`, `'user_unavailable'`, `'idle_expired'`, `'absolute_expired'` |
| `version` | `BIGINT NOT NULL DEFAULT 1` | Positive row version |

Constraints:
- Hash lengths: `current_token_hash` and `previous_token_hash` are exactly 32 bytes when present.
- Timestamp ordering: `absolute_expires_at >= idle_expires_at >= last_seen_at`, `rotated_at >= created_at`.
- Active rows: `current_token_hash IS NOT NULL`, `revoked_at IS NULL`, `revocation_reason IS NULL`.
- Revoked rows: both token hashes and grace timestamp are `NULL`, `revoked_at IS NOT NULL`, valid safe `revocation_reason`.
- Previous token pair consistency: `previous_token_hash` and `previous_token_valid_until` are either both null or both non-null.
- Partial unique indexes: unique `(current_token_hash)` where `current_token_hash IS NOT NULL`; unique `(previous_token_hash)` where `previous_token_hash IS NOT NULL`.
- Lookup indexes: `(user_id)`, `(idle_expires_at)`, `(absolute_expires_at)`.
- Sensitive data rules: raw session tokens are never stored; only SHA-256 hashes persist. On logout or invalidation, hashes are scrubbed immediately. Retention purge requires a separate approved task.

## 3. Catalog and facts

### `products`

`id`, `workspace_id`, `name`, `merchant_name`, `canonical_url`, `category`, `description`, `status`, `current_fact_set_id`, standard fields.

`status`: `draft`, `active`, `archived`. Archiving prevents new generation but preserves history.

Indexes: (`workspace_id`, `status`, `updated_at desc`); URL hash within workspace for duplicate warnings, not mandatory deduplication.

### `product_fact_sets`

Version header: `id`, `workspace_id`, `product_id`, `revision_number`, `status`, `summary`, `confirmed_by_user_id`, `confirmed_at`, `created_by_user_id`, `created_at`.

Constraints: unique (`product_id`, `revision_number`); status is `proposed` or `confirmed`. Facts may be assembled while proposed, but confirmation locks the set permanently. Later corrections create a new fact-set revision. Confirmation is required before content generation.

### `product_facts`

`id`, `workspace_id`, `fact_set_id`, `fact_key`, `value_text`, `source_type`, `source_url`, `source_excerpt`, `confidence`, `claim_usage`, `created_at`.

- `source_type`: `user`, `merchant_page`, `document`, `other`.
- `confidence`: `confirmed`, `suggested`, `uncertain`.
- `claim_usage`: `allowed`, `context_only`, `prohibited`.

Only facts in a confirmed set and individually marked `confirmed` may ground affirmative generated claims. Source content is untrusted and size-limited.

### `affiliate_destinations`

`id`, `workspace_id`, `product_id`, `label`, `url`, `network_name`, `status`, standard fields.

Affiliate URLs are sensitive business data but are not authentication secrets. Whether encrypted at the application layer is a deployment policy; logs must always redact query parameters.

## 4. Media

### `media_assets`

`id`, `workspace_id`, `storage_key`, `original_filename`, `media_type`, `mime_type`, `byte_size`, `sha256`, `width`, `height`, `duration_ms`, `scan_status`, `processing_status`, `created_by_user_id`, standard fields.

States:

- `scan_status`: `pending`, `clean`, `rejected`, `failed`.
- `processing_status`: `uploaded`, `inspecting`, `ready`, `invalid`, `deleted`.

Constraints: storage keys are globally unique and server-generated. Content may reference only `clean` + `ready` assets. Object deletion is asynchronous after reference and retention checks.

## 5. AI and intelligence

### `ai_runs`

`id`, `workspace_id`, `purpose`, `provider`, `model`, `prompt_template`, `prompt_version`, `input_schema_version`, `output_schema_version`, `input_hash`, `output_hash`, `status`, `token_input`, `token_output`, `cost_microunits`, `cost_currency`, `latency_ms`, `safety_result`, `error_category`, `requested_by_user_id`, `started_at`, `completed_at`, `created_at`.

`status`: `queued`, `running`, `succeeded`, `failed`, `canceled`. Full input/output storage, if enabled, uses separately access-controlled encrypted object/columns and defined retention.

### `analyses`

`id`, `workspace_id`, `product_id`, `analysis_type`, `revision_number`, `fact_set_id`, `ai_run_id`, `content_json`, `schema_version`, `status`, `reviewed_by_user_id`, `reviewed_at`, `created_by_user_id`, `created_at`.

- `analysis_type`: `product`, `niche`, `performance`.
- `status`: `generated`, `accepted`, `superseded`, `rejected`.

Constraints: unique (`product_id`, `analysis_type`, `revision_number`). A performance analysis additionally references the analyzed publication/metric window through `analysis_subjects`.

### `analysis_subjects`

`analysis_id`, `workspace_id`, `subject_type`, `subject_id`, `role`, with a composite primary key. This provides traceability without placing polymorphic integrity solely in JSON; application use cases validate referenced subject ownership/type.

### Sprint 3 AI workforce orchestration foundation

Migration `0008_ai_workforce_foundation.sql` adds 7 tables supporting deterministic workforce orchestration:

#### `agent_role_definitions`
Normative definitions for office roles. Migration 0008 seeds exactly 6 active roles: `chief_of_staff`, `product_strategist`, `audience_strategist`, `creative_director`, `scriptwriter`, `compliance_reviewer`.
- `id UUID PRIMARY KEY`: deterministic UUIDv7 literals.
- `role_key TEXT NOT NULL`, `role_version INTEGER NOT NULL`, `display_name TEXT NOT NULL`, `department TEXT NOT NULL`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`, `allowed_artifact_types_json JSONB NOT NULL DEFAULT '[]'::jsonb`.
- Unique constraint: `(role_key, role_version)`.

#### `context_packages`
Immutable context snapshot linking a product and confirmed fact set for a work order.
- `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL REFERENCES workspaces(id)`, `product_id UUID NOT NULL`, `fact_set_id UUID NOT NULL`, `context_schema_version INTEGER NOT NULL`, `context_hash BYTEA NOT NULL` (32 bytes), `created_by_user_id UUID NOT NULL REFERENCES users(id)`, `created_at TIMESTAMPTZ NOT NULL`.
- Unique: `(workspace_id, id)`.
- Composite FKs: `(workspace_id, product_id)` to `products`, `(workspace_id, product_id, fact_set_id)` to `product_fact_sets`.
- Immutability: enforced by trigger `context_packages_enforce_immutability` raising exception on `UPDATE` or `DELETE`.

#### `context_package_analyses`
Immutable join table linking a context package to accepted source analyses.
- `workspace_id UUID NOT NULL`, `context_package_id UUID NOT NULL`, `analysis_id UUID NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`.
- Primary key: `(context_package_id, analysis_id)`.
- Composite FKs: `(workspace_id, context_package_id)` to `context_packages`, `(workspace_id, analysis_id)` to `analyses`.
- Immutability: enforced by trigger `context_package_analyses_enforce_immutability`.

#### `work_orders`
Boss-directed container for deterministic creative office graphs.
- `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL REFERENCES workspaces(id)`, `product_id UUID NOT NULL`, `context_package_id UUID NOT NULL`, `mission_type TEXT NOT NULL`, `directive_text TEXT NOT NULL`, `graph_template TEXT NOT NULL`, `graph_version INTEGER NOT NULL`, `status TEXT NOT NULL`, `priority INTEGER NOT NULL DEFAULT 50`, `created_by_user_id UUID NOT NULL REFERENCES users(id)`, `failure_category TEXT NULL`, `completed_at TIMESTAMPTZ NULL`, `created_at`, `updated_at`, `version`.
- Directive constraint: 1 to 4000 characters, trimmed, no control characters.
- Template constraint: `graph_template = 'creative_office_v1'`, `graph_version = 1`.
- Mission types: `short_video_series`, `product_launch_plan`, `objection_handling_series`, `educational_series`, `custom`.
- Statuses: `preparing`, `in_progress`, `waiting_review`, `completed`, `blocked`, `failed`, `canceled`.
- Indexes: `(workspace_id, updated_at DESC, id DESC)`, `(workspace_id, product_id, status, updated_at DESC)`.

#### `work_items`
Execution nodes within a work order graph.
- `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `work_order_id UUID NOT NULL`, `role_definition_id UUID NOT NULL REFERENCES agent_role_definitions(id)`, `task_key TEXT NOT NULL`, `expected_artifact_type TEXT NOT NULL`, `status TEXT NOT NULL`, `blocked_reason_code TEXT NULL`, `started_at`, `completed_at`, `created_at`, `updated_at`, `version`.
- Statuses: `ready`, `waiting_dependency`, `queued`, `running`, `review_required`, `completed`, `blocked`, `failed`, `canceled`.
- Constraints: unique `(work_order_id, task_key)`, unique `(workspace_id, work_order_id, id)`.
- Composite FK: `(workspace_id, work_order_id)` to `work_orders`.

#### `work_item_dependencies`
Directed acyclic dependency edges between work items within the same work order.
- `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `work_order_id UUID NOT NULL`, `work_item_id UUID NOT NULL`, `depends_on_work_item_id UUID NOT NULL`, `created_at`.
- Constraints: unique `(work_item_id, depends_on_work_item_id)`, check `work_item_id <> depends_on_work_item_id`.
- Composite FKs: target and source both reference `work_items(workspace_id, work_order_id, id)`.

#### `agent_assignments`
Office state projections for human-facing office visualization.
- `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `work_order_id UUID NOT NULL`, `role_definition_id UUID NOT NULL REFERENCES agent_role_definitions(id)`, `work_item_id UUID NULL`, `office_state TEXT NOT NULL`, `waiting_on_work_item_id UUID NULL`, `latest_report_code TEXT NULL`, `created_at`, `updated_at`, `version`.
- Unique constraint: `(work_order_id, role_definition_id)`.
- Trigger `agent_assignments_check_chief_of_staff`: enforces Chief of Staff has `work_item_id IS NULL`; all other 5 roles must have `work_item_id IS NOT NULL`.

## 6. Content and approval

### `content_items`

The creative aggregate: `id`, `workspace_id`, `product_id`, `title`, `goal`, `status`, `created_by_user_id`, standard fields.

`status` is a summary workflow state: `draft`, `in_review`, `approved`, `archived`. Publication outcomes do not alter this state.

### `content_variants`

One channel target: `id`, `workspace_id`, `content_item_id`, `platform`, `current_revision_id`, standard fields.

Constraints: platform in `threads`, `tiktok`; unique (`content_item_id`, `platform`) for MVP. Additional variants per platform can be introduced later without changing revisions/publications.

### `content_revisions`

Immutable: `id`, `workspace_id`, `content_variant_id`, `revision_number`, `body_text`, `settings_json`, `generation_brief_json`, `product_fact_set_id`, `product_analysis_id`, `niche_analysis_id`, `source_ai_run_id`, `content_hash`, `created_by_user_id`, `created_at`.

`settings_json` is schema-versioned and contains platform-specific, non-secret choices such as privacy/interaction/commercial/AI labels. Constraints: unique (`content_variant_id`, `revision_number`); unique (`content_variant_id`, `content_hash`) may be used to avoid duplicate revisions.

### `content_revision_media`

`workspace_id`, `content_revision_id`, `media_asset_id`, `position`, `alt_text`, `created_at`.

Constraints: primary key (`content_revision_id`, `media_asset_id`); unique (`content_revision_id`, `position`).

### `compliance_evaluations`

Immutable evaluation: `id`, `workspace_id`, `content_revision_id`, `policy_version`, `status`, `evaluated_at`, `created_at`.

`status`: `passed`, `warning`, `blocked`, `error`. An `error` fails closed for approval.

### `compliance_findings`

`id`, `workspace_id`, `evaluation_id`, `rule_code`, `severity`, `message`, `location_json`, `resolution`, `resolved_by_user_id`, `resolved_at`, `created_at`.

Blocking platform findings cannot be overridden in MVP. Warning acknowledgement is recorded rather than deleting the finding.

### `approval_requests`

`id`, `workspace_id`, `content_revision_id`, `social_account_id`, `compliance_evaluation_id`, `status`, `submitted_by_user_id`, `submitted_at`, `decided_by_user_id`, `decided_at`, `decision_note`, `approval_snapshot_json`, `created_at`.

`status`: `pending`, `approved`, `rejected`, `withdrawn`, `invalidated`.

Invariants:

- At most one pending request per revision/account.
- An approved request is immutable.
- Snapshot includes revision/content hash, ordered media hashes, exact destination, disclosure/labels/settings, compliance policy/result, and relevant capability version.
- Any material edit creates another revision. Connection identity/settings changes invalidate affected approval rather than modifying it.

## 7. Social connections

### `social_accounts`

`id`, `workspace_id`, `platform`, `provider_account_id`, `display_name`, `handle`, `status`, `granted_scopes`, `capabilities_json`, `capabilities_checked_at`, `token_expires_at`, `connected_by_user_id`, `disconnected_at`, standard fields.

`status`: `connecting`, `active`, `degraded`, `reauth_required`, `review_gated`, `disconnected`.

Constraints: unique (`workspace_id`, `platform`, `provider_account_id`) for non-disconnected rows. Provider identity must be confirmed before `active`.

### `social_credentials`

Access-restricted table: `social_account_id` PK/FK, `workspace_id`, `access_token_ciphertext`, `refresh_token_ciphertext`, `encryption_key_version`, `token_type`, `access_expires_at`, `refresh_expires_at`, `scope_snapshot`, `rotated_at`, `updated_at`.

Only credential repository methods can read/decrypt this table. No token value appears in ORM serialization, analytics, audit, or general logs.

### `oauth_transactions`

`id`, `workspace_id`, `platform`, `initiated_by_user_id`, `state_hash`, `pkce_verifier_ciphertext` where applicable, `redirect_uri`, `requested_scopes`, `expires_at`, `consumed_at`, `status`, `created_at`.

Constraints: `state_hash` unique; one-time use; short expiration. Store hashes instead of raw state where feasible.

## 8. Scheduling and publishing

### `publications`

One destination execution: `id`, `workspace_id`, `approval_request_id`, `content_revision_id`, `social_account_id`, `scheduled_for`, `schedule_timezone`, `schedule_local_value`, `status`, `next_attempt_at`, `attempt_count`, `lease_owner`, `lease_expires_at`, `remote_post_id`, `remote_permalink`, `published_at`, `last_error_category`, `last_error_code`, `canceled_by_user_id`, `canceled_at`, standard fields.

`status`:

- `scheduled`
- `queued`
- `publishing`
- `processing_remote`
- `requires_user_action`
- `published`
- `retry_wait`
- `outcome_unknown`
- `failed`
- `rejected`
- `canceled`

Constraints/invariants:

- unique (`approval_request_id`) in MVP: an approval snapshot can produce at most one publication.
- unique (`social_account_id`, `remote_post_id`) when remote ID is non-null.
- only an approved, non-invalidated approval may be scheduled.
- terminal states are `published`, `failed`, `rejected`, `canceled`; `requires_user_action` may later become `published` only after official confirmation.
- state changes use version compare-and-swap.
- `scheduled_for` is UTC while original local value/timezone is retained for user explanation.

### `publish_attempts`

Append-only: `id`, `workspace_id`, `publication_id`, `attempt_number`, `idempotency_key`, `adapter_version`, `request_hash`, `started_at`, `completed_at`, `outcome`, `provider_operation_id`, `provider_post_id`, `provider_error_code`, `http_status`, `retry_after`, `response_metadata_json`, `correlation_id`, `created_at`.

Constraints: unique (`publication_id`, `attempt_number`); `idempotency_key` unique. `response_metadata_json` is allowlisted and sanitized.

### `publication_consents`

`id`, `workspace_id`, `approval_request_id`, `platform`, `preview_hash`, `consent_type`, `consented_by_user_id`, `consented_at`, `policy_version`, `expires_at`, `created_at`.

Used where a platform requires explicit confirmation/transfer consent. The publishing use case defines when renewed consent is required.

## 9. Analytics

### `metric_definitions`

Reference data: `platform`, `metric_key`, `display_name`, `unit`, `aggregation_semantics`, `schema_version`, `active`, with primary key (`platform`, `metric_key`, `schema_version`).

### `metric_snapshots`

Append-only: `id`, `workspace_id`, `publication_id`, `platform`, `metric_key`, `value_numeric`, `period_start`, `period_end`, `provider_observed_at`, `collected_at`, `definition_version`, `source_payload_hash`, `created_at`.

Deduplication constraint: (`publication_id`, `metric_key`, `provider_observed_at`, `value_numeric`) or provider cursor identity where available. Index (`workspace_id`, `publication_id`, `metric_key`, `collected_at desc`).

Never overwrite historical values. Corrections are newer snapshots. Platform-qualified metrics remain distinct unless a reviewed mapping declares semantic equivalence.

### `analytics_sync_cursors`

`publication_id` PK, `workspace_id`, `next_sync_at`, `last_success_at`, `last_attempt_at`, `consecutive_failures`, `provider_cursor`, `stop_after`, `lease_owner`, `lease_expires_at`, `updated_at`.

## 10. Reliability and audit

### `outbox_events`

`id`, `workspace_id` nullable only for global system events, `event_type`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `payload_json`, `occurred_at`, `available_at`, `delivery_count`, `delivered_at`, `last_error`, `created_at`.

Index undelivered rows by (`available_at`, `occurred_at`). Payloads carry IDs and versions, not secrets or large content.

### `job_executions`

`id`, `workspace_id`, `job_type`, `deduplication_key`, `status`, `attempt`, `lease_owner`, `lease_expires_at`, `started_at`, `completed_at`, `error_category`, `correlation_id`, standard fields.

Unique (`job_type`, `deduplication_key`) when the job is logically singleton. Publication attempts remain their own specialized record.

### `idempotency_keys`

`id`, `workspace_id`, `principal_id`, `route_key`, `key_hash`, `request_hash`, `status_code`, `response_json`, `resource_type`, `resource_id`, `expires_at`, `created_at`.

Constraints: unique (`workspace_id`, `principal_id`, `route_key`, `key_hash`). Reuse with a different request hash returns conflict. Stored responses are size-limited and secret-free.

### `audit_events`

Append-only: `id`, `workspace_id`, `actor_type`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `result`, `reason_code`, `changes_json`, `ip_hash`, `user_agent_summary`, `correlation_id`, `occurred_at`, `created_at`.

No update/delete privilege for the application role except through a separately controlled retention process. `changes_json` contains allowlisted field names and redacted before/after values; content bodies and credentials are excluded by default.

## 11. Key relationship map

```text
workspace
  +-- memberships -> users
  +-- products -> product_fact_sets -> product_facts
  |      +-- analyses -> analysis_subjects
  |      +-- content_items -> content_variants -> content_revisions
  |                                      +-- revision_media -> media_assets
  |                                      +-- compliance_evaluations -> findings
  |                                      +-- approval_requests
  +-- social_accounts -> social_credentials
  |          +-- approval_requests
  |          +-- publications -> publish_attempts
  |                              +-- metric_snapshots
  +-- ai_runs
  +-- outbox_events / job_executions / audit_events
```

## 12. Concurrency rules

- Updates require expected `version`; zero rows updated returns `409 conflict`.
- Approval locks the pending request/revision aggregate and verifies current compliance/account snapshots in the same transaction.
- Scheduling locks the approval and checks no existing publication.
- Scheduler claims with `FOR UPDATE SKIP LOCKED` and short transactions.
- Publication execution uses a renewable lease. Lease expiry permits recovery but never proves that an external call did not occur.
- Token refresh locks `social_credentials` by social account; a second worker reuses the refreshed value.
- Outbox dispatch marks delivery only after queue acknowledgement. Consumers deduplicate.
- Analytics insertion is append-only and deduplicated by the documented provider observation identity.

## 13. Retention and deletion baseline

Exact durations require Product Owner/privacy review before production. The baseline categories are:

- OAuth transaction state: minutes, then purge.
- Idempotency response cache: normally 24 hours, adjusted per operation.
- Operational logs/traces: short bounded retention.
- AI full prompts/outputs: disabled or short retention by default; metadata retained for audit/cost.
- Product/content/publication records: workspace life plus documented recovery window.
- Social credentials: delete immediately on successful disconnect/deletion; if provider revocation fails, local access is still removed and the failure is audited.
- Media objects: delete after reference removal and recovery window.
- Metric snapshots: workspace life unless configured otherwise.
- Audit/security events: separately defined minimum period with content minimization.

Workspace deletion sets `deletion_pending`, blocks work, cancels pending publications, removes credentials, then purges tenant data in dependency order. A completion record contains no customer content.

## 14. Migration and recovery requirements

- Every schema change is a numbered forward migration with an automated fresh-database and upgrade test.
- Production startup does not auto-run migrations.
- Additive changes precede code use; destructive changes wait until old code/data is retired.
- Large backfills are resumable, bounded, observable jobs.
- Daily backups and point-in-time recovery are required; recovery objectives are set before beta.
- Restore drills validate both database and object metadata consistency.
- A migration that weakens tenant, approval, credential, or publication invariants requires an architecture decision record.
