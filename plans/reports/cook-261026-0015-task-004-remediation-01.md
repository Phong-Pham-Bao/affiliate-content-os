# Implementation Report: TASK-004 Remediation 01

**Date:** 2026-10-26
**Task:** TASK-004 Remediation 01 (`tasks/TASK-004-REMEDIATION-01.md`)
**Status:** Completed
**Branch:** `agy/task-004-workspace-tenancy-core`

---

## 1. Root Causes and Fixes for the Five Codex Findings

### Finding 1: Broad Uniqueness Failure Mapping in Tenancy Adapter

- **Severity**: HIGH
- **Root Cause**: Uniqueness violations were translated into `SlugConflictError` based only on PostgreSQL error code `23505` without checking the constraint name, or using broad fallback logic at the outer transaction boundary. This meant non-slug uniqueness conflicts (such as duplicate primary keys, duplicate memberships, or external identity collisions) could be falsely mapped to `SlugConflictError`.
- **Fix**:
  - Implemented exception-safe and proxy-safe predicate `isSlugConflictError(error)` checking `(code === '23505' || code === 'UNIQUE_VIOLATION') && constraint === 'workspaces_slug_unique'`.
  - Stored sanitized constraint name on `DatabaseError` (`readonly constraint?: string | undefined`) in `sanitizeDatabaseError` without exposing sensitive values or invoking hostile prototype hooks.
  - Applied the exact same predicate consistently at both the workspace-insert catch block and the outer transaction catch block.
  - All non-slug unique violations pass through as safe `DatabaseError` instances.

### Finding 2: Permissive `aiEnabled` Coercion

- **Severity**: MEDIUM
- **Root Cause**: `aiEnabled` was defaulted via loose truthiness/boolean coercion after or without strict runtime type validation, allowing non-boolean values (such as strings, numbers, objects) across the untrusted boundary or calling dependencies prior to input validation.
- **Fix**:
  - Added strict runtime validation in `createWorkspace` before any dependency call (user directory lookup, clock access, ID generation, or persistence):
    - Accepts only `undefined` (defaulting to `false`), boolean `false`, and boolean `true`.
    - Every other runtime value (`null`, strings like `'true'`, `'false'`, numbers `0`, `1`, arrays, objects, functions, symbols, bigint) throws typed `ValidationError` for field `aiEnabled`.

### Finding 3: Mutable `Date` Snapshot Timestamps

- **Severity**: HIGH
- **Root Cause**: Snapshot types (`UserSnapshot`, `WorkspaceSnapshot`, `WorkspaceMembershipSnapshot`) exposed mutable JavaScript `Date` objects. Consumers could mutate stored timestamps (`.setFullYear(...)`) or share mutable state across snapshots.
- **Fix**:
  - Defined branded immutable primitive type `IsoTimestamp` in `packages/domain/src/timestamps.ts`.
  - Enforced RFC 3339 canonical UTC string representation: `YYYY-MM-DDTHH:mm:ss.sssZ` with exact round-trip validation through `new Date(value).toISOString()`.
  - Exported `IsoTimestamp`, `isValidIsoTimestamp`, `parseIsoTimestamp`, and `dateToIsoTimestamp` from domain package.
  - Application layer reads clock `Date` exactly once, validates it, and converts to `IsoTimestamp` before assigning to snapshots. Snapshots are sealed with `Object.freeze`.
  - Infrastructure tenancy row mappers convert PostgreSQL timestamps (Date or string) to `IsoTimestamp`, rejecting unparseable or non-canonical timestamps with `DatabaseError`.

### Finding 4: Permissive Timezone Canonicalization

- **Severity**: MEDIUM
- **Root Cause**: `Intl.DateTimeFormat` accepts legacy aliases (e.g. `US/Eastern`) that resolve to canonical zones but do not match standard modern canonical sets, leading to non-deterministic or non-standard timezone identifiers.
- **Fix**:
  - Constructed the accepted timezone oracle strictly from `Intl.supportedValuesOf('timeZone')`.
  - Unioned the three explicitly approved non-canonical/omitted identifiers: `UTC`, `Etc/UTC`, and `Asia/Ho_Chi_Minh`.
  - Enforced case-sensitive exact membership; rejected legacy aliases (`US/Eastern`), abbreviations (`EST`, `PST`, `ICT`), Windows names, case variants, and offsets.

### Finding 5: Incomplete Real-PostgreSQL Schema Proof

