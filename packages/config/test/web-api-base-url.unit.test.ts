import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  DEFAULT_DEV_WEB_API_BASE_URL,
  UNREACHABLE_PRODUCTION_WEB_API_BASE_URL,
  resolveWebApiBaseUrl,
} from '../src/index.js';

describe('packages/config - resolveWebApiBaseUrl', () => {
  it('defaults to dev target in development mode when missing', () => {
    const url = resolveWebApiBaseUrl({ NODE_ENV: 'development' });
    expect(url).toBe(DEFAULT_DEV_WEB_API_BASE_URL);
    expect(url).toBe('http://127.0.0.1:3001');
  });

  it('defaults to dev target in test mode when missing', () => {
    const url = resolveWebApiBaseUrl({ NODE_ENV: 'test' });
    expect(url).toBe(DEFAULT_DEV_WEB_API_BASE_URL);
  });

  it('fails closed in production mode when missing (never returns working localhost)', () => {
    const url = resolveWebApiBaseUrl({ NODE_ENV: 'production' });
    expect(url).toBe(UNREACHABLE_PRODUCTION_WEB_API_BASE_URL);
    expect(url).toBe('http://127.0.0.1:0');
    expect(url).not.toBe('http://127.0.0.1:3001');
    expect(url).not.toBe('http://localhost:3001');
  });

  it('accepts valid explicit http and https origin URLs', () => {
    expect(
      resolveWebApiBaseUrl({
        NODE_ENV: 'development',
        WEB_API_BASE_URL: 'http://127.0.0.1:4000',
      }),
    ).toBe('http://127.0.0.1:4000');

    expect(
      resolveWebApiBaseUrl({
        NODE_ENV: 'production',
        WEB_API_BASE_URL: 'https://api.example.com',
      }),
    ).toBe('https://api.example.com');
  });

  it('rejects invalid explicit values with ConfigurationError', () => {
    const invalidInputs = [
      'not-a-url',
      'ftp://api.example.com',
      'https://user:pass@api.example.com',
      'https://api.example.com/api/v1',
      'https://api.example.com?query=1',
      'https://api.example.com#hash',
      ' https://api.example.com',
      'https://api.example.com ',
    ];

    for (const invalid of invalidInputs) {
      expect(
        () =>
          resolveWebApiBaseUrl({
            NODE_ENV: 'development',
            WEB_API_BASE_URL: invalid,
          }),
        `Expected rejection for: ${invalid}`,
      ).toThrow(ConfigurationError);
    }
  });

  it('strictly rejects exposure as NEXT_PUBLIC_WEB_API_BASE_URL', () => {
    expect(() =>
      resolveWebApiBaseUrl({
        NODE_ENV: 'development',
        NEXT_PUBLIC_WEB_API_BASE_URL: 'https://api.example.com',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects non-object raw environment', () => {
    expect(() => resolveWebApiBaseUrl(null)).toThrow(ConfigurationError);
    expect(() => resolveWebApiBaseUrl(undefined)).toThrow(ConfigurationError);
    expect(() => resolveWebApiBaseUrl('string')).toThrow(ConfigurationError);
    expect(() => resolveWebApiBaseUrl([1, 2, 3])).toThrow(ConfigurationError);
  });
});
