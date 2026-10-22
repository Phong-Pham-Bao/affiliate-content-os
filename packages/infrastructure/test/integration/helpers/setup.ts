import { loadTestAdminDatabaseConfig } from '@affiliate-content-os/config';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  generateTestDatabaseName,
} from '../../../src/database/index.js';

export interface TestDatabaseContext {
  readonly dbName: string;
  readonly dbUrl: string;
  readonly adminUrl: string;
  readonly cleanup: () => Promise<void>;
}

export async function setupIsolatedTestDatabase(): Promise<TestDatabaseContext> {
  const adminConfig = loadTestAdminDatabaseConfig(process.env);
  const adminUrl = adminConfig.testDatabaseAdminUrl;
  const dbName = generateTestDatabaseName();

  const dbUrl = await createIsolatedDatabase(adminUrl, dbName);

  const cleanup = async (): Promise<void> => {
    await dropIsolatedDatabase(adminUrl, dbName);
  };

  return {
    dbName,
    dbUrl,
    adminUrl,
    cleanup,
  };
}
