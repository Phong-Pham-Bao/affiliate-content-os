import { describe, expect, it } from 'vitest';
import {
  calculateRefreshLeaseDurationSeconds,
  calculateRevocationLeaseDurationSeconds,
  SocialAuthOutcomeUnknownError,
  withTimeout,
} from '../src/social/index.js';

describe('Shared Lease Budget & Timeout Utilities', () => {
  it('calculates worst-case refresh lease covering 4 provider calls + 30s margin', () => {
    // Default 15s timeout: 4 * 15 + 30 = 90s -> clamped to min 120s
    expect(calculateRefreshLeaseDurationSeconds(15000)).toBe(120);

    // Standard 10s timeout: 4 * 10 + 30 = 70s -> clamped to min 120s
    expect(calculateRefreshLeaseDurationSeconds(10000)).toBe(120);

    // 60s timeout: 4 * 60 + 30 = 270s
    expect(calculateRefreshLeaseDurationSeconds(60000)).toBe(270);

    // Missing timeout: defaults to 15s -> clamped to min 120s
    expect(calculateRefreshLeaseDurationSeconds(undefined)).toBe(120);
  });

  it('calculates worst-case revocation lease covering 1 call + 30s margin', () => {
    // Default 10s timeout: 10 + 30 = 40s -> clamped to min 60s
    expect(calculateRevocationLeaseDurationSeconds(10000)).toBe(60);

    // 60s timeout: 60 + 30 = 90s
    expect(calculateRevocationLeaseDurationSeconds(60000)).toBe(90);

    // Missing timeout: defaults to 10s -> clamped to min 60s
    expect(calculateRevocationLeaseDurationSeconds(undefined)).toBe(60);
  });

  it('withTimeout settles successfully if promise finishes before timeout', async () => {
    const fastPromise = new Promise<string>((resolve) => setTimeout(() => resolve('success'), 20));
    const result = await withTimeout(fastPromise, 200);
    expect(result).toBe('success');
  });

  it('withTimeout throws SocialAuthOutcomeUnknownError if promise exceeds timeout', async () => {
    const hangingPromise = new Promise<string>(() => {});
    await expect(withTimeout(hangingPromise, 50, 'Provider call timed out')).rejects.toThrow(
      SocialAuthOutcomeUnknownError,
    );
  });
});
