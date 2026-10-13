import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import RootPage from '../app/page';

describe('apps/web - RootPage', () => {
  it('renders root page with stable title and running status', () => {
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
  });
});
