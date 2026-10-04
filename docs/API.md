# Affiliate Content OS - HTTP API Contract

Status: Sprint 0 conceptual contract, proposed for Product Owner approval

Last updated: 2026-10-05

## 1. Contract principles

- Base path: `/api/v1`.
- Format: JSON over HTTPS; UTF-8; timestamps are RFC 3339 UTC.
- Contract source: versioned OpenAPI generated from or checked against runtime schemas.
- Browser authentication: secure HttpOnly application session cookie. Social OAuth tokens never reach the browser.
- Every tenant resource is under `/workspaces/{workspaceId}`.
- IDs are opaque UUID strings; clients must not infer order or tenancy.
- Request and response fields use `camelCase`; database names remain `snake_case`.
- Unknown request fields are rejected for commands and ignored only for explicitly extensible filter objects.
- Mutations that create jobs/resources use `Idempotency-Key` where marked.
- Mutable resource updates require `If-Match: "<version>"` or a request `version` where specified.
- Collections use cursor pagination: `?limit=...&after=...`; no unbounded list endpoint.
- API success never stands in for remote platform success. Async operations return their own state resource.

Exact payload schemas will be committed in OpenAPI during implementation. The resource shapes and behaviors below are the architectural contract.

## 2. Common headers and envelopes

### Request headers

| Header | Use |
| --- | --- |
| `Content-Type: application/json` | JSON commands |
| `Idempotency-Key` | Required on generation, approval, scheduling, and other marked creation commands |
| `If-Match` | Required for versioned updates/cancellation |
| `X-Request-ID` | Optional client correlation ID; server validates format or creates one |

CSRF protection is enforced for cookie-authenticated state changes using the selected session framework's supported same-origin/token mechanism. CORS is not open by default.

### Single-resource response

The response body is the resource itself. It includes `id`, `createdAt`, and where mutable, `updatedAt` and `version`. HTTP `ETag` reflects the version.

### Collection response

```json
{
  "items": [],
  "page": { "nextCursor": null, "hasMore": false }
}
```

Cursors are opaque, signed/validated, filter-bound, and expire where appropriate.

### Async operation response

Return `202 Accepted` with `Location` pointing to an operation or resource whose `status` can be polled. A queued operation is not described as successful completion.

### `GET /api/v1/workspaces/{workspaceId}/operations/{operationId}`

Viewer+ within the originating workspace. Returns `queued`, `running`, `succeeded`, `failed`, or `canceled`, timestamps, safe progress/error metadata, and `resultLocation` when succeeded. Operation resources are bounded-retention delivery/status records, not replacements for durable domain resources. They never expose queue payloads, prompts, provider bodies, or secrets.

## 3. Error contract

Errors use `application/problem+json` compatible with RFC 9457:

```json
{
  "type": "https://affiliate-content-os.example/problems/invalid-state",
  "title": "Content revision is not approved",
  "status": 409,
  "code": "CONTENT_NOT_APPROVED",
  "detail": "Approve this exact revision before scheduling it.",
  "instance": "/api/v1/workspaces/.../publications",
  "requestId": "req_...",
  "errors": [{ "path": "scheduledFor", "code": "IN_PAST", "message": "Choose a future time." }],
  "retryAfterSeconds": null
}
```

`code` is stable and machine-readable. `detail` is safe for users and may evolve. Validation errors use JSON paths. Provider bodies, stack traces, secrets, prompts, signed URLs, and cross-tenant existence are never returned.

Status mapping:

| Status | Meaning |
| --- | --- |
| `400` | Malformed input |
| `401` | Missing/expired application session |
| `403` | Authenticated but unauthorized |
| `404` | Missing or not visible in this workspace |
| `409` | Version/state/idempotency conflict |
| `413` | Payload/upload too large |
| `422` | Well-formed but violates business validation |
| `429` | Rate limited; include `Retry-After` |
| `502` | Permanent/invalid upstream response without exposed detail |
| `503` | Transient dependency unavailable |
| `500` | Unexpected internal error |

## 4. Authentication and current user

Application authentication endpoints are supplied by the selected OIDC/session implementation under `/auth/*`; they are not a custom password API.

### `GET /api/v1/me`

Returns application user identity, session metadata, and accessible workspace summaries. Does not return social accounts or tokens.

### `POST /api/v1/logout`

Invalidates the application session. `204 No Content` on completion.

## 5. Workspaces and memberships

