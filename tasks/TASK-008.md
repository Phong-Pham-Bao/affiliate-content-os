# TASK-008 - Append-Only Workspace Audit Primitives

Status: Approved by Product Owner

Approval basis: On 2026-11-05 the Product Owner explicitly authorized Codex to define, assign, review, remediate, and approve TASK-008 through completion without another planning checkpoint. This specification is the smallest remaining Sprint 1 slice after TASK-007.

## Objective

Implement a provider-neutral, append-only workspace audit foundation that:

1. defines one immutable, secret-minimizing audit-event contract;
2. constructs events through a fail-closed application boundary;
3. persists them in PostgreSQL through an insert-only adapter;
4. enforces tenant ownership and append-only behavior in the database; and
5. can later be composed inside mutation transactions without coupling domain/application code to PostgreSQL.

This task completes the audit primitive required by Sprint 1. It does not retrofit existing TASK-004 through TASK-007 behavior, add audit history APIs, record read-only authorization checks, or add product workflows.

## Context

`docs/DATABASE.md` defines `audit_events` as an append-only workspace record. `docs/ARCHITECTURE.md` requires audit records to remain separate from telemetry and to be appended in the same transaction as future mutations. ADR-019 rejects reconstructing audit history from logs. No current mutation has an approved action-specific audit contract, so this task supplies the safe primitive only; later mutation tasks must atomically append their own allowlisted events.

## Required implementation

### 1. Closed domain audit contract

Add a domain audit module with these exact closed values:

- `AuditActorType`: `user | system`
- `AuditResult`: `succeeded | denied | failed`

Add branded `AuditEventId` and `CorrelationId` types. Their parsers/type guards accept canonical lowercase UUIDv7 only. Existing ID behavior must remain compatible.

Define an immutable `AuditEventSnapshot` containing exactly:

```ts
{
  id: AuditEventId;
  workspaceId: WorkspaceId;
  actorType: AuditActorType;
  actorUserId: UserId | null;
  action: string;
  resourceType: string;
  resourceId: string;
  result: AuditResult;
  reasonCode: string | null;
  changes: Readonly<Record<string, AuditScalarChange>>;
  ipHash: string | null;
  userAgentSummary: string | null;
  correlationId: CorrelationId | null;
  occurredAt: IsoTimestamp;
  createdAt: IsoTimestamp;
}
```

`AuditScalarChange` contains exactly own enumerable data properties `before` and `after`; each value is a primitive `string | number | boolean | null`. Numbers must be finite safe integers. Strings are at most 256 Unicode code points and contain no C0/C1 control characters. At least one of `before` or `after` must differ under `Object.is`.

Exact validation policy:

