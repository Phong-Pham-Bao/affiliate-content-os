# Implementation Report: TASK-004 Remediation 02

**Date:** 2026-10-26
**Task:** TASK-004 Remediation 02 (`tasks/TASK-004-REMEDIATION-02.md`)
**Status:** Completed
**Branch:** `agy/task-004-workspace-tenancy-core`

---

## 1. Root Causes and Fixes for Both Codex Findings

### Finding 1: Untrusted PostgreSQL Constraint Payloads on Public DatabaseError Surfaces

- **Severity**: HIGH
- **Root Cause**:
  1. `DatabaseError` exposed a public `readonly constraint?: string | undefined` property and allowed `constraint` in constructor options, `toJSON()`, and `util.inspect.custom`.
  2. `sanitizeDatabaseError` attempted to copy the raw driver error's `constraint` string property onto the public `DatabaseError`, allowing hostile or sensitive constraint text (e.g. database credentials, hostnames, SQL text) to leak into serialization, logging, inspection, and process output.
  3. `TransactionExecutor.query` caught driver errors and called `sanitizeDatabaseError` at the query execution level, converting driver errors into public `DatabaseError` objects before transaction callbacks could inspect them. This caused the tenancy adapter to rely on a broad outer fallback checking sanitized errors, rather than keeping exact classification private to the adapter.
- **Fix**:
  1. Removed `readonly constraint?: string | undefined` and constructor options from `DatabaseError`. Removed `constraint` from `DatabaseError.toJSON()` and `util.inspect.custom`.
  2. Updated `sanitizeDatabaseError` so it never copies, attaches, or serializes raw constraint metadata.
  3. Preserved safe exception/descriptor-based checking (`isSlugConflictError(err)`) private to the tenancy adapter, checking only `code === '23505' && constraint === 'workspaces_slug_unique'`.
  4. Removed query-level catch/wrapping in `TransactionExecutor.query` so raw driver errors reach the adapter's inner catch within the transaction where the adapter owns the error and privately classifies `workspaces_slug_unique` into `SlugConflictError`. Unmatched errors re-throw to be cleanly sanitized by `withTransaction` and the adapter outer catch.
  5. Removed broad outer fallback from `PostgresTenancyAdapter.createWorkspaceWithAdmin`. Any pre-existing `SlugConflictError` passes through by identity; all other errors fail closed to safe generic `DatabaseError`.

### Finding 2: Permissive Silent Canonicalization of Noncanonical Timestamp Strings

- **Severity**: MEDIUM
- **Root Cause**:
  1. `mapRowTimestamp` in `packages/infrastructure/src/tenancy/mappers.ts` took any string timestamp and executed `new Date(value).toISOString()`.
  2. JavaScript's `Date.parse` accepts noncanonical formats (e.g., missing milliseconds `'2026-10-25T12:00:00Z'`, space separators `'2026-10-25 12:00:00+00'`, lowercase `'z'`, numeric epoch strings, etc.) and silently converts them into canonical ISO 8601 UTC strings.
  3. This violated the requirement that string timestamp inputs from untrusted boundaries must be validated strictly as received before any conversion.
- **Fix**:
  1. Rewrote `mapRowTimestamp` to distinguish genuine `Date` inputs from string inputs.
  2. String inputs are passed directly to `parseIsoTimestamp(value)` without `new Date()`, `Date.parse()`, `toISOString()`, trimming, or normalization. Only exact canonical strings matching `YYYY-MM-DDTHH:mm:ss.sssZ` and round-tripping identically are accepted; noncanonical strings throw `DatabaseError` without reflecting raw input values.
  3. Valid `Date` inputs are converted via `.toISOString()`, validated through `parseIsoTimestamp`, and returned as immutable strings without retaining mutable `Date` references. Invalid `Date` objects fail closed to `DatabaseError`.
  4. The helper is applied uniformly across all timestamp fields: `UserSnapshot` (`created_at`, `updated_at`), `WorkspaceSnapshot` (`created_at`, `updated_at`), and `WorkspaceMembershipSnapshot` (`joined_at`, `created_at`, `updated_at`).

---

## 2. Exact Files Changed

### Modified

