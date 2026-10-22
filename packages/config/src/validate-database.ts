import { ConfigurationError, type ConfigurationIssue } from './errors.js';
import {
  ALLOWED_NODE_ENVS,
  DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
  DEFAULT_DATABASE_IDLE_TIMEOUT_MS,
  DEFAULT_DATABASE_POOL_MAX,
  DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
  TEST_DATABASE_DISPOSABLE_SENTINEL,
  type DatabaseConfig,
  type MigrationConfig,
  type NodeEnv,
  type TestAdminDatabaseConfig,
} from './types.js';
import {
  validateDatabaseUrl,
  validateInteger,
  validateSslConfig,
} from './validate-database-common.js';

function validateRecord(rawEnv: unknown): Record<string, unknown> {
  if (
    rawEnv === undefined ||
    rawEnv === null ||
    typeof rawEnv !== 'object' ||
    Array.isArray(rawEnv)
  ) {
    throw new ConfigurationError([
      {
        field: 'environment',
        message: 'Environment must be a plain object record',
      },
    ]);
  }
  return rawEnv as Record<string, unknown>;
}

function resolveNodeEnv(envRecord: Record<string, unknown>): NodeEnv | undefined {
  const val = envRecord['NODE_ENV'];
  if (typeof val === 'string' && (ALLOWED_NODE_ENVS as readonly string[]).includes(val)) {
    return val as NodeEnv;
  }
  return undefined;
}

export function loadDatabaseConfig(rawEnv?: unknown): DatabaseConfig {
  const env = validateRecord(rawEnv);
  const issues: ConfigurationIssue[] = [];
  const nodeEnv = resolveNodeEnv(env);

  const databaseUrl = validateDatabaseUrl(env['DATABASE_URL'], 'DATABASE_URL', issues);
  const poolMax = validateInteger(
    env['DATABASE_POOL_MAX'],
    'DATABASE_POOL_MAX',
    1,
    50,
    DEFAULT_DATABASE_POOL_MAX,
    issues,
  );
  const connectionTimeoutMs = validateInteger(
    env['DATABASE_CONNECTION_TIMEOUT_MS'],
    'DATABASE_CONNECTION_TIMEOUT_MS',
    100,
    60000,
    DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
    issues,
  );
  const idleTimeoutMs = validateInteger(
    env['DATABASE_IDLE_TIMEOUT_MS'],
    'DATABASE_IDLE_TIMEOUT_MS',
    1000,
    300000,
    DEFAULT_DATABASE_IDLE_TIMEOUT_MS,
    issues,
  );
  const statementTimeoutMs = validateInteger(
    env['DATABASE_STATEMENT_TIMEOUT_MS'],
    'DATABASE_STATEMENT_TIMEOUT_MS',
    100,
    300000,
    DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
    issues,
  );

  const { sslMode, sslCaFile } = validateSslConfig(env, nodeEnv, [databaseUrl], issues);

  if (issues.length > 0 || !databaseUrl) {
    throw new ConfigurationError(issues);
  }

  const config: DatabaseConfig = {
    databaseUrl,
    poolMax,
    connectionTimeoutMs,
    idleTimeoutMs,
    statementTimeoutMs,
    sslMode,
    ...(sslCaFile ? { sslCaFile } : {}),
  };

  return Object.freeze(config);
}

export function loadMigrationConfig(rawEnv?: unknown): MigrationConfig {
  const env = validateRecord(rawEnv);
  const issues: ConfigurationIssue[] = [];
  const nodeEnv = resolveNodeEnv(env);

  const migrationDatabaseUrl = validateDatabaseUrl(
    env['MIGRATION_DATABASE_URL'],
    'MIGRATION_DATABASE_URL',
    issues,
  );
  const connectionTimeoutMs = validateInteger(
    env['DATABASE_CONNECTION_TIMEOUT_MS'],
    'DATABASE_CONNECTION_TIMEOUT_MS',
    100,
    60000,
    DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
    issues,
  );
  const statementTimeoutMs = validateInteger(
    env['DATABASE_STATEMENT_TIMEOUT_MS'],
    'DATABASE_STATEMENT_TIMEOUT_MS',
    100,
    300000,
    DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
    issues,
  );

  const { sslMode, sslCaFile } = validateSslConfig(env, nodeEnv, [migrationDatabaseUrl], issues);

  if (issues.length > 0 || !migrationDatabaseUrl) {
    throw new ConfigurationError(issues);
  }

  const config: MigrationConfig = {
    migrationDatabaseUrl,
    connectionTimeoutMs,
    statementTimeoutMs,
    sslMode,
    ...(sslCaFile ? { sslCaFile } : {}),
  };

  return Object.freeze(config);
}

export function loadTestAdminDatabaseConfig(rawEnv?: unknown): TestAdminDatabaseConfig {
  const env = validateRecord(rawEnv);
  const issues: ConfigurationIssue[] = [];
  const nodeEnv = resolveNodeEnv(env);

  const testDatabaseAdminUrl = validateDatabaseUrl(
    env['TEST_DATABASE_ADMIN_URL'],
    'TEST_DATABASE_ADMIN_URL',
    issues,
    { requireAdminPostgresDb: true },
  );

  const disposable = env['TEST_DATABASE_DISPOSABLE'];
  if (disposable !== TEST_DATABASE_DISPOSABLE_SENTINEL) {
    issues.push({
      field: 'TEST_DATABASE_DISPOSABLE',
      message: `Must be exactly ${TEST_DATABASE_DISPOSABLE_SENTINEL}`,
    });
  }

  const connectionTimeoutMs = validateInteger(
    env['DATABASE_CONNECTION_TIMEOUT_MS'],
    'DATABASE_CONNECTION_TIMEOUT_MS',
    100,
    60000,
    DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
    issues,
  );
  const statementTimeoutMs = validateInteger(
    env['DATABASE_STATEMENT_TIMEOUT_MS'],
    'DATABASE_STATEMENT_TIMEOUT_MS',
    100,
    300000,
    DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
    issues,
  );

  const { sslMode, sslCaFile } = validateSslConfig(env, nodeEnv, [testDatabaseAdminUrl], issues);

  if (issues.length > 0 || !testDatabaseAdminUrl) {
    throw new ConfigurationError(issues);
  }

  const config: TestAdminDatabaseConfig = {
    testDatabaseAdminUrl,
    testDatabaseDisposable: TEST_DATABASE_DISPOSABLE_SENTINEL,
    connectionTimeoutMs,
    statementTimeoutMs,
    sslMode,
    ...(sslCaFile ? { sslCaFile } : {}),
  };

  return Object.freeze(config);
}