- `actorType=user` requires `actorUserId`; `actorType=system` requires it to be `null`.
- `action`, `resourceType`, change keys, and non-null `reasonCode` use canonical lowercase tokens: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`, maximum 128 characters.
- `resourceId` is a canonical lowercase UUIDv7.
- `changes` has at most 32 entries and is returned as a fresh frozen null-prototype record whose fresh change objects are frozen.
- Reject change keys containing any segment equal to `token`, `secret`, `password`, `credential`, `authorization`, `cookie`, `session`, `body`, `content`, `prompt`, `output`, `email`, `url`, or `ip`.
- `ipHash` is `null` or exactly 64 lowercase hexadecimal characters; raw IP addresses are invalid.
- `userAgentSummary` is `null` or a trimmed 1..128-code-point printable string without control characters. It is a bounded product-owned summary, never a raw header.
- `createdAt >= occurredAt`.

Export only the approved immutable contract types, closed tuples/guards, and ID parsers from the domain package. The domain imports no Node module and exposes no public unknown-object factory, proxy detector, or caller-selectable security policy.

ECMAScript has no runtime-neutral operation that identifies a proxy without potentially invoking its traps. Therefore hostile-object capture is an application-boundary responsibility: the Node-capable application package owns one fixed validator using `node:util.types.isProxy` internally. This architectural correction preserves the unconditional no-hook guarantee without coupling domain code to Node or trusting a detector supplied by a caller. Do not add a generic JSON audit payload.

### 2. Application construction boundary

Add:

```ts
interface CreateAuditEventInput {
  readonly workspaceId: string;
  readonly actorType: AuditActorType;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly result: AuditResult;
  readonly reasonCode: string | null;
  readonly changes: Readonly<Record<string, AuditScalarChange>>;
  readonly ipHash: string | null;
  readonly userAgentSummary: string | null;
  readonly correlationId: string | null;
  readonly occurredAt?: string;
}
```

and a use case/factory:

```ts
createAuditEvent(
  input: CreateAuditEventInput,
  deps: { readonly clock: ClockPort; readonly ids: AuditIdGeneratorPort },
): AuditEventSnapshot
```

`AuditIdGeneratorPort` contains only `generateAuditEventId(): AuditEventId`. Do not expand or depend on the broad existing `IdGeneratorPort`.

Add a fixed application validator with no policy/dependency parameter:

```ts
captureAuditEventSnapshot(raw: unknown): AuditEventSnapshot
```

It owns the exact validation policy from section 1, rejects root, `changes`, and nested change proxies/revoked proxies with the fixed Node proxy classifier before reflection, and returns a fresh deeply frozen snapshot. Infrastructure must reuse this validator when treating a supplied event as untrusted. A caller cannot replace, disable, or bypass its proxy policy with an extra argument.

The input must be an exact plain/null-prototype object with only the approved required keys plus optional `occurredAt`, using the same hostile-object rules as the fixed application validator. Capture one safe clock value. If `occurredAt` is omitted, use that instant for both timestamps; if provided, validate it and require it not to be in the future relative to the captured clock. Generate exactly one ID only after input and dependency outputs needed before generation are valid. Validate the generated ID as untrusted runtime data. Return the application-validated deep-frozen snapshot.

No persistence, transaction, logger, HTTP request, authorization lookup, session, telemetry client, hash function, or audit reader belongs in this function.

### 3. Narrow append port and infrastructure adapter

Add:

```ts
interface AuditEventAppendPort {
  appendAuditEvent(event: AuditEventSnapshot): Promise<void>;
}
```

Implement `PostgresAuditAdapter` with two construction paths:

- the normal factory accepts `Database`;
- a transaction-scoped factory accepts `TransactionExecutor`.

Both paths use the same insert implementation and exactly one parameterized `INSERT`. This permits future use cases to append an audit event in the same transaction as a mutation. The adapter must validate the event as untrusted runtime data before issuing SQL, use only the approved columns, require exactly one inserted row, return no database row, and sanitize all database failures. Never stringify or retain rejected values.

Export the adapter from a new `@affiliate-content-os/infrastructure/audit` package subpath. Do not introduce a repository that updates or deletes events.

### 4. Fixed safe errors

Add fixed application errors:

- `AuditEventInputError`: code `AUDIT_EVENT_INPUT_INVALID`, message `Invalid audit event input`.
- `AuditEventDependencyError`: code `AUDIT_EVENT_DEPENDENCY_INVALID`, message `Audit event dependency error`.

Malformed caller input uses the input error. Invalid/throwing clock or ID dependencies use a fresh dependency error. Neither error accepts arbitrary public messages or metadata, retains a cause/original value, or exposes IDs, event fields, secrets, database data, or sentinels through properties, messages, stacks, JSON, inspection, stdout, or stderr.

The infrastructure adapter exposes only the existing sanitized `DatabaseError` boundary for insert failures; it must not leak SQL or bind values.

### 5. PostgreSQL migration

Add migration `0004_audit_events.sql` with the exact columns in `docs/DATABASE.md`, using `JSONB NOT NULL DEFAULT '{}'::jsonb` for `changes_json`.

Required constraints:

- primary key `id`; foreign keys for `workspace_id` and nullable `actor_user_id`, both `ON DELETE RESTRICT`;
- closed actor/result checks and actor/user consistency;
- token-format/length checks for action, resource type, and reason code;
- UUID `resource_id` (no polymorphic foreign key); UUID nullable correlation ID;
- `changes_json` must be an object with at most 32 keys;
- IP hash and user-agent summary shape/length checks;
- `created_at >= occurred_at`.

Add indexes supporting stable workspace cursor reads and the documented filters:

- `(workspace_id, occurred_at DESC, id DESC)`;
- `(workspace_id, resource_type, resource_id, occurred_at DESC)`;
- `(workspace_id, actor_user_id, occurred_at DESC)` where actor user is non-null;
- `(correlation_id)` where correlation ID is non-null.

Enforce append-only storage with a dedicated trigger function and `BEFORE UPDATE OR DELETE` trigger that always raises SQLSTATE `55000`. Revoke `UPDATE`, `DELETE`, and `TRUNCATE` from `PUBLIC`. A future separately approved retention migration/process may deliberately replace this protection; this task adds no retention bypass.

Application tests must prove raw SQL update/delete are rejected and the original row is unchanged. No seed data is allowed.

### 6. Exports and dependency direction

- Domain imports no application, infrastructure, Node, or app code.
- Application depends only on domain and its own ports.
- Infrastructure implements the application port and owns SQL only.
- Apps receive no new composition, route, or behavior.
- Generated declarations expose no generic JSON, arbitrary error constructor, database executor, or mutation method beyond the approved surface.

## Expected files

Production changes are expected in:

- `packages/domain/src/audit.ts`, `ids.ts`, and `index.ts`;
- `packages/application/src/audit/*`, `ports.ts`, and `index.ts`;
- `packages/infrastructure/src/audit/*`, `package.json`, and migration `0004_audit_events.sql`.

Tests may be added under the corresponding package test directories and migration/integration suites. Do not change app, frontend, worker, OpenAPI, authentication, authorization, or unrelated files. Any necessary production deviation must be reported before implementation continues.

## Database changes

Create only `audit_events`, its four approved indexes, and append-only trigger function/trigger. Do not add outbox, jobs, idempotency, product, content, social, or analytics tables.

## API changes

None. Do not implement `GET /workspaces/{workspaceId}/audit-events`; it remains a later authorized query/API task. OpenAPI output must remain byte-for-byte unchanged.

## Frontend changes

None.

## Backend changes

Add the domain contract, construction boundary, append port, PostgreSQL adapter, and migration only. Do not automatically audit login, logout, workspace creation, authorization reads, or database failures. Action-specific integration and atomic mutation/audit composition belong to the mutation that defines that action.

## Security requirements

- Fail closed on malformed inputs, dependency values, snapshots, JSON shapes, proxy/accessor/symbol/extraneous properties, database results, and row counts.
- Never accept or persist raw IP addresses, raw user-agent headers, credentials, tokens, cookies, session values, authorization headers, email addresses, URLs, content bodies, AI prompts/outputs, stack traces, SQL, or arbitrary provider payloads.
- Do not log audit inputs, events, rejected values, SQL parameters, or underlying failures.
- Audit events are not telemetry and cannot be reconstructed from logs.
- Tenant ownership is explicit through non-null `workspace_id`.
- Append-only means no public update/delete method and database-level rejection of mutation.
- Later business mutations must append in their transaction; this task must not create a misleading non-atomic integration.

## Edge cases

- User actor with null/mismatched actor field; system actor with a user ID.
- Event time equal to or before creation time; future event time.
- Empty/maximal changes, unchanged pairs, unsafe numbers, overlong/control-character strings, forbidden keys, and prototype-pollution keys.
- Proxies/revoked proxies and hostile getters/coercion/inspection/serialization hooks at every boundary.
- Duplicate event ID, missing workspace/user FK, malformed runtime database result, and database rejection.
- Attempted SQL update/delete/truncate and adapter surfaces containing no such operations.
- Same resource ID in different workspaces remains isolated by every future query index prefix.

## Acceptance criteria

1. The exact contract and closed values above are exported with fresh deep-frozen outputs.
2. Hostile validation executes no untrusted hooks and exposes no rejected data.
3. The construction boundary calls the clock once and ID generator once on success, with correct zero-call behavior on malformed input.
4. The adapter performs one parameterized insert, validates row count, sanitizes failures, and supports both database and transaction executors.
5. Real PostgreSQL proves schema constraints, tenant/actor foreign keys, indexes, append-only trigger behavior, and immutable stored rows.
6. `changes_json` round-trips only the approved scalar-change shape and cannot contain forbidden keys or unsafe values through the application adapter.
7. No API/OpenAPI/frontend/auth/authorization/product behavior changes.
8. Existing TASK-001 through TASK-007 tests remain passing.
9. Full verification passes on one exact final SHA with clean worktree and local/remote identity.

## Test plan

Run focused domain/application/adapter unit and adversarial tests; real-PostgreSQL migration, constraints, insert, tenant isolation, and immutability tests; then run:

1. `corepack pnpm install --frozen-lockfile`;
2. `corepack pnpm env:local`;
3. `docker compose config --quiet` with validation environment;
4. `corepack pnpm verify:infrastructure-pins`;
5. start pinned PostgreSQL and wait for health;
6. `corepack pnpm db:migrate:validate`;
7. `corepack pnpm test:integration`;
8. `corepack pnpm format:check`;
9. `corepack pnpm lint:boundaries`;
10. `corepack pnpm lint`;
11. `corepack pnpm typecheck`;
12. `corepack pnpm test`;
13. `corepack pnpm build`;
14. `corepack pnpm openapi:check`;
15. `corepack pnpm check`;
16. `corepack pnpm audit --prod --audit-level high`;
17. `corepack pnpm verify:trivy-exception`;
18. relevant pinned-image/Trivy/runtime-smoke gates already required by CI;
19. `git diff --check origin/main...HEAD`;
20. clean-checkout verification at the exact final SHA; and
21. final clean worktree plus local/remote/PR SHA agreement.

Report unavailable gates honestly. CI does not replace independent Codex review.

## Out of scope

- Audit list/read API, pagination, filters, UI, export, retention execution, or deletion bypass.
- Retrofitting existing authentication, tenancy, authorization, or workspace behavior.
- Outbox, jobs, queues, idempotency, telemetry/OpenTelemetry, or correlation middleware.
- Product, facts, AI, content, approvals, social OAuth, scheduling, publishing, analytics, or workers.
- Generic JSON payloads, encrypted secret auditing, raw request metadata, or database superuser policy.
- A second database, warehouse, event store, microservice, Kafka, CQRS, or event sourcing.
