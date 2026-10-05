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

  it('rejects missing or empty NODE_ENV', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: '' })).toThrow(ConfigurationError);
  });

  it('rejects unsupported NODE_ENV casing and whitespace', () => {
    expect(() => loadConfig({ NODE_ENV: 'PRODUCTION' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: ' production ' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'Development' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(ConfigurationError);
  });

  it('rejects unsupported LOG_LEVEL casing and whitespace', () => {
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

  it('rejects non-HTTP schemes for APP_BASE_URL', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'ftp://files.example.com' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'ws://socket.example.com' }),
    ).toThrow(ConfigurationError);
  });

  it('rejects embedded credentials in APP_BASE_URL', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://user:pass@localhost:3000',
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
  });

  it('ignores unrelated operating-system environment keys', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PATH: '/usr/bin:/bin',
      AWS_SECRET_ACCESS_KEY: 'super-secret',
      RANDOM_OS_VAR: 'random-val',
    });

    expect(Object.keys(config).sort()).toEqual(['logLevel', 'nodeEnv']);
    expect((config as Record<string, unknown>)['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect((config as Record<string, unknown>)['PATH']).toBeUndefined();
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

  it('never echoes raw sentinel values in ConfigurationError message or serialized output', () => {
    const sentinelSecret = 'SUPER_SECRET_LEAK_CHECK_SENTINEL_123';
    const sentinelUrl = 'http://sentinel-user:sentinel-pass@insecure.example.com';

    let thrownError: ConfigurationError | undefined;
    try {
      loadConfig({
        NODE_ENV: sentinelSecret,
        LOG_LEVEL: sentinelSecret,
        APP_BASE_URL: sentinelUrl,
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
      const message = thrownError.message;

      expect(errorString).not.toContain(sentinelSecret);
      expect(errorJson).not.toContain(sentinelSecret);
      expect(message).not.toContain(sentinelSecret);

      expect(errorString).not.toContain('sentinel-user');
      expect(errorString).not.toContain('sentinel-pass');
      expect(errorJson).not.toContain('sentinel-user');
      expect(errorJson).not.toContain('sentinel-pass');
    }
  });
});

describe('packages/config - getRedactedConfigMetadata', () => {
  it('produces safe metadata without raw sensitive values or URL paths/queries', () => {
    const config: AppConfig = {
      nodeEnv: 'production',
      logLevel: 'info',
      appBaseUrl: 'https://subdomain.example.com:8443/deep/path?query=secret#fragment',
    };

    const metadata = getRedactedConfigMetadata(config);

    expect(metadata.nodeEnv).toBe('production');
    expect(metadata.logLevel).toBe('info');
    expect(metadata.hasAppBaseUrl).toBe(true);
    expect(metadata.appBaseUrlOrigin).toBe('https://subdomain.example.com:8443');

    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('/deep/path');
    expect(serialized).not.toContain('query=secret');
    expect(serialized).not.toContain('fragment');
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
  });
});
