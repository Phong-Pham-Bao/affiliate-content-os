import crypto from 'node:crypto';
import pg from 'pg';
import { DatabaseError } from '../errors.js';

const DISPOSABLE_SENTINEL = 'YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED';
const TARGET_DB_REGEX = /^acos_test_[0-9a-f]{1,48}$/;
const PROTECTED_DATABASES = new Set(['postgres', 'template0', 'template1']);

export function generateTestDatabaseName(): string {
  const suffix = crypto.randomUUID().replace(/-/g, '');
  return `acos_test_${suffix}`;
}

export function assertDatabaseSafetyGuards(adminUrl: string, targetDb: string): void {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new DatabaseError(
      `Destructive test database operation rejected: NODE_ENV must be exactly 'test', but got '${process.env['NODE_ENV']}'`,
    );
  }

  if (process.env['TEST_DATABASE_DISPOSABLE'] !== DISPOSABLE_SENTINEL) {
    throw new DatabaseError(
      `Destructive test database operation rejected: TEST_DATABASE_DISPOSABLE must be '${DISPOSABLE_SENTINEL}'`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new DatabaseError('Destructive test database operation rejected: invalid admin URL');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new DatabaseError(
      'Destructive test database operation rejected: protocol must be postgresql or postgres',
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (process.env['CI'] === 'true' || process.env['CI'] === '1') {
    allowedHosts.add('postgres');
  }

  if (!allowedHosts.has(hostname)) {
    throw new DatabaseError(
      `Destructive test database operation rejected: host '${hostname}' is not in allowed loopback/CI test hosts`,
    );
  }

  if (parsed.pathname !== '/postgres') {
    throw new DatabaseError(
      'Destructive test database operation rejected: admin URL path must be strictly /postgres',
    );
  }

  if (!TARGET_DB_REGEX.test(targetDb)) {
    throw new DatabaseError(
      `Destructive test database operation rejected: target database name '${targetDb}' does not match pattern ^acos_test_[0-9a-f]{1,48}$`,
    );
  }

  if (PROTECTED_DATABASES.has(targetDb.toLowerCase())) {
    throw new DatabaseError(
      `Destructive test database operation rejected: target '${targetDb}' is a protected system database`,
    );
  }
}

export function buildIsolatedDatabaseUrl(adminUrl: string, targetDb: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${targetDb}`;
  return parsed.toString();
}

export async function createIsolatedDatabase(
  adminUrl: string,
  targetDb: string,
  ssl: boolean | pg.ConnectionConfig['ssl'] = false,
): Promise<string> {
  assertDatabaseSafetyGuards(adminUrl, targetDb);

  const client = new pg.Client({ connectionString: adminUrl, ssl });
  await client.connect();
  try {
    // Quoted identifier is safe because targetDb is strictly validated against ^acos_test_[0-9a-f]{1,48}$
    await client.query(`CREATE DATABASE "${targetDb}";`);
    return buildIsolatedDatabaseUrl(adminUrl, targetDb);
  } finally {
    await client.end();
  }
}

export async function dropIsolatedDatabase(
  adminUrl: string,
  targetDb: string,
  ssl: boolean | pg.ConnectionConfig['ssl'] = false,
): Promise<void> {
  assertDatabaseSafetyGuards(adminUrl, targetDb);

  const client = new pg.Client({ connectionString: adminUrl, ssl });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) 
       FROM pg_stat_activity 
       WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [targetDb],
    );
    await client.query(`DROP DATABASE IF EXISTS "${targetDb}";`);
  } finally {
    await client.end();
  }
}
