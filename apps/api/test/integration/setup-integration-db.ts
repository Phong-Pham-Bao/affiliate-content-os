import {
  setupIsolatedTestDatabase,
  type TestDatabaseContext,
} from '@affiliate-content-os/infrastructure/testing';

export type { TestDatabaseContext };

export async function setupIntegrationDatabase(): Promise<TestDatabaseContext> {
  return setupIsolatedTestDatabase();
}