- **Severity**: MEDIUM
- **Root Cause**: `tenancy-schema.integration.test.ts` only performed positive insertion tests and did not independently verify negative constraints, check constraints, enum values, catalog index column order, foreign key non-cascading behavior, or blocked deletions.
- **Fix**:
  - Expanded `tenancy-schema.integration.test.ts` to 56 tests covering:
    - `users`: duplicate `(identity_provider, identity_subject)`, empty/whitespace-only provider and subject, invalid status, version `<= 0`, and `updated_at < created_at`.
    - `workspaces`: duplicate slug, invalid slug patterns (uppercase, leading/trailing hyphens, repeated hyphens, whitespace, Unicode, punctuation), empty/whitespace name and timezone, invalid status, version `<= 0`, and `updated_at < created_at`.
    - `workspace_memberships`: duplicate `(workspace_id, user_id)`, duplicate primary key, invalid role, invalid status, active membership with null `joined_at`, version `<= 0`, `updated_at < created_at`, and missing foreign keys (`workspace_id`, `user_id`, `invited_by_user_id`).
    - Catalog inspection: verified exact column orders for `idx_workspace_memberships_user_workspace` `(user_id, workspace_id)` and `idx_workspace_memberships_workspace_status` `(workspace_id, status)`.
    - Foreign key actions: verified catalog delete action `r` (RESTRICT) / `a` (NO ACTION) and behaviorally confirmed that deleting referenced workspace or user rows is blocked while memberships reference them.
    - Relation isolation: verified that only `schema_migrations`, `users`, `workspaces`, and `workspace_memberships` exist in the public schema.

---

## 2. Exact Files Changed

### Created

- `packages/domain/src/timestamps.ts`
- `packages/domain/test/timestamps.unit.test.ts`
- `plans/261025-2351-task-004-remediation-01/plan.md`
- `plans/reports/cook-261026-0015-task-004-remediation-01.md`

### Modified

- `packages/domain/src/index.ts`
- `packages/domain/src/types.ts`
- `packages/domain/src/validation.ts`
- `packages/domain/test/validation.unit.test.ts`
- `packages/application/src/create-workspace.ts`
- `packages/application/test/create-workspace.unit.test.ts`
- `packages/infrastructure/src/database/errors.ts`
- `packages/infrastructure/src/tenancy/mappers.ts`
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`
- `packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts`
- `packages/infrastructure/test/integration/tenancy-adapter.integration.test.ts`
- `packages/infrastructure/test/integration/tenancy-schema.integration.test.ts`

---

## 3. Regression Tests Added

1. **Exact Constraint Mapping**:
   - `packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts`:
     - `maps workspaces_slug_unique to SlugConflictError at workspace insert boundary`
     - `does not map workspaces_pkey to SlugConflictError`
     - `does not map workspace_memberships_pkey to SlugConflictError`
     - `does not map workspace_memberships_workspace_user_unique to SlugConflictError`
     - `does not map users_identity_provider_subject_unique to SlugConflictError`
     - `does not map 23505 with missing, non-string, or unsafe constraint to SlugConflictError`
     - `does not map non-unique database errors to SlugConflictError`
     - `maps slug conflict thrown in transaction through outer boundary`
     - `does not map outer unique violation without exact slug constraint to SlugConflictError`
   - `packages/infrastructure/test/integration/tenancy-adapter.integration.test.ts`:
     - Real-PostgreSQL duplicate membership error test verifying it produces `DatabaseError`, not `SlugConflictError`.

2. **Strict `aiEnabled` Validation**:
   - `packages/application/test/create-workspace.unit.test.ts`:
     - Matrix of invalid runtime values (`null`, `0`, `1`, `""`, `"true"`, `"false"`, `[]`, `{}`, `Symbol()`, `10n`, `() => {}`) verifying each throws `ValidationError` for `aiEnabled`.
     - Dependency call assertions confirming zero calls to user directory, clock, ID generator, and persistence on invalid `aiEnabled`.

3. **Immutable Snapshots and Timestamps**:
   - `packages/domain/test/timestamps.unit.test.ts`:
     - 20 unit tests verifying canonical UTC string validation, regex matching, instant parsing, exact round-trip, invalid strings, non-canonical strings, and Date conversion.
   - `packages/application/test/create-workspace.unit.test.ts`:
     - Verified `createdAt`, `updatedAt`, and `joinedAt` are immutable strings.
     - Verified mutating clock Date does not affect snapshot values.
     - Verified `Object.isFrozen` and attempted modification throws.
     - Verified invalid clock Date fails cleanly before persistence.
   - `packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts`:
     - Verified row mappers convert Date and string driver inputs to canonical `IsoTimestamp`.
     - Verified unparseable and non-canonical driver timestamp inputs throw `DatabaseError`.

4. **Timezone Canonization**:
   - `packages/domain/test/validation.unit.test.ts`:
     - Verified acceptance of `UTC`, `Etc/UTC`, `Asia/Ho_Chi_Minh`, and representative canonical zones across continents (`America/New_York`, `Europe/London`, `Asia/Tokyo`, `Australia/Sydney`).
     - Verified rejection of legacy alias `US/Eastern`, abbreviations (`EST`, `PST`, `ICT`), Windows names (`Eastern Standard Time`), case variants (`utc`, `UTC+7`), fixed offsets (`+07:00`), and non-string values.

5. **Schema Negative and Structure Tests**:
   - `packages/infrastructure/test/integration/tenancy-schema.integration.test.ts`:
     - 56 integration tests executing against isolated real-PostgreSQL databases for all negative constraints, catalog index orders, foreign-key blocking actions, and table isolation.