| Method and path | Role | Behavior |
| --- | --- | --- |
| `POST /workspaces` | signed-in user | Create workspace and owner membership; idempotent |
| `GET /workspaces/{workspaceId}` | member | Get settings and caller role |
| `PATCH /workspaces/{workspaceId}` | owner | Update versioned name/timezone/brand/disclosure/AI settings |
| `GET /workspaces/{workspaceId}/members` | member | Paginated members |
| `POST /workspaces/{workspaceId}/members` | owner | Invite/add according to identity-provider support |
| `PATCH /workspaces/{workspaceId}/members/{membershipId}` | owner | Change role/status; cannot remove last owner |
| `DELETE /workspaces/{workspaceId}` | owner | Start deletion; recent authentication; async |

Changing timezone never rewrites an existing publication's stored UTC instant or original schedule context.

## 6. Products and facts

### Product endpoints

| Method and path | Role | Behavior |
| --- | --- | --- |
| `GET /workspaces/{workspaceId}/products` | viewer+ | Filter/paginate products |
| `POST /workspaces/{workspaceId}/products` | editor+ | Create draft product; idempotent |
| `GET /workspaces/{workspaceId}/products/{productId}` | viewer+ | Product plus current fact-set summary |
| `PATCH /workspaces/{workspaceId}/products/{productId}` | editor+ | Versioned metadata update |
| `POST /workspaces/{workspaceId}/products/{productId}/archive` | editor+ | Archive; idempotent state command |

### Fact set endpoints

| Method and path | Role | Behavior |
| --- | --- | --- |
| `GET /workspaces/{workspaceId}/products/{productId}/fact-sets` | viewer+ | Version history |
| `POST /workspaces/{workspaceId}/products/{productId}/fact-sets` | editor+ | Create immutable proposed/confirmed facts from submitted values; idempotent |
| `GET /workspaces/{workspaceId}/products/{productId}/fact-sets/{factSetId}` | viewer+ | Get facts/provenance |
| `POST /workspaces/{workspaceId}/products/{productId}/fact-sets/{factSetId}/confirm` | editor+ | Confirm set for generation; new updates require a new set |

An optional metadata-assistance command, if implemented, is `POST .../product-metadata-jobs`. It accepts only an explicitly supplied public URL and returns `202`; it never mutates confirmed facts automatically.

Affiliate destinations are nested at `/products/{productId}/affiliate-destinations`; list/create/update/archive are editor+ actions. Responses redact configured sensitive query values where policy requires.

## 7. Media

### `POST /workspaces/{workspaceId}/media/uploads`

Editor+, idempotent. Accepts filename, declared MIME type, byte size, and checksum. Returns an asset ID plus a time-limited constrained upload instruction. The storage key is server-generated.

### `POST /workspaces/{workspaceId}/media/{mediaId}/complete`

Editor+, idempotent. Verifies object metadata and queues scanning/inspection. Returns `202` and media resource location.

### `GET /workspaces/{workspaceId}/media/{mediaId}`

Viewer+. Returns metadata, scan/processing state, and an optional short-lived display URL only when authorized and safe.

### `DELETE /workspaces/{workspaceId}/media/{mediaId}`

Editor+, versioned. Rejects deletion while referenced by retained revisions; otherwise queues object purge.

No endpoint accepts a caller-chosen storage key or fetches arbitrary media URLs in MVP.

## 8. Analyses and AI operations

### `POST /workspaces/{workspaceId}/products/{productId}/analyses`

Editor+, `Idempotency-Key` required. Body:

```json
{
  "analysisType": "product",
  "factSetId": "uuid",
  "sourceAnalysisIds": [],
  "instructions": "Optional bounded user context"
}
```

Allowed types here are `product` and `niche`; niche may require an accepted product analysis. Returns `202` with a `Location` for the AI operation. After the operation succeeds, the immutable analysis resource exists in `generated` status and may then be accepted or rejected. Rate and AI-budget limits apply.

### `GET /workspaces/{workspaceId}/products/{productId}/analyses`

Viewer+. Filter by type/status; paginated.

### `GET /workspaces/{workspaceId}/analyses/{analysisId}`

Viewer+. Returns structured analysis, schema version, sources, status, and safe model provenance; no hidden system prompt.

### `POST /workspaces/{workspaceId}/analyses/{analysisId}/accept`

Editor+, idempotent command. Records human review. Reject/revise creates another analysis/version; generated output is not overwritten.

### `POST /workspaces/{workspaceId}/analyses/{analysisId}/reject`

Editor+, idempotent command with a bounded reason. Records rejection without deleting or overwriting the generated analysis.

