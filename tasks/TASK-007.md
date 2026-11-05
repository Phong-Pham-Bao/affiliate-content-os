# TASK-007 - Workspace Authorization Policy Boundary

Status: Approved by Product Owner

Approval basis: The Product Owner explicitly authorized Codex on 2026-11-05 to define, approve, and deliver TASK-007 from the accepted repository roadmap. This specification is limited to the next smallest remaining Sprint 1 slice.

## Objective

Implement a reusable, provider-neutral workspace authorization boundary that:

1. accepts an authenticated application user, a workspace, and one closed workspace capability;
2. resolves the caller's active membership through a workspace-and-user-scoped port;
3. applies the approved `owner`, `editor`, and `viewer` role matrix;
4. returns a minimal immutable authorization context on success; and
5. fails closed without revealing whether another workspace, user, or membership exists.

This task completes the role-authorization primitive required by Sprint 1. It does not add workspace CRUD, membership mutation, audit storage, product behavior, or a public HTTP endpoint.

## Context

TASK-004 established users, workspaces, memberships, fixed roles, PostgreSQL tenant isolation, and `WorkspacePersistencePort.findMembership({ workspaceId, userId })`. TASK-005 established verified identity provisioning. TASK-006 added managed OIDC login, opaque sessions, and the authenticated current-user boundary.

The remaining Sprint 1 roadmap items are role authorization and audit primitives. The architecture requires tenant requests to authenticate, resolve active workspace membership, authorize the action, and keep repository queries workspace-scoped. The product role matrix is already approved. The smallest safe next slice is the authorization policy and application boundary; audit primitives remain a later task because no authorized mutation is introduced here.

Governing decisions:

- `docs/PRODUCT.md` section 5 defines the role matrix.
- `docs/ARCHITECTURE.md` sections 6, 14, 15, and 17 require route/use-case/repository enforcement, tenant scoping, fail-closed security, and non-disclosing authorization failures.
- `docs/DATABASE.md` defines active membership, fixed roles, and unique `(workspace_id, user_id)` membership.
- ADR-006 requires workspace scoping and role enforcement without custom RBAC/ABAC.

## Required implementation

### 1. Closed capability policy in the domain package

Add a domain authorization module exporting the exact closed capability values below:

- `workspace.read`
- `workspace.manage`
- `workspace.delete_export`
- `members.read`
- `members.manage`
- `social_accounts.manage`
- `catalog.read`
- `catalog.manage`
- `content.read`
- `content.manage`
- `content.approve`
- `publications.read`
- `publications.manage`
- `analytics.read`
- `audit.read`

Export the readonly tuple, the derived `WorkspaceCapability` type, a primitive-only type guard, and one pure authorization function:

```ts
canWorkspaceRole(role: WorkspaceRole, capability: WorkspaceCapability): boolean
```

The matrix is exact:

- `viewer`: `workspace.read`, `members.read`, `catalog.read`, `content.read`, `publications.read`, `analytics.read`, and `audit.read`.
- `editor`: every viewer capability plus `catalog.manage`, `content.manage`, `content.approve`, and `publications.manage`.
- `owner`: every capability.

Unknown roles and capabilities must never be coerced or treated as allowed. The implementation must use an explicit closed policy, not string prefixes, ordinal comparisons, caller-supplied arrays, configurable expressions, or a general RBAC/ABAC engine.

### 2. Narrow application port

Add `WorkspaceAuthorizationPort` rather than making the authorization use case depend on the full workspace persistence interface:

```ts
interface WorkspaceAuthorizationPort {
  findMembership(params: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
  }): Promise<WorkspaceMembershipSnapshot | null>;
}
```

`PostgresTenancyAdapter` may satisfy this port structurally. Do not duplicate its query or create a second authorization-specific SQL adapter unless an actual incompatibility is demonstrated.

The existing query must remain scoped by both `workspace_id` and `user_id` and must return only active membership. Authorization must never query by membership ID, workspace slug, email, identity subject, session ID, or role alone.

### 3. Application authorization use case

Add one use case with an exact input and result contract:

```ts
interface AuthorizeWorkspaceActionInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly capability: WorkspaceCapability;
}

interface WorkspaceAuthorizationContext {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly membershipId: MembershipId;
  readonly role: WorkspaceRole;
  readonly capability: WorkspaceCapability;
}

authorizeWorkspaceAction(
  input: AuthorizeWorkspaceActionInput,
  deps: { readonly authorization: WorkspaceAuthorizationPort },
): Promise<WorkspaceAuthorizationContext>
```

Validation and execution order is mandatory:

1. Reject a proxy, revoked proxy, non-object, array, class instance, inherited object, accessor-backed property, symbol key, extra key, missing key, or non-enumerable own property in the input. Writable/configurable descriptor flags do not affect authorization and may be either state so frozen caller DTOs remain valid.
2. Read only captured own data-descriptor values.
3. Require canonical lowercase UUIDv7 strings for `workspaceId` and `userId`.
4. Require `capability` to be an exact primitive member of the closed capability tuple.
5. Call `findMembership` exactly once with only the validated branded IDs.
6. Safely validate the returned value before reading any field for authorization.
7. Require an exact immutable-safe membership snapshot whose `workspaceId` and `userId` equal the request, `status` is exactly `active`, role is closed, IDs/timestamps/version are canonical, timestamp ordering is valid, and `version` is a safe integer at least one.
8. Apply `canWorkspaceRole`.
9. Return a fresh frozen context containing only the five approved fields.

