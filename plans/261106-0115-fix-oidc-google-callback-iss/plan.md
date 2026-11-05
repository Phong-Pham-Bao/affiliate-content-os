---
title: 'Fix Google OIDC Callback Issuer Parameter Handling (RFC 9207)'
description: 'Preserve and validate authorization response iss parameter from OIDC callbacks through route, application, snapshots, and openid-client adapter'
status: 'completed'
priority: 'high'
effort: 'medium'
branch: 'main'
tags: ['auth', 'oidc', 'google', 'rfc9207', 'security']
created: '2026-11-06T01:15:00+07:00'
---

# Plan: Fix Google OIDC Callback Issuer Parameter Handling

## Overview

Google OIDC discovery declares `authorization_response_iss_parameter_supported=true`.
Per RFC 9207, Google callback provides `iss=https://accounts.google.com`.
The callback pipeline must preserve this parameter, validate it, pass it to `openid-client`,
and classify missing/mismatched `iss` as 400 `OIDC_CALLBACK_INVALID` while keeping network
failures as 503 `OIDC_PROVIDER_UNAVAILABLE`.

## Phases

1. [Phase 01: API & Schema Layer](./phase-01-api-schema.md)
   - Allowlist `iss` in Fastify route schema and update OpenAPI schema.
   - Update `callback-url-parser.ts` to validate and extract `iss` for code and denial responses.
2. [Phase 02: Application Core & Boundary](./phase-02-application-core.md)
   - Update `complete-oidc-login-query.ts` to accept and validate `iss`.
   - Update `OidcProtocolPort` interface to accept optional `iss`.
   - Pass `iss` through `completeOidcLogin` to `exchangeCodeAndValidateIdToken`.
3. [Phase 03: Infrastructure OIDC Adapter](./phase-03-infrastructure-adapter.md)
   - Update `OidcProtocolAdapter.exchangeCodeAndValidateIdToken` to attach `iss` to callback URL.
   - Distinguish protocol validation errors (`status: 'invalid'`) from network/server failures (`status: 'unavailable'`).
4. [Phase 04: Tests & Verification](./phase-04-tests-verification.md)
   - Route tests with Google-shaped parameters including `iss`.
   - Rejection tests for duplicate/raw-percent-encoded `iss`, control characters, oversized `iss`.
   - Adapter tests for valid issuer, missing issuer, mismatched issuer, network failure, 500 error.
   - Adapter test verifying callback issuer reaches `authorizationCodeGrant` validation.
   - Full quality-gate execution: format, lint, boundary check, typecheck, unit tests, integration tests.
