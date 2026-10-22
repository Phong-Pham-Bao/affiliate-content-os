import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
  DEFAULT_DATABASE_IDLE_TIMEOUT_MS,
  DEFAULT_DATABASE_POOL_MAX,
  DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
  TEST_DATABASE_DISPOSABLE_SENTINEL,
  getRedactedDatabaseMetadata,
  loadDatabaseConfig,
  loadMigrationConfig,
  loadTestAdminDatabaseConfig,
} from '../src/index.js';

describe('Database configuration validation', () => {
  const validLoopbackUrl = 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev';
  const validAdminUrl = 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/postgres';

  describe('loadDatabaseConfig - happy paths and defaults', () => {
    it('loads valid configuration with defaults for loopback in development', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'development',
        DATABASE_URL: validLoopbackUrl,
      });

      expect(config.databaseUrl).toBe(validLoopbackUrl);
      expect(config.poolMax).toBe(DEFAULT_DATABASE_POOL_MAX);
      expect(config.connectionTimeoutMs).toBe(DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS);
      expect(config.idleTimeoutMs).toBe(DEFAULT_DATABASE_IDLE_TIMEOUT_MS);
      expect(config.statementTimeoutMs).toBe(DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS);
      expect(config.sslMode).toBe('disable');
      expect(config.sslCaFile).toBeUndefined();
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('accepts custom valid numeric boundaries and values', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'test',
        DATABASE_URL: validLoopbackUrl,
        DATABASE_POOL_MAX: '50',
        DATABASE_CONNECTION_TIMEOUT_MS: '60000',
        DATABASE_IDLE_TIMEOUT_MS: '300000',
        DATABASE_STATEMENT_TIMEOUT_MS: '300000',
      });

      expect(config.poolMax).toBe(50);
      expect(config.connectionTimeoutMs).toBe(60000);
      expect(config.idleTimeoutMs).toBe(300000);
      expect(config.statementTimeoutMs).toBe(300000);
    });

    it('accepts minimum numeric boundaries', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'test',
        DATABASE_URL: validLoopbackUrl,
        DATABASE_POOL_MAX: '1',
        DATABASE_CONNECTION_TIMEOUT_MS: '100',
        DATABASE_IDLE_TIMEOUT_MS: '1000',
        DATABASE_STATEMENT_TIMEOUT_MS: '100',
      });

      expect(config.poolMax).toBe(1);
      expect(config.connectionTimeoutMs).toBe(100);
      expect(config.idleTimeoutMs).toBe(1000);
      expect(config.statementTimeoutMs).toBe(100);
    });

    it('supports postgres: protocol alias, localhost, and IPv6 loopback', () => {
      const localhostConfig = loadDatabaseConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/my_db',
      });
      expect(localhostConfig.databaseUrl).toBe('postgres://user:pass@localhost:5432/my_db');

      const ipv6Config = loadDatabaseConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pass@[::1]:5432/my_db',
      });
      expect(ipv6Config.databaseUrl).toBe('postgresql://user:pass@[::1]:5432/my_db');
    });

    it('handles percent-encoded credentials safely', () => {
      const encodedUrl = 'postgresql://user%40domain:p%40ss%23word@127.0.0.1:5432/my_db';
      const config = loadDatabaseConfig({
        NODE_ENV: 'development',
        DATABASE_URL: encodedUrl,
      });
      expect(config.databaseUrl).toBe(encodedUrl);
    });

    it('filters unknown keys and preserves immutability', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'development',
        DATABASE_URL: validLoopbackUrl,
        EXTRA_SECRET: 'do_not_leak',
      });
      expect((config as unknown as Record<string, unknown>)['EXTRA_SECRET']).toBeUndefined();
      expect(() => {
        (config as unknown as { poolMax: number }).poolMax = 99;
      }).toThrow();
    });
  });

  describe('loadDatabaseConfig - input validation and failures', () => {
    it('rejects missing or non-record input', () => {
      expect(() => loadDatabaseConfig(undefined)).toThrow(ConfigurationError);
      expect(() => loadDatabaseConfig(null)).toThrow(ConfigurationError);
      expect(() => loadDatabaseConfig('DATABASE_URL=...')).toThrow(ConfigurationError);
      expect(() => loadDatabaseConfig([validLoopbackUrl])).toThrow(ConfigurationError);
    });

    it('rejects missing or empty DATABASE_URL', () => {
      expect(() => loadDatabaseConfig({ NODE_ENV: 'development' })).toThrow(ConfigurationError);
      expect(() => loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: '' })).toThrow(
        ConfigurationError,
      );
    });

    it('rejects invalid URL protocols and formats', () => {
      expect(() =>
        loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: 'http://localhost/db' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: 'mysql://localhost/db' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: 'not-a-url' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects URLs missing host or database name', () => {
      expect(() =>
        loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql:///db' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects URLs containing query parameters or fragment identifiers', () => {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost/db?sslmode=require',
        }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost/db#frag',
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects invalid numeric boundaries and formats', () => {
      const base = { NODE_ENV: 'development', DATABASE_URL: validLoopbackUrl };

      expect(() => loadDatabaseConfig({ ...base, DATABASE_POOL_MAX: '0' })).toThrow();
      expect(() => loadDatabaseConfig({ ...base, DATABASE_POOL_MAX: '51' })).toThrow();
      expect(() => loadDatabaseConfig({ ...base, DATABASE_POOL_MAX: '-5' })).toThrow();
      expect(() => loadDatabaseConfig({ ...base, DATABASE_POOL_MAX: '10.5' })).toThrow();
      expect(() => loadDatabaseConfig({ ...base, DATABASE_POOL_MAX: '1e2' })).toThrow();
      expect(() => loadDatabaseConfig({ ...base, DATABASE_POOL_MAX: ' 10 ' })).toThrow();
      expect(() => loadDatabaseConfig({ ...base, DATABASE_POOL_MAX: 'ten' })).toThrow();

      expect(() => loadDatabaseConfig({ ...base, DATABASE_CONNECTION_TIMEOUT_MS: '99' })).toThrow();
      expect(() =>
        loadDatabaseConfig({ ...base, DATABASE_CONNECTION_TIMEOUT_MS: '60001' }),
      ).toThrow();

      expect(() => loadDatabaseConfig({ ...base, DATABASE_IDLE_TIMEOUT_MS: '999' })).toThrow();
      expect(() => loadDatabaseConfig({ ...base, DATABASE_IDLE_TIMEOUT_MS: '300001' })).toThrow();

      expect(() => loadDatabaseConfig({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: '99' })).toThrow();
      expect(() =>
        loadDatabaseConfig({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: '300001' }),
      ).toThrow();
    });
  });

  describe('SSL mode policy', () => {
    it('rejects disable mode against non-loopback host in development/test', () => {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://user:pass@db.internal:5432/acos_dev',
          DATABASE_SSL_MODE: 'disable',
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects disable mode and missing mode in production', () => {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'production',
          DATABASE_URL: validLoopbackUrl,
          DATABASE_SSL_MODE: 'disable',
        }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'production',
          DATABASE_URL: validLoopbackUrl,
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects unsupported SSL modes (require, prefer, allow, etc.)', () => {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'development',
          DATABASE_URL: validLoopbackUrl,
          DATABASE_SSL_MODE: 'require',
        }),
      ).toThrow(ConfigurationError);
    });

    it('requires absolute CA file path when verify-full', () => {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:pass@db.internal:5432/acos_prod',
          DATABASE_SSL_MODE: 'verify-full',
        }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:pass@db.internal:5432/acos_prod',
          DATABASE_SSL_MODE: 'verify-full',
          DATABASE_SSL_CA_FILE: 'relative/path/ca.pem',
        }),
      ).toThrow(ConfigurationError);

      const absolutePath = process.platform === 'win32' ? 'C:\\certs\\ca.pem' : '/etc/ssl/ca.pem';
      const config = loadDatabaseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.internal:5432/acos_prod',
        DATABASE_SSL_MODE: 'verify-full',
        DATABASE_SSL_CA_FILE: absolutePath,
      });
      expect(config.sslMode).toBe('verify-full');
      expect(config.sslCaFile).toBe(absolutePath);
    });

    it('rejects CA file when mode is disable', () => {
      const absolutePath = process.platform === 'win32' ? 'C:\\certs\\ca.pem' : '/etc/ssl/ca.pem';
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'development',
          DATABASE_URL: validLoopbackUrl,
          DATABASE_SSL_MODE: 'disable',
          DATABASE_SSL_CA_FILE: absolutePath,
        }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('loadMigrationConfig', () => {
    it('loads valid migration config with loopback url', () => {
      const config = loadMigrationConfig({
        NODE_ENV: 'development',
        MIGRATION_DATABASE_URL: validLoopbackUrl,
      });

      expect(config.migrationDatabaseUrl).toBe(validLoopbackUrl);
      expect(config.sslMode).toBe('disable');
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('rejects when MIGRATION_DATABASE_URL is missing', () => {
      expect(() =>
        loadMigrationConfig({
          NODE_ENV: 'development',
          DATABASE_URL: validLoopbackUrl,
        }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('loadTestAdminDatabaseConfig', () => {
    it('loads valid test admin config with sentinel and /postgres path', () => {
      const config = loadTestAdminDatabaseConfig({
        NODE_ENV: 'test',
        TEST_DATABASE_ADMIN_URL: validAdminUrl,
        TEST_DATABASE_DISPOSABLE: TEST_DATABASE_DISPOSABLE_SENTINEL,
      });

      expect(config.testDatabaseAdminUrl).toBe(validAdminUrl);
      expect(config.testDatabaseDisposable).toBe(TEST_DATABASE_DISPOSABLE_SENTINEL);
      expect(config.sslMode).toBe('disable');
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('rejects when TEST_DATABASE_DISPOSABLE does not match exact literal', () => {
      expect(() =>
        loadTestAdminDatabaseConfig({
          NODE_ENV: 'test',
          TEST_DATABASE_ADMIN_URL: validAdminUrl,
          TEST_DATABASE_DISPOSABLE: 'yes',
        }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadTestAdminDatabaseConfig({
          NODE_ENV: 'test',
          TEST_DATABASE_ADMIN_URL: validAdminUrl,
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects when admin URL does not point to /postgres database', () => {
      expect(() =>
        loadTestAdminDatabaseConfig({
          NODE_ENV: 'test',
          TEST_DATABASE_ADMIN_URL: 'postgresql://acos_local:pass@127.0.0.1:5432/acos_dev',
          TEST_DATABASE_DISPOSABLE: TEST_DATABASE_DISPOSABLE_SENTINEL,
        }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('Non-disclosure and Redaction', () => {
    it('never echoes database URL, password, or sentinel in error issues or message', () => {
      const secretPass = 'super_secret_pwd_xyz123';
      const secretUrl = `postgresql://user:${secretPass}@invalid host/db?secret=1`;

      let error: ConfigurationError | undefined;
      try {
        loadDatabaseConfig({
          NODE_ENV: 'development',
          DATABASE_URL: secretUrl,
          TEST_DATABASE_DISPOSABLE: 'secret_wrong_sentinel',
        });
      } catch (err) {
        if (err instanceof ConfigurationError) {
          error = err;
        }
      }

      expect(error).toBeDefined();
      const serialized = JSON.stringify(error?.toJSON());
      expect(serialized).not.toContain(secretPass);
      expect(serialized).not.toContain('invalid host');
      expect(serialized).not.toContain('secret=1');
      expect(error?.message).not.toContain(secretPass);
    });

    it('redacts database URL and origins from diagnostic metadata', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'development',
        DATABASE_URL: validLoopbackUrl,
      });

      const redacted = getRedactedDatabaseMetadata(config);
      expect(redacted.hasDatabaseUrl).toBe(true);
      expect(redacted.poolMax).toBe(10);
      expect(redacted.sslMode).toBe('disable');
      expect(redacted.hasSslCaFile).toBe(false);

      const serialized = JSON.stringify(redacted);
      expect(serialized).not.toContain('acos_local');
      expect(serialized).not.toContain('acos_local_only');
      expect(serialized).not.toContain('127.0.0.1');
      expect(serialized).not.toContain('acos_dev');
    });
  });
});