No clock, ID generator, database transaction, cache, HTTP request, cookie, session token, logger, telemetry client, or audit writer belongs in this use case.

### 4. Fail-closed persistence-result validation

Treat the port result as untrusted runtime data even though TypeScript types describe it.

Before any ordinary property access, reject proxies and revoked proxies without executing their traps. Accept only `null` or an exact plain/null-prototype object with these own enumerable data properties and no symbols or extras. Writable/configurable flags may be either state because infrastructure returns frozen snapshots:

- `id`
- `workspaceId`
- `userId`
- `role`
- `status`
- `invitedByUserId`
- `joinedAt`
- `createdAt`
- `updatedAt`
- `version`

Validate values from captured descriptors only:

- all required IDs are canonical UUIDv7 strings;
- `invitedByUserId` is `null` or canonical UUIDv7;
- `role` is exactly `owner`, `editor`, or `viewer`;
- `status` is exactly `active`;
- `joinedAt` is `null` or a canonical UTC ISO timestamp;
- `createdAt` and `updatedAt` are canonical UTC ISO timestamps;
- `createdAt <= updatedAt`;
- when `joinedAt` is present, `createdAt <= joinedAt <= updatedAt`;
- `version` is a primitive safe integer greater than or equal to one; and
- returned `workspaceId` and `userId` match the validated input exactly.

Do not coerce values, enumerate hostile inputs before proxy rejection, invoke getters, call user-controlled `toString`, `valueOf`, `toJSON`, iterators, or custom inspection hooks, or attach a raw value to an error.

### 5. Fixed safe errors

Add fixed application errors with no arbitrary public message parameter:

- `WorkspaceAuthorizationInputError` with code `WORKSPACE_AUTHORIZATION_INPUT_INVALID` and fixed message `Invalid workspace authorization input`.
- `WorkspaceAccessDeniedError` with code `WORKSPACE_ACCESS_DENIED` and fixed message `Workspace access denied`.
- `WorkspaceAuthorizationPersistenceError` with code `WORKSPACE_AUTHORIZATION_PERSISTENCE_INVALID`, fixed message `Workspace authorization persistence error`, and fixed operation `membership_lookup`.

Error behavior:

- malformed input uses `WorkspaceAuthorizationInputError` and makes zero port calls;
- `null`, inactive, input-mismatched, or role-insufficient membership uses a fresh `WorkspaceAccessDeniedError`;
- a malformed runtime persistence value uses a fresh `WorkspaceAuthorizationPersistenceError`;
- a port rejection or an exception during safe result classification becomes a fresh `WorkspaceAuthorizationPersistenceError`;
- no error may expose workspace/user/membership IDs, role, capability, SQL, bind values, database metadata, URLs, credentials, sentinels, or the original error through properties, cause, message, stack, stringification, JSON, inspection, logging, stdout, or stderr.

The original rejection must never be attached as `cause` or otherwise retained on a public error.

### 6. Exports and dependency direction

Export the domain policy/types from `packages/domain` and the use case, port, context, and fixed errors from `packages/application`.

Preserve dependency direction:

- domain imports no application, infrastructure, or app code;
- application depends only on domain and its own ports;
- infrastructure implements the application port and does not own policy decisions;
- apps do not receive a new route in this task.

Generated declarations must expose only the approved closed types and fixed constructors. No arbitrary message or metadata parameter may appear.

## Expected files

Expected production changes:

- `packages/domain/src/authorization.ts`
- `packages/domain/src/index.ts`
- `packages/application/src/authorize-workspace-action.ts`
- `packages/application/src/ports.ts`
- `packages/application/src/errors.ts`
- `packages/application/src/index.ts`

Expected tests:

- domain policy unit tests;
- application authorization unit/adversarial tests;
- focused infrastructure integration assertions proving the existing adapter's active, workspace-and-user-scoped membership lookup, only if existing tests do not already provide independent proof;
- declaration/boundary/non-disclosure tests where required.

Do not change a listed file when no change is necessary. Any production file outside this list requires Codex approval before implementation.

## Database changes

No migration, table, column, index, constraint, seed, or database role change.

Use the existing `workspace_memberships` schema and existing scoped lookup. Real-PostgreSQL tests must prove:

- membership from workspace A cannot authorize workspace B;
- user A cannot use user B's membership;
- suspended/removed membership is not returned as active authorization;
- each role is mapped without coercion; and
- unknown/malformed database rows fail safely through existing mapper guarantees.

## API changes

None. Do not add or modify HTTP routes, OpenAPI paths/schemas, status mappings, cookies, authentication middleware, CORS, CSRF, or rate limits.

