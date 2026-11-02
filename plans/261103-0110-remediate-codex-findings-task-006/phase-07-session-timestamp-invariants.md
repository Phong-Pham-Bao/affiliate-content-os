# Phase 07: Session Timestamp Database Constraints

## Context Links

- [0003_application_auth.sql](../../packages/infrastructure/migrations/0003_application_auth.sql)
- [mappers.ts](../../packages/infrastructure/src/auth/mappers.ts)
- [auth-schema.integration.test.ts](../../packages/infrastructure/test/integration/auth-schema.integration.test.ts)

## Overview

- Priority: HIGH
- Status: Pending
- Goal: Database-enforce and application-validate `absolute_expires_at >= idle_expires_at >= last_seen_at >= rotated_at >= created_at`.

## Requirements

- Migration 0003 checks `idle_expires_at >= last_seen_at`, `last_seen_at >= rotated_at`, `rotated_at >= created_at`, `idle_expires_at <= absolute_expires_at`, `absolute_expires_at > created_at`.
- `mapSessionRow` validates every timestamp relationship.
- Database rejects rows violating these relationships.

## Implementation Steps

1. Update constraint `application_sessions_timestamps_order_check` in `0003_application_auth.sql`.
2. Update `mapSessionRow` in `mappers.ts` to validate all timestamp relationships.
3. Add migration and schema tests asserting rejection of inconsistent timelines.
