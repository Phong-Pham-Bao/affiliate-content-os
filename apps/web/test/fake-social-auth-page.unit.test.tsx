import { describe, expect, it, vi } from 'vitest';

const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFoundMock(),
}));

import FakeSocialAuthPage from '../app/fake-social-auth/page.js';

describe('apps/web - FakeSocialAuthPage (TASK-016 Remediation 02)', () => {
  it('returns 404 in production environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    notFoundMock.mockClear();

    await expect(FakeSocialAuthPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('returns 404 in production even when ALLOW_FAKE_SOCIAL_AUTH is true (no escape hatch)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_FAKE_SOCIAL_AUTH', 'true');
    notFoundMock.mockClear();

    await expect(FakeSocialAuthPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('returns 404 when APP_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_ENV', 'production');
    notFoundMock.mockClear();

    await expect(FakeSocialAuthPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('returns 404 when NEXT_PUBLIC_APP_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    notFoundMock.mockClear();

    await expect(FakeSocialAuthPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('renders in non-production test/development mode', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'test');
    notFoundMock.mockClear();

    const element = await FakeSocialAuthPage({ searchParams: Promise.resolve({}) });
    expect(element).toBeDefined();
    expect(notFoundMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
