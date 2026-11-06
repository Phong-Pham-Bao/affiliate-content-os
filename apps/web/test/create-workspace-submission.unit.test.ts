import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSubmissionController } from '../src/lib/workspace-submission-controller.js';

describe('apps/web - WorkspaceSubmissionController', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('retains and reuses the exact same idempotency key across retry after failure for the same normalized payload', async () => {
    const controller = new WorkspaceSubmissionController();
    const capturedKeys: string[] = [];

    const mockOnSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error (500)'))
      .mockResolvedValueOnce(undefined);

    const payload = {
      name: '  Acme Publications  ',
      slug: 'acme-publications',
      timezone: 'America/New_York',
      brandVoice: 'Authoritative',
    };

    // First attempt: fails
    const res1 = await controller.submit(payload, async (_p, key) => {
      capturedKeys.push(key);
      return mockOnSave();
    });
    expect(res1.success).toBe(false);
    expect(res1.error).toBe('Failed to create workspace. Please check your connection and retry.');
    expect(capturedKeys).toHaveLength(1);

    // Second attempt (retry with same logical payload): succeeds and reuses exact same key
    const res2 = await controller.submit(payload, async (_p, key) => {
      capturedKeys.push(key);
      return mockOnSave();
    });
    expect(res2.success).toBe(true);
    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).toBe(capturedKeys[1]);
  });

  it('rotates to a newly generated idempotency key when normalized payload changes', async () => {
    const controller = new WorkspaceSubmissionController();
    const capturedKeys: string[] = [];

    const mockOnSave = vi.fn().mockRejectedValue(new Error('Slug conflict (409)'));

    const payload1 = {
      name: 'Acme One',
      slug: 'acme-one',
      timezone: 'UTC',
    };

    const payload2 = {
      name: 'Acme Two',
      slug: 'acme-two',
      timezone: 'UTC',
    };

    await controller.submit(payload1, async (_p, key) => {
      capturedKeys.push(key);
      return mockOnSave();
    });

    await controller.submit(payload2, async (_p, key) => {
      capturedKeys.push(key);
      return mockOnSave();
    });

    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });

  it('omitted aiEnabled and false reuse key, while true rotates key', async () => {
    const controller = new WorkspaceSubmissionController();
    const capturedKeys: string[] = [];

    const mockOnSave = vi.fn().mockRejectedValue(new Error('API failure'));

    // 1. Omitted aiEnabled
    await controller.submit(
      { name: 'WS', slug: 'ws-slug', timezone: 'UTC', aiEnabled: undefined },
      async (_p, key) => {
        capturedKeys.push(key);
        return mockOnSave();
      },
    );

    // 2. Explicit false aiEnabled (same logical default)
    await controller.submit(
      { name: 'WS', slug: 'ws-slug', timezone: 'UTC', aiEnabled: false },
      async (_p, key) => {
        capturedKeys.push(key);
        return mockOnSave();
      },
    );

    // 3. Explicit true aiEnabled (different logical payload)
    await controller.submit(
      { name: 'WS', slug: 'ws-slug', timezone: 'UTC', aiEnabled: true },
      async (_p, key) => {
        capturedKeys.push(key);
        return mockOnSave();
      },
    );

    expect(capturedKeys).toHaveLength(3);
    expect(capturedKeys[0]).toBe(capturedKeys[1]); // omitted and false are identical
    expect(capturedKeys[1]).not.toBe(capturedKeys[2]); // true rotated the key
  });

  it('guards synchronous double submission and calls onSave only once', async () => {
    const controller = new WorkspaceSubmissionController();
    let resolveFirstCall!: () => void;
    const firstCallPromise = new Promise<void>((resolve) => {
      resolveFirstCall = resolve;
    });

    const mockOnSave = vi.fn().mockImplementation(() => firstCallPromise);

    const payload = {
      name: 'Concurrent WS',
      slug: 'concurrent-ws',
      timezone: 'UTC',
    };

    // Trigger first submission (in-flight)
    const call1 = controller.submit(payload, mockOnSave);

    // Immediate second submission while call1 is in-flight
    const call2 = controller.submit(payload, mockOnSave);

    const [res2] = await Promise.all([call2, (async () => resolveFirstCall())()]);
    const res1 = await call1;

    expect(mockOnSave).toHaveBeenCalledTimes(1);
    expect(res1.success).toBe(true);
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('Submission already in progress');
  });

  it('shows recoverable error and does not call onSave or Math.random when Web Crypto is unavailable', async () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const controller = new WorkspaceSubmissionController();
    const mockOnSave = vi.fn();

    const payload = {
      name: 'No Crypto WS',
      slug: 'no-crypto-ws',
      timezone: 'UTC',
    };

    const res = await controller.submit(payload, mockOnSave);

    expect(res.success).toBe(false);
    expect(res.error).toContain('Secure random generation is unavailable');
    expect(mockOnSave).not.toHaveBeenCalled();
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });
});