## 9. Content, revisions, compliance, and approval

### Content endpoints

| Method and path | Role | Behavior |
| --- | --- | --- |
| `GET /workspaces/{workspaceId}/content` | viewer+ | Filter by product/platform/workflow; paginate |
| `POST /workspaces/{workspaceId}/content` | editor+ | Create content item and brief; idempotent |
| `GET /workspaces/{workspaceId}/content/{contentId}` | viewer+ | Aggregate summary and variant states |
| `PATCH /workspaces/{workspaceId}/content/{contentId}` | editor+ | Update title/goal only; versioned |
| `POST /workspaces/{workspaceId}/content/{contentId}/archive` | editor+ | Archive when no active publication conflicts |

### Generation

`POST /workspaces/{workspaceId}/content/{contentId}/generation-jobs` is editor+, idempotent, rate-limited, and returns `202`. Body selects platform, fact set, analysis versions, goal/tone, number of variants within a server limit, and optional user instructions. It never schedules or publishes.

### Revisions

- `GET .../content/{contentId}/variants/{variantId}/revisions`: history.
- `POST .../content/{contentId}/variants/{variantId}/revisions`: create immutable revision from edited body/settings/media; editor+, idempotent.
- `GET .../revisions/{revisionId}`: exact revision and preview model; viewer+.
- `POST .../revisions/{revisionId}/compliance-evaluations`: run current deterministic policy; editor+, idempotent.

Revision creation does not modify an old revision. If it becomes current, existing pending/approved workflows tied to earlier material content remain historical and cannot be silently transferred.

### Approval

`POST /workspaces/{workspaceId}/approval-requests` is editor+, idempotent. Required body:

```json
{
  "contentRevisionId": "uuid",
  "socialAccountId": "uuid",
  "complianceEvaluationId": "uuid"
}
```

The API validates same workspace, media readiness, current account identity/capabilities, and no blocking/error findings.

- `GET /workspaces/{workspaceId}/approval-requests`: viewer+, paginated.
- `GET /workspaces/{workspaceId}/approval-requests/{approvalRequestId}`: viewer+, includes snapshot and history.
- `POST .../{approvalRequestId}/approve`: editor+, `Idempotency-Key` and expected version required; creates immutable approval snapshot.
- `POST .../{approvalRequestId}/reject`: editor+, expected version; body includes reason.
- `POST .../{approvalRequestId}/withdraw`: submitter or owner before decision.

Approval returns `409` on stale state and `422` on current compliance/capability failure.

## 10. Social account connections

### `GET /workspaces/{workspaceId}/social-accounts`

Viewer+. Returns account identity, connection health, granted capability names, capability freshness, and reconnect/review actions. Never returns tokens.

### `POST /workspaces/{workspaceId}/social-connections/{platform}/authorize`

Owner only, idempotent. Creates a short-lived OAuth transaction and returns a server-approved authorization URL (or a redirect response by final implementation). `platform` is `threads` or `tiktok`. Requested scopes are server-defined; arbitrary client scopes/redirects are rejected.

### `GET /api/v1/social-connections/{platform}/callback`

Public callback with one-time state validation, authorization-code exchange, exact redirect validation, and safe redirect back to the workspace. It does not trust a workspace ID supplied outside the bound OAuth transaction. Errors redirect with an opaque result key; details are retrieved authenticated.

### Account commands

- `POST /workspaces/{workspaceId}/social-accounts/{accountId}/refresh-capabilities`: owner, rate-limited, async/idempotent.
- `POST /workspaces/{workspaceId}/social-accounts/{accountId}/reconnect`: owner; begins a new OAuth transaction.
- `DELETE /workspaces/{workspaceId}/social-accounts/{accountId}`: owner, recent authentication, versioned; cancels pending publications and removes credentials after revocation attempt.

There is no endpoint to submit raw access/refresh tokens.

## 11. Publications and scheduling

### `POST /workspaces/{workspaceId}/publications`

Editor+, `Idempotency-Key` required. Body:

```json
{
  "approvalRequestId": "uuid",
  "scheduledFor": "2026-10-06T02:00:00Z",
  "scheduleTimezone": "Asia/Ho_Chi_Minh",
  "scheduleLocalValue": "2026-10-06T09:00:00"
}
```

The server validates exact approved snapshot, destination, future bounds, local-time ambiguity/nonexistence, connection capability, consent requirements, and uniqueness. Returns `201` with `scheduled`; it does not call the platform inline.

