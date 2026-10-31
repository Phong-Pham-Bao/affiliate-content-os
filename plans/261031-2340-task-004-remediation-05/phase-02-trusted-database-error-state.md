# Phase 02: Trusted DatabaseError Invariants

## Context Links

- tasks/TASK-004-REMEDIATION-05.md
- packages/infrastructure/src/database/errors.ts
- packages/infrastructure/src/database/sanitization.ts

## Overview

Status: planned
Priority: high

Establish module-private trusted construction state for genuine `DatabaseError` instances and close all prototype and stack mutation surfaces.

## Implementation Steps

1. Create `TRUSTED_CONSTRUCTION_STATE = new WeakMap<object, TrustedConstructionState>()` storing `{ safeMessage, safeCode, originalStack }`.
2. Capture original prototype methods immediately at module load time: `ORIGINAL_TO_JSON`, `ORIGINAL_CUSTOM_INSPECT`, `ORIGINAL_TO_STRING`, `ORIGINAL_CONSTRUCTOR`, `ORIGINAL_ERROR_TO_STRING`.
3. Create immutable `SAFE_DATABASE_ERROR_PROTOTYPE` with non-writable properties bound to original methods and frozen with `Object.freeze`.
4. In `DatabaseError` constructor:
   - Record only credential-safe primitive message, approved safe code, and stripped initial stack in `TRUSTED_CONSTRUCTION_STATE`.
5. In `sanitizeDatabaseError`:
   - Validate branded error against `TRUSTED_CONSTRUCTION_STATE`.
   - Validate prototype clean status: functions must strictly equal original function references.
   - Validate that `stack` matches `trusted.originalStack`. Any change to stack fails closed to a fresh error.
   - Validate own keys, symbols, accessors without executing getters.
   - If tainted: construct fresh safe `DatabaseError` using trusted primitive state. If prototype is tainted, set prototype to `SAFE_DATABASE_ERROR_PROTOTYPE`.
   - Never mutate caller-owned error in place.
