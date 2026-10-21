import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@affiliate-content-os/config';

vi.mock('server-only', () => ({}));

import RootPage from '../app/page';

describe('apps/web - RootPage', () => {
  it('renders root page with stable title and running status when environment is valid', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const element = RootPage();
    expect(element).toBeDefined();

    const children = element.props.children;
    expect(Array.isArray(children)).toBe(true);

    const [heading, status] = children;
    expect(heading.type).toBe('h1');
    expect(heading.props.children).toBe('Affiliate Content OS');

    expect(status.type).toBe('p');
    expect(status.props.children).toBe('Application shell is running');
    vi.unstubAllEnvs();
  });

  it('rejects rendering when configuration is invalid', () => {
    vi.stubEnv('NODE_ENV', 'invalid-mode');
    expect(() => RootPage()).toThrow(ConfigurationError);
    vi.unstubAllEnvs();
  });
});