For a platform requiring a final consent record, the approval/preview flow exposes a separate `POST .../approval-requests/{id}/consents` command before scheduling or transfer. The request includes `previewHash`, exact platform choices, consent type, and policy version.

### Publication reads and commands

| Method and path | Role | Behavior |
| --- | --- | --- |
| `GET /workspaces/{workspaceId}/publications` | viewer+ | Calendar/list filters and cursor pagination |
| `GET /workspaces/{workspaceId}/publications/{publicationId}` | viewer+ | Status, attempts summary, remote link, actionable error |
| `PATCH /workspaces/{workspaceId}/publications/{publicationId}` | editor+ | Reschedule only while `scheduled`; versioned |
| `POST /workspaces/{workspaceId}/publications/{publicationId}/cancel` | editor+ | Cancel only before execution lease; versioned/idempotent |
| `POST /workspaces/{workspaceId}/publications/{publicationId}/retry` | editor+ | Explicit retry only for classified safe terminal failures; creates a new attempt |
| `POST /workspaces/{workspaceId}/publications/{publicationId}/reconcile` | editor+ | Request status lookup for `processing_remote`/`outcome_unknown`; async |

The retry endpoint rejects `outcome_unknown` until reconciliation proves no remote post exists. Raw provider upload URLs and credentials are never returned.

## 12. Analytics and performance analysis

### `GET /workspaces/{workspaceId}/publications/{publicationId}/metrics`

Viewer+. Returns platform-native metric series with definition/display metadata, provider observation time, collection time, and freshness. Missing or unauthorized metrics are explicit.

### `GET /workspaces/{workspaceId}/analytics/posts`

Viewer+. Bounded date range and cursor pagination; filters by platform/product/content. Returns per-post metrics without claiming cross-platform equivalence.

### `POST /workspaces/{workspaceId}/publications/{publicationId}/analytics-syncs`

Editor+, idempotent and tightly rate-limited. Requests a refresh if within provider/budget policy; returns `202`. Normal synchronization is automatic.

### `POST /workspaces/{workspaceId}/performance-analyses`

Editor+, `Idempotency-Key` required. Body selects confirmed publication IDs, immutable metric window/snapshot cutoff, comparison intent, and optional hypotheses. Returns `202`. Output includes observations, hypotheses, confidence/limitations, evidence links, and recommendations.

### `POST /workspaces/{workspaceId}/analyses/{analysisId}/recommendations/{recommendationId}/adopt`

Editor+, idempotent. Creates a new content brief or adds a traceable brief input. It never changes approved/scheduled content.

## 13. Audit

### `GET /workspaces/{workspaceId}/audit-events`

Owner by default; viewer access may be broadened only by an approved decision. Cursor paginated; filters by resource, actor, action, and bounded time range. Sensitive changes are redacted. Audit records are not editable through the API.

## 14. Idempotency behavior

For marked requests:

1. Scope the key to workspace, authenticated principal, and route/command.
2. Hash the canonical validated request.
3. First request reserves the key and performs the command.
4. Same key + same hash returns the stored status/body (and resource location).
5. Same key + different hash returns `409 IDEMPOTENCY_KEY_REUSED`.
6. Concurrent duplicate returns the completed response or `409/425` with a bounded retry instruction; it never performs twice.

Idempotency at the HTTP boundary complements, but does not replace, publication leases and adapter reconciliation.

## 15. Rate limits and quotas

Limits are enforced per IP for unauthenticated callbacks and per user/workspace for authenticated operations. Stricter budgets apply to sign-in/OAuth starts, AI jobs, upload initialization, manual analytics sync, publishing commands, and reconciliation. Provider limits are separately honored by adapters. `429` includes `Retry-After`; queued jobs defer rather than spin.

## 16. Events and live updates

MVP correctness relies on polling resource endpoints. Optional server-sent events may later provide status hints scoped to a workspace/session, but are not a source of truth and must trigger an authorized resource refetch. Webhooks from social platforms, if used, are provider callbacks with signature/replay validation and are never exposed as internal event contracts.

## 17. API evolution

- Additive optional fields may ship within v1.
- Removing/renaming fields, changing semantics, tightening an accepted enum, or changing state transitions requires a compatibility plan or new version.
- Provider-specific payloads do not leak into public contracts; new platform capabilities appear as normalized named capabilities and versioned settings schemas.
- OpenAPI diff checks block accidental breaking changes.
- Deprecated fields include documentation and a removal date; server telemetry confirms safe removal.
