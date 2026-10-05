import util from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LOG_LEVELS,
  ALLOWED_NODE_ENVS,
  ConfigurationError,
  DEFAULT_LOG_LEVEL,
  getRedactedConfigMetadata,
  loadConfig,
  type AppConfig,
} from '../src/index.js';

describe('packages/config - loadConfig', () => {
  it('parses minimal valid configuration with default LOG_LEVEL', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe(DEFAULT_LOG_LEVEL);
    expect(config.appBaseUrl).toBeUndefined();
  });

  it('parses each allowed NODE_ENV', () => {
    for (const env of ALLOWED_NODE_ENVS) {
      const config = loadConfig({ NODE_ENV: env });
      expect(config.nodeEnv).toBe(env);
    }
  });

  it('parses each allowed LOG_LEVEL', () => {
    for (const level of ALLOWED_LOG_LEVELS) {
      const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: level });
      expect(config.logLevel).toBe(level);
    }
  });

  it('parses valid APP_BASE_URL in development and test modes', () => {
    const devConfig = loadConfig({
      NODE_ENV: 'development',
      APP_BASE_URL: 'http://localhost:3000',
    });
    expect(devConfig.appBaseUrl).toBe('http://localhost:3000');

    const testConfig = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'https://test.example.com',
    });
    expect(testConfig.appBaseUrl).toBe('https://test.example.com');
  });

  it('parses valid HTTPS APP_BASE_URL in production mode', () => {
    const prodConfig = loadConfig({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://affiliate.example.com',
    });
    expect(prodConfig.nodeEnv).toBe('production');
    expect(prodConfig.appBaseUrl).toBe('https://affiliate.example.com');
  });

  it('rejects HTTP APP_BASE_URL in production mode', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        APP_BASE_URL: 'http://insecure.example.com',
      }),
    ).toThrow(ConfigurationError);

    try {
      loadConfig({
        NODE_ENV: 'production',
        APP_BASE_URL: 'http://insecure.example.com',
      });
    } catch (err) {
      const cfgErr = err as ConfigurationError;
      expect(cfgErr.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'APP_BASE_URL',
            message: 'Must use https protocol in production',
          }),
        ]),
      );
    }
  });

  it('rejects http://localhost in production mode while allowing it in development and test', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        APP_BASE_URL: 'http://localhost:3000',
      }),
    ).toThrow(ConfigurationError);

    const dev = loadConfig({
      NODE_ENV: 'development',
      APP_BASE_URL: 'http://localhost:3000',
    });
    expect(dev.appBaseUrl).toBe('http://localhost:3000');

    const test = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3000',
    });
    expect(test.appBaseUrl).toBe('http://localhost:3000');
  });

  it('rejects missing, null, array, and non-record input with ConfigurationError', () => {
    expect(() => loadConfig()).toThrow(ConfigurationError);
    expect(() => loadConfig(undefined)).toThrow(ConfigurationError);
    expect(() => loadConfig(null)).toThrow(ConfigurationError);
    expect(() => loadConfig([])).toThrow(ConfigurationError);
    expect(() => loadConfig(['NODE_ENV', 'development'])).toThrow(ConfigurationError);
    expect(() => loadConfig('invalid-string')).toThrow(ConfigurationError);
    expect(() => loadConfig(12345)).toThrow(ConfigurationError);
    expect(() => loadConfig(true)).toThrow(ConfigurationError);
    expect(() => loadConfig(Symbol('env'))).toThrow(ConfigurationError);

    try {
      loadConfig(null);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const cfgErr = err as ConfigurationError;
      expect(cfgErr.issues).toEqual([
        {
          field: 'environment',
          message: 'Environment must be a plain object record',
        },
      ]);
    }
  });

  it('rejects non-string values inside the environment record', () => {
    expect(() => loadConfig({ NODE_ENV: 123 as unknown as string })).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({ NODE_ENV: 'test', LOG_LEVEL: ['info'] as unknown as string }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        APP_BASE_URL: { url: 'https://example.com' } as unknown as string,
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects missing, empty, or whitespace-only NODE_ENV', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: '' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: '   ' })).toThrow(ConfigurationError);
  });

  it('rejects unsupported NODE_ENV casing and whitespace', () => {
    expect(() => loadConfig({ NODE_ENV: 'PRODUCTION' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: ' production ' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'Development' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(ConfigurationError);
  });

  it('rejects unsupported, empty, or whitespace-only LOG_LEVEL', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: '' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: '   ' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'INFO' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: ' info ' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'verbose' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects malformed or relative APP_BASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', APP_BASE_URL: '/relative/path' })).toThrow(
      ConfigurationError,
    );
    expect(() => loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'not-a-url' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects empty, whitespace-only, and padded APP_BASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', APP_BASE_URL: '' })).toThrow(
      ConfigurationError,
    );
    expect(() => loadConfig({ NODE_ENV: 'development', APP_BASE_URL: '   ' })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      loadConfig({ NODE_ENV: 'development', APP_BASE_URL: ' http://localhost:3000 ' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'https://example.com   ' }),
    ).toThrow(ConfigurationError);
  });

  it('rejects non-HTTP schemes for APP_BASE_URL', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'ftp://files.example.com' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'ws://socket.example.com' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'javascript:alert(1)' }),
    ).toThrow(ConfigurationError);
  });

  it('rejects embedded credentials in APP_BASE_URL', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://user:pass@localhost:3000',
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://user@localhost:3000',
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://:password@localhost:3000',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects query parameters and fragment identifiers in APP_BASE_URL', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://localhost:3000?query=param',
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://localhost:3000#section',
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://localhost:3000?query=param#section',
      }),
    ).toThrow(ConfigurationError);
  });

  it('ignores unrelated operating-system environment keys', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PATH: '/usr/bin:/bin',
      AWS_SECRET_ACCESS_KEY: 'super-secret',
      RANDOM_OS_VAR: 'random-val',
    });

    expect(Object.keys(config).sort()).toEqual(['logLevel', 'nodeEnv']);
    expect((config as unknown as Record<string, unknown>)['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect((config as unknown as Record<string, unknown>)['PATH']).toBeUndefined();
    expect((config as unknown as Record<string, unknown>)['RANDOM_OS_VAR']).toBeUndefined();
  });

  it('returns deeply immutable configuration object', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'https://example.com',
    });

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      // @ts-expect-error Attempting mutation on readonly property
      config.nodeEnv = 'production';
    }).toThrow();
  });

  it('guarantees independence between successive invocations without shared state', () => {
    const first = loadConfig({ NODE_ENV: 'development', LOG_LEVEL: 'debug' });
    const second = loadConfig({ NODE_ENV: 'production', LOG_LEVEL: 'error' });

    expect(first.nodeEnv).toBe('development');
    expect(first.logLevel).toBe('debug');
    expect(second.nodeEnv).toBe('production');
    expect(second.logLevel).toBe('error');
  });

  it('never echoes raw sentinel values in ConfigurationError message, toString, inspect, or serialized output', () => {
    const SENTINEL_SECRET = 'SUPER_SECRET_LEAK_CHECK_SENTINEL_123';
    const SENTINEL_USER = 'sentinel_sensitive_username_xyz';
    const SENTINEL_PASS = 'sentinel_sensitive_password_xyz';
    const SENTINEL_QUERY = 'sentinel_sensitive_query_xyz';
    const SENTINEL_HASH = 'sentinel_sensitive_hash_xyz';
    const SENTINEL_RAW_INPUT = 'sentinel_non_record_raw_string_xyz';

    // Case 1: Invalid fields within record
    let thrownError: ConfigurationError | undefined;
    try {
      loadConfig({
        NODE_ENV: SENTINEL_SECRET,
        LOG_LEVEL: SENTINEL_SECRET,
        APP_BASE_URL: `http://${SENTINEL_USER}:${SENTINEL_PASS}@insecure.example.com?secret=${SENTINEL_QUERY}#${SENTINEL_HASH}`,
      });
    } catch (err) {
      if (err instanceof ConfigurationError) {
        thrownError = err;
      }
    }

    expect(thrownError).toBeDefined();
    if (thrownError) {
      const errorString = thrownError.toString();
      const errorJson = JSON.stringify(thrownError);
      const toJsonObject = thrownError.toJSON();
      const toJsonSerialized = JSON.stringify(toJsonObject);
      const issuesJson = JSON.stringify(thrownError.issues);
      const inspected = util.inspect(thrownError);
      const message = thrownError.message;

      for (const sentinel of [
        SENTINEL_SECRET,
        SENTINEL_USER,
        SENTINEL_PASS,
        SENTINEL_QUERY,
        SENTINEL_HASH,
      ]) {
        expect(errorString).not.toContain(sentinel);
        expect(errorJson).not.toContain(sentinel);
        expect(toJsonSerialized).not.toContain(sentinel);
        expect(issuesJson).not.toContain(sentinel);
        expect(inspected).not.toContain(sentinel);
        expect(message).not.toContain(sentinel);
      }

      // Check structure of safe serialization
      expect(toJsonObject.name).toBe('ConfigurationError');
      expect(toJsonObject.message).toContain('Configuration validation failed');
      expect(Array.isArray(toJsonObject.issues)).toBe(true);
    }

    // Case 2: Non-record input
    let nonRecordError: ConfigurationError | undefined;
    try {
      loadConfig(SENTINEL_RAW_INPUT as unknown);
    } catch (err) {
      if (err instanceof ConfigurationError) {
        nonRecordError = err;
      }
    }

    expect(nonRecordError).toBeDefined();
    if (nonRecordError) {
      const errorString = nonRecordError.toString();
      const errorJson = JSON.stringify(nonRecordError);
      const issuesJson = JSON.stringify(nonRecordError.issues);
      const message = nonRecordError.message;

      expect(errorString).not.toContain(SENTINEL_RAW_INPUT);
      expect(errorJson).not.toContain(SENTINEL_RAW_INPUT);
      expect(issuesJson).not.toContain(SENTINEL_RAW_INPUT);
      expect(message).not.toContain(SENTINEL_RAW_INPUT);
    }
  });
});

