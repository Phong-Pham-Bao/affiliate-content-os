import crypto from 'node:crypto';
import type { TestAdminDatabaseConfig } from '@affiliate-content-os/config';
import { TEST_DATABASE_DISPOSABLE_SENTINEL } from '@affiliate-content-os/config';
import pg from 'pg';
import { DatabaseError, sanitizeDatabaseError } from '../errors.js';
import { resolveSslOptions } from '../ssl.js';

const TARGET_DB_REGEX = /^acos_test_[0-9a-f]{1,48}$/;
const PROTECTED_DATABASES = new Set(['postgres', 'template0', 'template1']);

export function generateTestDatabaseName(): string {
  const suffix = crypto.randomUUID().replace(/-/g, '');
  return `acos_test_${suffix}`;
}

export interface DatabaseSafetyOptions {
  readonly effectiveNodeEnv: string;
  readonly isCi?: boolean | undefined;
  readonly sslCaContent?: string | undefined;
  readonly onDatabaseCreated?: (() => void) | undefined;
}

export function assertDatabaseSafetyGuards(
  config: TestAdminDatabaseConfig,
  targetDb: string,
  options: DatabaseSafetyOptions,
): void {
  if (options.effectiveNodeEnv !== 'test') {
    throw new DatabaseError(
      'Destructive test database operation rejected: invalid or missing NODE_ENV',
    );
  }

  if (
    !config ||
    typeof config !== 'object' ||
    config.testDatabaseDisposable !== TEST_DATABASE_DISPOSABLE_SENTINEL
  ) {
    throw new DatabaseError(
      'Destructive test database operation rejected: missing required confirmation',
    );
  }

  const adminUrl = config.testDatabaseAdminUrl;
  if (typeof adminUrl !== 'string' || adminUrl.trim() === '') {
    throw new DatabaseError(
      'Destructive test database operation rejected: invalid administrative URL',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new DatabaseError(
      'Destructive test database operation rejected: invalid administrative URL',
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new DatabaseError(
      'Destructive test database operation rejected: invalid administrative URL protocol',
    );
  }

  // Reject all query parameters and fragments
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new DatabaseError(
      'Destructive test database operation rejected: administrative URL must not contain query parameters or fragments',
    );
  }

  // Must have username and password
  if (!parsed.username || !parsed.password) {
    throw new DatabaseError(
      'Destructive test database operation rejected: administrative URL credentials required',
    );
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (
      !Number.isInteger(portNum) ||
      portNum < 1 ||
      portNum > 65535 ||
      String(portNum) !== parsed.port
    ) {
      throw new DatabaseError(
        'Destructive test database operation rejected: invalid administrative URL port',
      );
    }
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (options.isCi) {
    allowedHosts.add('postgres');
  }

  if (!allowedHosts.has(hostname)) {
    throw new DatabaseError(
      'Destructive test database operation rejected: administrative host is not permitted for test execution',
    );
  }

  if (parsed.pathname !== '/postgres') {
    throw new DatabaseError(
      'Destructive test database operation rejected: administrative URL path must be strictly /postgres',
    );
  }

  if (!TARGET_DB_REGEX.test(targetDb)) {
    throw new DatabaseError(
      'Destructive test database operation rejected: invalid target database identifier',
    );
  }

  const targetLower = targetDb.toLowerCase();
  if (PROTECTED_DATABASES.has(targetLower) || targetLower === 'postgres') {
    throw new DatabaseError(
      'Destructive test database operation rejected: target is a protected system database',
    );
  }
}

export function buildIsolatedDatabaseUrl(adminUrl: string, targetDb: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${targetDb}`;
  return parsed.toString();
}

export async function createIsolatedDatabase(
  config: TestAdminDatabaseConfig,
  targetDb: string,
  options: DatabaseSafetyOptions,
): Promise<string> {
  assertDatabaseSafetyGuards(config, targetDb, options);

  const adminUrl = config.testDatabaseAdminUrl;
  const ssl = resolveSslOptions(config.sslMode, options.sslCaContent);

  const client = new pg.Client({
    connectionString: adminUrl,
    ssl,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
  });

  try {
    await client.connect();
    // Quoted identifier is safe because targetDb is strictly validated against ^acos_test_[0-9a-f]{1,48}$
    await client.query(`CREATE DATABASE "${targetDb}";`);
    options.onDatabaseCreated?.();
    return buildIsolatedDatabaseUrl(adminUrl, targetDb);
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to create isolated test database');
  } finally {
    await client.end().catch(() => {});
  }
}

export async function dropIsolatedDatabase(
  config: TestAdminDatabaseConfig,
  targetDb: string,
  options: DatabaseSafetyOptions,
): Promise<void> {
  assertDatabaseSafetyGuards(config, targetDb, options);

  const adminUrl = config.testDatabaseAdminUrl;
  const ssl = resolveSslOptions(config.sslMode, options.sslCaContent);

  const client = new pg.Client({
    connectionString: adminUrl,
    ssl,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
  });

  try {
    await client.connect();
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [targetDb],
    );
    await client.query(`DROP DATABASE IF EXISTS "${targetDb}";`);
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to drop isolated test database');
  } finally {
    await client.end().catch(() => {});
  }
}
