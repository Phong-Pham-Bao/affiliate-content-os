---
title: TASK-004 Remediation 05 - Complete Query Boundary and Trusted DatabaseError Invariants
description: Close the two remaining findings from Codex review of TASK-004 at commit fcab00b3e35d2405db732b7dd1a58ee6f004c187
status: in_progress
priority: high
effort: 2
branch: agy/task-004-workspace-tenancy-core
tags: [tenancy, remediation, database-errors, transactions, postgres, error-invariants]
created: 2026-10-31
---

# TASK-004 Remediation 05 Plan

## Overview

Close the two remaining HIGH findings from Codex review of TASK-004 (`tasks/TASK-004-REMEDIATION-05.md`):

1. **Complete Query Lifecycle Safe Boundary**:
   - Wrap parameter copying, `client.query()` invocation, driver promise awaiting, `rows` access, row iteration, `rowCount` access, `command` access, result creation, and freezing in one `try/catch` boundary.
   - Any failure at any stage passes through `sanitizeDatabaseError()`, becomes sticky `firstQueryFailure`, rejects caller promise with safe `DatabaseError`, prohibits `COMMIT`, causes one rollback, and releases client once.
   - Retain in-flight registration and non-rejecting completion observer so unawaited rejections prevent unhandled rejections without silencing caller rejections.
   - Never use sibling callbacks of same `.then(success, failure)`.

2. **Trusted DatabaseError Invariants and Surface Closure**:
   - Establish module-private `WeakMap` recording trusted construction state: primitive safe message, safe code, original clean stack. Never store raw causes, SQL, bind values, or driver objects.
   - Validate branded errors without executing getters, proxies, coercion, serialization, or prototype hooks.
   - Replaced `DatabaseError.prototype.toJSON`, custom inspect, `toString`, modified stack (even non-URL), own keys, symbols, or accessors fail closed to fresh safe error.
   - Fresh safe error uses immutable safe prototype `SAFE_DATABASE_ERROR_PROTOTYPE` when prototype is tainted, preventing execution of hostile hooks. Never mutate caller error in place.

3. **Adversarial and Regression Tests**:
   - Unit tests covering rows getter throw, rows iterator throw, rowCount/command getter throw, proxy traps, awaited/unawaited variants, caught/uncaught variants, prior successful write followed by mapping failure, no COMMIT, rollback at most once, release exactly once, no unhandledRejection.
   - DatabaseError tests covering replaced toJSON, custom inspection, toString, non-URL hostile stack with SQL/bind/token sentinels, unexpected keys, symbols, accessors, prototype mutation, child process verification, and non-database business error semantics.

4. **Required Verification**:
   - Run all format, lint, boundary, typecheck, unit, integration, build, audit, trivy, and clean-checkout gates.
