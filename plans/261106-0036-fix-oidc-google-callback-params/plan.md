---
title: Fix Google OIDC Callback Blocker (RFC 6749 Unrecognized Parameter Handling)
description: Safely ignore bounded unrecognized OAuth response parameters in OIDC callback while preserving strict URL validation, core field isolation, and security invariants.
status: complete
priority: high
effort: small
branch: main
tags:
  - auth
  - oidc
  - rfc6749
  - google-oidc
  - task-009
created: 2026-11-06T00:36:00.000Z
---

# Plan: Fix Google OIDC Callback Blocker

## Overview

Fix TASK-009 Checkpoint A blocker where Google's OIDC callback returns `scope`, `authuser`, `prompt`, and optionally `hd`, causing `parseAndValidateRawCallback` to reject the callback with `OIDC_CALLBACK_INVALID` before transaction consumption.

Per RFC 6749, the client must ignore unrecognized response parameters. The fix safely ignores bounded unrecognized parameters, continues strict validation of URL encoding, duplicates, control characters, bounds, and code/error mutual exclusivity, and passes only the allowlisted core fields (`code`, `state`, `error`, `error_description`, `error_uri`) into `completeOidcLogin`.

## Phases

- [x] Phase 1: RFC 6749 callback URL parser implementation & modularization
- [x] Phase 2: Google-shaped route integration, regression & rejection test suite
- [x] Phase 3: Verification (unit, boundaries, types, OpenAPI) & report generation
