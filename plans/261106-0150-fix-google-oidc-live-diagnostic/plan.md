---
title: 'TASK-009 Google OIDC Live Diagnostic and Remediation'
description: 'Add secret-safe internal diagnostic classification around authorizationCodeGrant, prevent provider error field leaks, and resolve live Google grant incompatibility'
status: 'completed'
priority: 'high'
effort: 'medium'
branch: 'main'
tags: ['auth', 'oidc', 'google', 'diagnostics', 'security']
created: '2026-11-06T01:50:00+07:00'
---

# Plan: TASK-009 Google OIDC Live Diagnostic & Remediation

## Overview

The callback reaches and consumes the transaction, but the live Google grant returns status invalid.
This plan adds a secret-safe diagnostic classification system for `authorizationCodeGrant`, logs strictly allowlisted categories and ResponseBodyError status/error, maps outcomes to 400/503 according to specification, adds adversarial non-leakage tests, and diagnoses and remediates the live Google grant incompatibility.

## Phases

1. [Phase 01: Diagnostic Classifier & Port Updates](./phase-01-diagnostic-classifier.md) — **COMPLETED**
   - Create modular `oidc-grant-diagnostic.ts` (closed categories, safe ResponseBodyError/ClientError mapping).
   - Update `OidcExchangeResult` in `ports.ts` to include `configuration_unavailable`.
   - Update `snapshotExchangeResult` and `completeOidcLogin` to handle 400/503 mapping.
2. [Phase 02: OIDC Adapter Integration](./phase-02-adapter-integration.md) — **COMPLETED**
   - Integrate diagnostic classifier in `OidcProtocolAdapter`.
   - Ensure `oidc-adapter.ts` remains strictly under 200 lines (modularized `oidc-adapter-discovery.ts`).
   - Pass diagnostic logger and classify token claims verification.
3. [Phase 03: Security & Hostile Input Tests](./phase-03-security-tests.md) — **COMPLETED**
   - Add unit tests proving hostile provider fields, secrets, stacks, headers, and bodies never reach logs (12 passing tests).
   - Test closed allowlisted diagnostic categories and error mapping.
4. [Phase 04: Live Google Login Diagnostic & Remediation](./phase-04-live-remediation.md) — **COMPLETED**
   - Secret-safe diagnostic logging active in `OidcProtocolAdapter`.
   - Remediated Google issuer equivalence (`https://accounts.google.com` vs `accounts.google.com`) and canonicalization.
   - All quality gates passed (`pnpm check`, `pnpm test:integration`, `pnpm db:migrate:validate`).
