# Phase 06: Workspace Roles Enum & OpenAPI

## Context Links

- [schemas.ts](../../apps/api/src/auth/schemas.ts)
- [ports.ts](../../packages/application/src/auth/ports.ts)
- [openapi.json](../../openapi/openapi.json)

## Overview

- Priority: HIGH
- Status: Pending
- Goal: Align response schema with approved workspace roles enum `['owner', 'editor', 'viewer']` and regenerate OpenAPI.

## Requirements

- Response schema for `/api/v1/me` declares `role: { enum: ['owner', 'editor', 'viewer'] }`.
- Committed OpenAPI artifact matches runtime schemas.

## Implementation Steps

1. Update `schemas.ts` line 129 enum to `['owner', 'editor', 'viewer']`.
2. Run `pnpm openapi:generate` to regenerate `openapi/openapi.json`.
3. Verify with `pnpm openapi:check`.