describe('packages/config - getRedactedConfigMetadata', () => {
  it('produces safe metadata without raw sensitive values or URL paths/queries', () => {
    const SENTINEL_PATH = 'sentinel_deep_path_secret_123';
    const SENTINEL_QUERY = 'sentinel_secret_param_456';
    const SENTINEL_FRAGMENT = 'sentinel_fragment_789';

    const config: AppConfig = {
      nodeEnv: 'production',
      logLevel: 'info',
      appBaseUrl: `https://subdomain.example.com:8443/${SENTINEL_PATH}?query=${SENTINEL_QUERY}#${SENTINEL_FRAGMENT}`,
    };

    const metadata = getRedactedConfigMetadata(config);

    expect(metadata.nodeEnv).toBe('production');
    expect(metadata.logLevel).toBe('info');
    expect(metadata.hasAppBaseUrl).toBe(true);
    expect(metadata.appBaseUrlOrigin).toBe('https://subdomain.example.com:8443');

    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(SENTINEL_PATH);
    expect(serialized).not.toContain(SENTINEL_QUERY);
    expect(serialized).not.toContain(SENTINEL_FRAGMENT);
    expect(metadata.appBaseUrlOrigin).not.toContain(SENTINEL_PATH);
    expect(metadata.appBaseUrlOrigin).not.toContain(SENTINEL_QUERY);
    expect(metadata.appBaseUrlOrigin).not.toContain(SENTINEL_FRAGMENT);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it('handles configuration without APP_BASE_URL correctly', () => {
    const config: AppConfig = {
      nodeEnv: 'development',
      logLevel: 'debug',
    };

    const metadata = getRedactedConfigMetadata(config);

    expect(metadata.nodeEnv).toBe('development');
    expect(metadata.logLevel).toBe('debug');
    expect(metadata.hasAppBaseUrl).toBe(false);
    expect(metadata.appBaseUrlOrigin).toBeUndefined();
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it('never leaks credentials or paths even if raw config has them', () => {
    const SENTINEL_USER = 'sentinel_malicious_user';
    const SENTINEL_PASS = 'sentinel_malicious_pass';
    const SENTINEL_PATH = 'sentinel_malicious_path';

    const configWithCredentials: AppConfig = {
      nodeEnv: 'production',
      logLevel: 'warn',
      appBaseUrl: `https://${SENTINEL_USER}:${SENTINEL_PASS}@example.com/${SENTINEL_PATH}`,
    };

    const metadata = getRedactedConfigMetadata(configWithCredentials);
    expect(metadata.appBaseUrlOrigin).toBe('https://example.com');
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(SENTINEL_USER);
    expect(serialized).not.toContain(SENTINEL_PASS);
    expect(serialized).not.toContain(SENTINEL_PATH);
  });

  it('returns deeply immutable metadata object', () => {
    const metadata = getRedactedConfigMetadata({
      nodeEnv: 'test',
      logLevel: 'info',
      appBaseUrl: 'https://example.com',
    });

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(() => {
      // @ts-expect-error Attempting mutation on readonly property
      metadata.nodeEnv = 'production';
    }).toThrow();
  });
});
