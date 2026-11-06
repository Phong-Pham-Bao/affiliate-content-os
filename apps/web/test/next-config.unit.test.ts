import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@affiliate-content-os/config';
import nextConfig from '../next.config.mjs';

describe('apps/web - next.config.mjs rewrites', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes to default development API in development/test when WEB_API_BASE_URL is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.WEB_API_BASE_URL;

    const rewrites = await nextConfig.rewrites!();
    const rewriteList = (Array.isArray(rewrites) ? rewrites : rewrites?.beforeFiles) ?? [];

    expect(rewriteList).toEqual([
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:3001/api/:path*',
      },
      {
        source: '/auth/:path*',
        destination: 'http://127.0.0.1:3001/auth/:path*',
      },
    ]);
  });

  it('routes to explicit valid WEB_API_BASE_URL target', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WEB_API_BASE_URL', 'http://127.0.0.1:8080');

    const rewrites = await nextConfig.rewrites!();
    const rewriteList = (Array.isArray(rewrites) ? rewrites : rewrites?.beforeFiles) ?? [];

    expect(rewriteList).toEqual([
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8080/api/:path*',
      },
      {
        source: '/auth/:path*',
        destination: 'http://127.0.0.1:8080/auth/:path*',
      },
    ]);
  });

  it('fails closed in production when WEB_API_BASE_URL is missing, never routing to working localhost', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.WEB_API_BASE_URL;

    const rewrites = await nextConfig.rewrites!();
    const rewriteList = (Array.isArray(rewrites) ? rewrites : rewrites?.beforeFiles) ?? [];

    expect(rewriteList).toEqual([
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:0/api/:path*',
      },
      {
        source: '/auth/:path*',
        destination: 'http://127.0.0.1:0/auth/:path*',
      },
    ]);
    expect(rewriteList[0]?.destination).not.toContain('3001');
  });

  it('rejects invalid explicit WEB_API_BASE_URL with ConfigurationError', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WEB_API_BASE_URL', 'invalid-not-url');

    await expect(nextConfig.rewrites!()).rejects.toThrow(ConfigurationError);
  });

  it('rejects NEXT_PUBLIC_WEB_API_BASE_URL with ConfigurationError', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_WEB_API_BASE_URL', 'http://127.0.0.1:3001');

    await expect(nextConfig.rewrites!()).rejects.toThrow(ConfigurationError);
  });
});
