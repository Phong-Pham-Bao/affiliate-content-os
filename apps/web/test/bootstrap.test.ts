import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@affiliate-content-os/config';

vi.mock('server-only', () => ({}));

import { bootstrapWebServer } from '../src/server/bootstrap';

describe('apps/web - bootstrapWebServer', () => {
  it('loads and validates configuration with injected environment record', () => {
    const config = bootstrapWebServer({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
    });

    expect(config.nodeEnv).toBe('test');
    expect(config.logLevel).toBe('info');
    expect(config.apiHost).toBe('127.0.0.1');
    expect(config.apiPort).toBe(3001);
  });

  it('rejects invalid environment without leaking values', () => {
    const SENTINEL_SECRET = 'SECRET_WEB_CONFIG_SENTINEL_LEAK';

    expect(() =>
      bootstrapWebServer({
        NODE_ENV: SENTINEL_SECRET,
      }),
    ).toThrow(ConfigurationError);

    try {
      bootstrapWebServer({
        NODE_ENV: SENTINEL_SECRET,
      });
    } catch (err) {
      const cfgErr = err as ConfigurationError;
      expect(cfgErr.message).not.toContain(SENTINEL_SECRET);
      expect(JSON.stringify(cfgErr)).not.toContain(SENTINEL_SECRET);
    }
  });
});
