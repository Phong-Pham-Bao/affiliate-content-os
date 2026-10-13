import util from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  getRedactedConfigMetadata,
  loadConfig,
} from '../src/index.js';

describe('packages/config - API listener settings', () => {
  it('applies default API_HOST and API_PORT when omitted', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.apiHost).toBe(DEFAULT_API_HOST);
    expect(config.apiPort).toBe(DEFAULT_API_PORT);
    expect(config.apiHost).toBe('127.0.0.1');
    expect(config.apiPort).toBe(3001);
  });

  it('parses valid API_HOST overrides including IPs, localhost, and hostnames', () => {
    const validHosts = [
      '127.0.0.1',
      '0.0.0.0',
      'localhost',
      '::1',
      '192.168.1.100',
      'api.service.internal',
      'example.com',
    ];

    for (const host of validHosts) {
      const config = loadConfig({
        NODE_ENV: 'development',
        API_HOST: host,
      });
      expect(config.apiHost).toBe(host);
    }
  });

  it('parses valid API_PORT overrides at lower and upper boundaries', () => {
    const validPorts = [
      { raw: '1', expected: 1 },
      { raw: '80', expected: 80 },
      { raw: '3000', expected: 3000 },
      { raw: '3001', expected: 3001 },
      { raw: '8080', expected: 8080 },
      { raw: '65535', expected: 65535 },
    ];

    for (const { raw, expected } of validPorts) {
      const config = loadConfig({
        NODE_ENV: 'test',
        API_PORT: raw,
      });
      expect(config.apiPort).toBe(expected);
    }
  });

  it('rejects invalid API_PORT values (zero, negative, out-of-range, decimals, padded, non-numeric)', () => {
    const invalidPorts = [
      '0',
      '-1',
      '-3001',
      '65536',
      '99999',
      '3001.5',
      '80.0',
      ' 3001 ',
      '3001 ',
      ' 3001',
      '',
      '   ',
      'abc',
      '3001px',
      'NaN',
      '03001',
    ];

    for (const invalidPort of invalidPorts) {
      expect(
        () =>
          loadConfig({
            NODE_ENV: 'test',
            API_PORT: invalidPort,
          }),
        `Expected rejection of port: ${invalidPort}`,
      ).toThrow(ConfigurationError);

      try {
        loadConfig({
          NODE_ENV: 'test',
          API_PORT: invalidPort,
        });
      } catch (err) {
        const cfgErr = err as ConfigurationError;
        expect(cfgErr.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'API_PORT',
              message: 'Must be a valid TCP port between 1 and 65535',
            }),
          ]),
        );
      }
    }
  });

  it('rejects non-string types for API_PORT and API_HOST in environment record', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        API_PORT: 3001 as unknown as string,
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        API_HOST: 127001 as unknown as string,
      }),
    ).toThrow(ConfigurationError);

    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        API_PORT: ['3001'] as unknown as string,
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects invalid API_HOST values (empty, padded, spaces, ports in host, URLs)', () => {
    const invalidHosts = [
      '',
      '   ',
      ' 127.0.0.1 ',
      'localhost:3000',
      '127.0.0.1:3001',
      '[::1]:3000',
      'invalid host with spaces',
      'http://localhost',
      'https://127.0.0.1',
      'localhost/path',
      'host\\backslash',
    ];

    for (const invalidHost of invalidHosts) {
      expect(
        () =>
          loadConfig({
            NODE_ENV: 'test',
            API_HOST: invalidHost,
          }),
        `Expected rejection of host: ${invalidHost}`,
      ).toThrow(ConfigurationError);

      try {
        loadConfig({
          NODE_ENV: 'test',
          API_HOST: invalidHost,
        });
      } catch (err) {
        const cfgErr = err as ConfigurationError;
        expect(cfgErr.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'API_HOST',
              message: 'Must be a valid hostname or IP address',
            }),
          ]),
        );
      }
    }
  });

  it('enforces immutability for apiHost and apiPort', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      API_PORT: '4000',
    });

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      // @ts-expect-error Mutating readonly property
      config.apiHost = '0.0.0.0';
    }).toThrow();
    expect(() => {
      // @ts-expect-error Mutating readonly property
      config.apiPort = 5000;
    }).toThrow();
  });

  it('filters unknown environment keys when API listener variables are set', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      API_HOST: 'localhost',
      API_PORT: '3001',
      UNRECOGNIZED_SECRET: 'secret-val',
      DATABASE_URL: 'postgres://user:pass@localhost/db',
    });

    expect(config.apiHost).toBe('localhost');
    expect(config.apiPort).toBe(3001);
    expect((config as unknown as Record<string, unknown>)['UNRECOGNIZED_SECRET']).toBeUndefined();
    expect((config as unknown as Record<string, unknown>)['DATABASE_URL']).toBeUndefined();
    expect(Object.keys(config).sort()).toEqual(['apiHost', 'apiPort', 'logLevel', 'nodeEnv']);
  });

  it('never echoes raw sentinel values for invalid API_HOST or API_PORT', () => {
    const SENTINEL_INVALID_PORT = '999999_SENTINEL_LEAK_PORT';
    const SENTINEL_INVALID_HOST = 'SENTINEL_INVALID_HOST_SPACES_LEAK_CHECK';

    let error: ConfigurationError | undefined;
    try {
      loadConfig({
        NODE_ENV: 'test',
        API_HOST: SENTINEL_INVALID_HOST,
        API_PORT: SENTINEL_INVALID_PORT,
      });
    } catch (err) {
      if (err instanceof ConfigurationError) {
        error = err;
      }
    }

    expect(error).toBeDefined();
    if (error) {
      const message = error.message;
      const str = error.toString();
      const json = JSON.stringify(error);
      const toJsonObject = JSON.stringify(error.toJSON());
      const inspected = util.inspect(error);

      for (const sentinel of [SENTINEL_INVALID_PORT, SENTINEL_INVALID_HOST]) {
        expect(message).not.toContain(sentinel);
        expect(str).not.toContain(sentinel);
        expect(json).not.toContain(sentinel);
        expect(toJsonObject).not.toContain(sentinel);
        expect(inspected).not.toContain(sentinel);
      }
    }
  });

  it('includes apiHost and apiPort in redacted metadata without leaking', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      API_HOST: '0.0.0.0',
      API_PORT: '8080',
    });

    const metadata = getRedactedConfigMetadata(config);
    expect(metadata.apiHost).toBe('0.0.0.0');
    expect(metadata.apiPort).toBe(8080);
    expect(Object.isFrozen(metadata)).toBe(true);

    expect(() => {
      // @ts-expect-error Mutating readonly property
      metadata.apiHost = '127.0.0.1';
    }).toThrow();
  });
});
