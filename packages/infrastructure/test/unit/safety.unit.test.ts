import { describe, expect, it } from 'vitest';
import {
  assertDatabaseSafetyGuards,
  buildIsolatedDatabaseUrl,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  generateTestDatabaseName,
} from '../../src/database/migrations/safety.js';
import { DatabaseError } from '../../src/database/errors.js';
import {
  type TestAdminDatabaseConfig,
  TEST_DATABASE_DISPOSABLE_SENTINEL,
} from '@affiliate-content-os/config';

describe('Database safety guards and isolation policy (unit tests)', () => {
  const validAdminConfig: TestAdminDatabaseConfig = {
    testDatabaseAdminUrl: 'postgresql://admin:secret_password@127.0.0.1:5432/postgres',
    testDatabaseDisposable: TEST_DATABASE_DISPOSABLE_SENTINEL,
    connectionTimeoutMs: 5000,
    statementTimeoutMs: 15000,
    sslMode: 'disable',
  };

  const validTargetDb = 'acos_test_0123456789abcdef0123456789abcdef';

  it('generates test database names conforming strictly to regex', () => {
    for (let i = 0; i < 20; i++) {
      const name = generateTestDatabaseName();
      expect(name).toMatch(/^acos_test_[0-9a-f]{1,48}$/);
    }
  });

  it('builds isolated database url correctly', () => {
    const isolatedUrl = buildIsolatedDatabaseUrl(
      validAdminConfig.testDatabaseAdminUrl,
      validTargetDb,
    );
    expect(isolatedUrl).toBe(`postgresql://admin:secret_password@127.0.0.1:5432/${validTargetDb}`);
  });

  it('accepts valid test-admin configuration and target database in test environment', () => {
    expect(() =>
      assertDatabaseSafetyGuards(validAdminConfig, validTargetDb, { effectiveNodeEnv: 'test' }),
    ).not.toThrow();
  });

  it('rejects non-test environment without leaking environment name', () => {
    const invalidEnvs = ['development', 'production', 'staging', ''];
    for (const env of invalidEnvs) {
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(validAdminConfig, validTargetDb, { effectiveNodeEnv: env });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      const msg = (thrown as Error).message;
      expect(msg).toBe('Destructive test database operation rejected: invalid environment');
      if (env) {
        expect(msg).not.toContain(env);
      }
    }
  });

  it('rejects missing or invalid disposable confirmation without leaking sentinel', () => {
    const badConfig: TestAdminDatabaseConfig = {
      ...validAdminConfig,
      testDatabaseDisposable:
        'YES_I_CONFIRM' as unknown as typeof TEST_DATABASE_DISPOSABLE_SENTINEL,
    };

    let thrown: unknown;
    try {
      assertDatabaseSafetyGuards(badConfig, validTargetDb, { effectiveNodeEnv: 'test' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DatabaseError);
    const msg = (thrown as Error).message;
    expect(msg).toBe('Destructive test database operation rejected: missing required confirmation');
    expect(msg).not.toContain(TEST_DATABASE_DISPOSABLE_SENTINEL);
    expect(msg).not.toContain('YES_I_CONFIRM');
  });

  it('rejects invalid or non-postgres administrative URL protocol', () => {
    const badProtocols = [
      'mysql://admin:pass@127.0.0.1:5432/postgres',
      'http://admin:pass@127.0.0.1:5432/postgres',
      'not_a_url',
    ];

    for (const badUrl of badProtocols) {
      const config: TestAdminDatabaseConfig = {
        ...validAdminConfig,
        testDatabaseAdminUrl: badUrl,
      };
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(config, validTargetDb, { effectiveNodeEnv: 'test' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      expect((thrown as Error).message).toMatch(
        /Destructive test database operation rejected: invalid administrative URL/,
      );
      expect((thrown as Error).message).not.toContain(badUrl);
    }
  });

  it('rejects query parameters or hash fragments in administrative URL without leaking them', () => {
    const badUrls = [
      'postgresql://admin:pass@127.0.0.1:5432/postgres?sslmode=require&secret=123',
      'postgresql://admin:pass@127.0.0.1:5432/postgres#secret_fragment',
    ];

    for (const badUrl of badUrls) {
      const config: TestAdminDatabaseConfig = {
        ...validAdminConfig,
        testDatabaseAdminUrl: badUrl,
      };
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(config, validTargetDb, { effectiveNodeEnv: 'test' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      const msg = (thrown as Error).message;
      expect(msg).toBe(
        'Destructive test database operation rejected: administrative URL must not contain query parameters or fragments',
      );
      expect(msg).not.toContain('secret=123');
      expect(msg).not.toContain('secret_fragment');
    }
  });

  it('rejects missing credentials in administrative URL', () => {
    const badUrls = [
      'postgresql://127.0.0.1:5432/postgres',
      'postgresql://admin@127.0.0.1:5432/postgres',
    ];

    for (const badUrl of badUrls) {
      const config: TestAdminDatabaseConfig = {
        ...validAdminConfig,
        testDatabaseAdminUrl: badUrl,
      };
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(config, validTargetDb, { effectiveNodeEnv: 'test' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      expect((thrown as Error).message).toBe(
        'Destructive test database operation rejected: administrative URL credentials required',
      );
    }
  });

  it('rejects invalid administrative URL port without leaking port value', () => {
    const badPorts = ['0', '65536', '99999', 'invalid_port'];
    for (const port of badPorts) {
      const config: TestAdminDatabaseConfig = {
        ...validAdminConfig,
        testDatabaseAdminUrl: `postgresql://admin:pass@127.0.0.1:${port}/postgres`,
      };
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(config, validTargetDb, { effectiveNodeEnv: 'test' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      const msg = (thrown as Error).message;
      expect(msg).toMatch(
        /^Destructive test database operation rejected: invalid administrative URL( port)?$/,
      );
      expect(msg).not.toContain(port);
    }
  });

  it('rejects unpermitted host without leaking hostname', () => {
    const badHosts = ['production-db.internal', 'example.com', '192.168.1.100', '10.0.0.1'];
    for (const host of badHosts) {
      const config: TestAdminDatabaseConfig = {
        ...validAdminConfig,
        testDatabaseAdminUrl: `postgresql://admin:pass@${host}:5432/postgres`,
      };
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(config, validTargetDb, {
          effectiveNodeEnv: 'test',
          isCi: false,
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      const msg = (thrown as Error).message;
      expect(msg).toBe(
        'Destructive test database operation rejected: administrative host is not permitted for test execution',
      );
      expect(msg).not.toContain(host);
    }
  });

  it('permits postgres host only when isCi is true', () => {
    const ciConfig: TestAdminDatabaseConfig = {
      ...validAdminConfig,
      testDatabaseAdminUrl: 'postgresql://admin:pass@postgres:5432/postgres',
    };

    expect(() =>
      assertDatabaseSafetyGuards(ciConfig, validTargetDb, { effectiveNodeEnv: 'test', isCi: true }),
    ).not.toThrow();

    expect(() =>
      assertDatabaseSafetyGuards(ciConfig, validTargetDb, {
        effectiveNodeEnv: 'test',
        isCi: false,
      }),
    ).toThrow(
      'Destructive test database operation rejected: administrative host is not permitted for test execution',
    );
  });

  it('rejects non-postgres administrative database path without leaking path', () => {
    const badPaths = ['/acos_dev', '/mydb', '/production', ''];
    for (const path of badPaths) {
      const config: TestAdminDatabaseConfig = {
        ...validAdminConfig,
        testDatabaseAdminUrl: `postgresql://admin:pass@127.0.0.1:5432${path}`,
      };
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(config, validTargetDb, { effectiveNodeEnv: 'test' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      const msg = (thrown as Error).message;
      expect(msg).toBe(
        'Destructive test database operation rejected: administrative URL path must be strictly /postgres',
      );
      if (path && path !== '/') {
        expect(msg).not.toContain(path);
      }
    }
  });

  it('rejects invalid target database identifiers without leaking target name', () => {
    const badTargets = [
      'acos_dev',
      'test_db',
      'acos_test_UPPERCASE123',
      'acos_test_hyphen-not-allowed',
      'acos_test_;DROP TABLE test;--',
      'acos_test_',
      'acos_test_' + 'a'.repeat(49),
    ];

    for (const target of badTargets) {
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(validAdminConfig, target, { effectiveNodeEnv: 'test' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      const msg = (thrown as Error).message;
      expect(msg).toBe(
        'Destructive test database operation rejected: invalid target database identifier',
      );
      expect(msg).not.toContain(target);
    }
  });

  it('rejects protected database target names without leaking target name', () => {
    const protectedTargets = ['postgres', 'template0', 'template1'];
    for (const target of protectedTargets) {
      let thrown: unknown;
      try {
        assertDatabaseSafetyGuards(validAdminConfig, target, { effectiveNodeEnv: 'test' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(DatabaseError);
      const msg = (thrown as Error).message;
      expect(msg).toMatch(
        /Destructive test database operation rejected: (target is a protected system database|invalid target database identifier)/,
      );
      expect(msg).not.toContain(target);
    }
  });

  it('prevents database connection in createIsolatedDatabase and dropIsolatedDatabase when guards fail', async () => {
    const badConfig: TestAdminDatabaseConfig = {
      ...validAdminConfig,
      testDatabaseAdminUrl: 'postgresql://admin:pass@disallowed-host.com:5432/postgres',
    };

    await expect(
      createIsolatedDatabase(badConfig, validTargetDb, { effectiveNodeEnv: 'test' }),
    ).rejects.toThrow('administrative host is not permitted for test execution');

    await expect(
      dropIsolatedDatabase(badConfig, validTargetDb, { effectiveNodeEnv: 'test' }),
    ).rejects.toThrow('administrative host is not permitted for test execution');
  });
});