- `packages/infrastructure/src/database/errors.ts`: Removed `constraint` property, options, JSON/inspect serialization, and sanitized copying from `DatabaseError`.
- `packages/infrastructure/src/database/database.ts`: Removed query-level catch in `TransactionExecutor.query` to let raw errors reach adapter-owned inner catch while preserving `withTransaction` rollback and outer sanitization.
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`: Removed broad outer fallback; preserves `SlugConflictError` passthrough while failing closed to safe `DatabaseError`.
- `packages/infrastructure/src/tenancy/mappers.ts`: Strictly validates string timestamps as received via `parseIsoTimestamp`; independently converts valid `Date` objects.
- `packages/infrastructure/test/unit/errors.unit.test.ts`: Added tests verifying absence of `constraint` property/options/JSON/inspect, and verifying hostile constraint sentinels are completely omitted across all observable surfaces including child-process execution.
- `packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts`: Added table-driven regression tests for all timestamp fields across 27 noncanonical cases and valid canonical cases; added tests for adapter-private classification and outer catch.

### Created

- `plans/261026-0115-task-004-remediation-02/plan.md`
- `plans/reports/cook-261026-0130-task-004-remediation-02.md`

---

## 3. Regression Tests

1. **Hostile Constraint & DatabaseError Surface Tests** (`packages/infrastructure/test/unit/errors.unit.test.ts`):
   - Verified `DatabaseError` has no `constraint` property (`expect('constraint' in err).toBe(false)`).
   - Verified constructor options ignore `constraint`.
   - Verified `toJSON()` and `util.inspect` contain no `constraint`.
   - Tested hostile constraint sentinels containing postgresql URL, password, host, database, SQL statements, bind sentinels, newlines, and stack traces. Verified total absence from:
     - `Object.keys`
     - `Reflect.ownKeys`
     - `JSON.stringify`
     - `String(err)` / `err.message`
     - `util.inspect`
     - Child process stdout/stderr
   - Verified `sanitizeDatabaseError` never attaches raw constraint metadata.

2. **Adapter-Private Constraint Classification Tests** (`packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts`):
   - Inner workspace-insert boundary:
     - Exact `23505` + `workspaces_slug_unique` -> `SlugConflictError`.
     - Exact `UNIQUE_VIOLATION` + `workspaces_slug_unique` -> `SlugConflictError`.
     - Hostile constraints, unknown constraints (`workspaces_pkey`, `workspace_memberships_pkey`, etc.) -> safe `DatabaseError`.
     - Missing, non-string, or accessor-backed code/constraint -> safe `DatabaseError`.
   - Outer transaction boundary:
     - Pre-existing `SlugConflictError` passes through by identity.
     - Ambiguous unique errors without pre-classified slug conflict fail closed to `DatabaseError`.

3. **Canonical Timestamp Matrix Tests** (`packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts`):
   - Matrix across all 7 timestamp fields:
     - `UserSnapshot.created_at`
     - `UserSnapshot.updated_at`
     - `WorkspaceSnapshot.created_at`
     - `WorkspaceSnapshot.updated_at`
     - `WorkspaceMembershipSnapshot.joined_at`
     - `WorkspaceMembershipSnapshot.created_at`
     - `WorkspaceMembershipSnapshot.updated_at`
   - Tested 27 noncanonical / invalid cases:
     - Missing milliseconds (`2026-10-25T12:00:00Z`)
     - Space-separated form (`2026-10-25 12:00:00+00`)
     - Explicit `+00:00` offset (`2026-10-25T12:00:00.000+00:00`)
     - Non-zero timezone offset (`2026-10-25T12:00:00.000+07:00`)
     - Lowercase `z` (`2026-10-25T12:00:00.000z`)
     - Extra fractional precision (`2026-10-25T12:00:00.1234Z`)
     - Shortened fractional precision (`2026-10-25T12:00:00.12Z`)
     - Surrounding whitespace (e.g. `' 2026-10-25T12:00:00.000Z '`)
     - Date-only strings (`2026-10-25`)
     - Numeric epoch strings (`1761480000000`)
     - Invalid dates/times (`2026-02-30T12:00:00.000Z`, `not-a-timestamp`)
     - Non-string/non-Date values (`12345`, `true`, `{}`, `[]`, `null`)
   - Verified each throws `DatabaseError` and leaks none of the rejected input through error properties, inspection, or child process.
   - Tested canonical strings (`2026-10-25T12:00:00.000Z`) and genuine `Date` inputs, returning immutable strings without retaining mutable references.
   - Verified nullable `joinedAt` remains `null`.
