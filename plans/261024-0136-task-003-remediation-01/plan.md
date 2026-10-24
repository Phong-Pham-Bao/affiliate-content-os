---
title: 'TASK-003-REMEDIATION-01: Persistence Foundation Review Remediation'
description: 'Implementation of approved remediation for TASK-003 findings: Trivy CVE-2025-68121 exception, falsy transaction rejections, credential redaction, integration NODE_ENV guards, composition root ownership, worker shutdown deadline, and README privilege clarification.'
status: complete
priority: P1
effort: 4h
branch: agy/task-003-persistence-foundation
tags:
  - database
  - security
  - remediation
  - trivy
  - transaction
  - lifecycle
created: 2026-10-24
---

# TASK-003-REMEDIATION-01 Plan

## Phase Overview

- [x] **Phase 1: Narrow Time-Bounded Trivy Exception & Policy Validator**
  - Add `.trivyignore.yaml` with exact `usr/local/bin/gosu` path, `CVE-2025-68121`, expiry `2026-12-31`.
  - Add `security/exceptions/TASK-003-CVE-2025-68121-GOSU.md` with complete formal fields.
  - Add `scripts/verify-trivy-exception.mjs` and `verify:trivy-exception` script in `package.json`.
  - Update `.github/workflows/ci.yml` to run validator and pass `--ignorefile .trivyignore.yaml --show-suppressed`.
- [x] **Phase 2: Falsy Transaction Rejection Preservation**
  - Replace truthiness check with explicit boolean discriminant in `database.ts`.
  - Support `undefined`, `null`, `false`, `0`, `NaN`, `''` rejections and resolutions.
- [x] **Phase 3: Credential Sanitization in Errors and Stacks**
  - Replace raw driver error in `scripts/infra-up.mjs` with allowlisted classification.
  - Sanitize `message` and `stack` consistently in transaction errors and `DatabaseError`.
- [x] **Phase 4: Strict Integration Safety Guard (NODE_ENV)**
  - Remove `?? 'test'` in `setup.ts`. Fail closed if `effectiveNodeEnv` is missing or not `'test'`.
  - Identify `NODE_ENV` as missing/invalid in error message without leaking sentinels.
- [x] **Phase 5: Composition Root Ownership for API & Worker**
  - Make `database` required in `startApiServer` and `startWorker`.
  - Remove `databaseConfig`, environment fallback, and CA loading from `server.ts` and `runner.ts`.
- [x] **Phase 6: Worker Deadline Expiry Unconditionally Nonzero**
  - Terminate with code 1 on cleanup failure or deadline expiry, even if abort was signaled.
- [x] **Phase 7: README Privilege Claim Correction**
  - Document that local development reuses bootstrap superuser, distinct from production least privilege.
- [x] **Phase 8: Regression Tests & Full Verification**
  - Add unit and integration regression tests for all findings.
  - Run all required verification commands and record actual outputs.
