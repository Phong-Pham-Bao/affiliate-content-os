import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@affiliate-content-os/config';

vi.mock('server-only', () => ({}));

import RootPage from '../app/page';

describe('apps/web - RootPage', () => {
  it('renders AppShell when environment is valid', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const element = RootPage();
    expect(element).toBeDefined();
    expect(element.type).toBeDefined();
    vi.unstubAllEnvs();
  });

  it('rejects rendering when configuration is invalid', () => {
    vi.stubEnv('NODE_ENV', 'invalid-mode');
    expect(() => RootPage()).toThrow(ConfigurationError);
    vi.unstubAllEnvs();
  });
});