The authorization boundary will be consumed by later tenant routes. `corepack pnpm openapi:check` must remain unchanged and pass.

## Frontend changes

None. UI hiding is not authorization and no role-based UI behavior is added.

## Backend changes

Add only the domain policy and application authorization boundary described above. Reuse the existing membership lookup through the narrow port. Do not add a transaction or audit event because this task performs no mutation.

## Security requirements

- Fail closed on every unknown role, capability, membership state, malformed snapshot, dependency failure, proxy, accessor, symbol, or unexpected key.
- Never infer access from workspace visibility, email, identity-provider data, session existence, a caller-supplied role, or possession of an ID.
- Do not reveal cross-tenant existence or distinguish missing workspace from missing membership in public errors.
- Validate tenant identity at the application boundary and scope persistence lookup by both workspace and user.
- Do not log raw authorization input, persistence values, errors, SQL, or bind parameters.
- Do not add authorization caches, bypasses, fallback roles, wildcard capabilities, superusers, impersonation, custom roles, or feature-flag overrides.
- Tests must verify no hostile getter/proxy/serialization/inspection hook executes and no sentinel reaches any output surface.

## Edge cases

- Same user belongs to multiple workspaces with different roles.
- Same capability is allowed for one role and denied for another.
- Viewer read capabilities succeed; viewer mutation capabilities fail.
- Editor management capabilities succeed except owner-only workspace/member/social/delete-export operations.
- Owner receives all closed capabilities but no unknown capability.
- Membership becomes suspended or removed between authentication and authorization.
- Port returns `null`, a mismatched tenant/user, inactive status, unknown role, malformed IDs/timestamps/version, extra/symbol/accessor properties, proxy, or revoked proxy.
- Port throws a primitive, proxy, raw driver error, credential-bearing error, or object with hostile hooks.
- Input contains uppercase/noncanonical UUID, inherited keys, sparse/array shape, boxed primitives, or an unknown capability.

## Acceptance criteria

1. The exact closed capability tuple and role matrix match this specification and `docs/PRODUCT.md`.
2. Authorization uses one workspace-and-user-scoped active-membership lookup and no broader persistence interface.
3. Malformed input fails before any port call.
4. Missing, inactive, mismatched, or insufficient membership never authorizes and does not disclose tenant existence.
5. Every successful result is a fresh frozen five-field context with no persistence metadata.
6. Hostile inputs, results, and rejections execute no untrusted hooks and produce only fresh fixed safe errors.
7. Tests cover every role-capability cell, cross-tenant/user isolation, inactive membership, all validation failures, port call counts, and non-disclosure surfaces.
8. Existing TASK-001 through TASK-006 behavior remains passing.
9. No database, API, OpenAPI, frontend, authentication/session, audit, product, AI, social, scheduling, or publishing behavior is added.
10. Full verification passes on one exact final SHA with clean local/remote/PR identity.

## Test plan

Add meaningful tests and run:

1. focused domain policy matrix tests;
2. focused application use-case tests for success, denial, call order/count, hostile runtime values, and error non-disclosure;
3. focused tenancy adapter unit and real-PostgreSQL isolation tests;
4. `corepack pnpm install --frozen-lockfile`;
5. `corepack pnpm env:local`;
6. `docker compose config --quiet` with validation environment;
7. `corepack pnpm verify:infrastructure-pins`;
8. start pinned PostgreSQL and wait for health;
9. `corepack pnpm db:migrate:validate`;
10. `corepack pnpm test:integration`;
11. `corepack pnpm format:check`;
12. `corepack pnpm lint:boundaries`;
13. `corepack pnpm lint`;
14. `corepack pnpm typecheck`;
15. `corepack pnpm test`;
16. `corepack pnpm build`;
17. `corepack pnpm openapi:check`;
18. `corepack pnpm check`;
19. `corepack pnpm audit --prod --audit-level high`;
20. `corepack pnpm verify:trivy-exception`;
21. pinned PostgreSQL manifest-list inspection;
22. both required Trivy scans and the expected-failing no-ignore negative control;
23. compiled API and worker runtime smokes;
24. infrastructure shutdown in `finally`;
25. `git diff --check origin/main...HEAD`;
26. external clean-checkout verification at the exact final SHA; and
27. final clean worktree plus exact local/remote/PR SHA agreement.

Report every skipped or unavailable gate honestly. CI success is evidence but does not replace independent review.

## Out of scope

- Audit tables/events/history, observability, correlation IDs, or logs.
- Workspace or membership CRUD, invitations, role/status mutation, last-owner enforcement, workspace settings, deletion, or export.
- Any public HTTP route, middleware registration, OpenAPI change, frontend screen, or role-based UI hiding.
- Products, facts, media, AI, content, approval, social OAuth, scheduling, publishing, analytics, workers, queues, or outbox behavior.
- Custom roles, ABAC, policy engines, wildcard permissions, superusers, impersonation, row-level security, or authorization caches.
- OIDC/session changes, step-up/recent-authentication policy, CSRF, CORS, rate limits, or identity-provider behavior.
- Database schema or dependency changes.
