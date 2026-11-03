# Phase 03: Mandatory Transaction-Scoped User Lookup

## Context

- `packages/application/src/auth/ports.ts`
- `packages/application/src/auth/authenticate-session.ts`
- `packages/application/src/auth/authenticate-session-types.ts`
- `apps/api/src/auth/me-route.ts`
- Test fakes and test suites

## Key Implementation Steps

1. Make `SessionStorePort.findUserById(userId: string): Promise<UserSnapshot | null>` mandatory in `packages/application/src/auth/ports.ts`.
2. Remove `userDirectory?: UserDirectoryPort` from `AuthenticateSessionDependencies` in `packages/application/src/auth/authenticate-session-types.ts`.
3. In `authenticateApplicationSession`:
   - Require and call `txStore.findUserById(parsedUserId)` strictly on the transaction store passed to `withTransaction`.
   - Remove any fallback to `deps.userDirectory`.
4. Remove `userDirectory` dependency passing in `apps/api/src/auth/me-route.ts`.
5. Update test fakes (`createMockAuthDeps`, unit test fakes) to implement `findUserById` directly on `sessionStore`.
