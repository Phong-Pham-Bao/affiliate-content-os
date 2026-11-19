import { describe, expect, it, vi } from 'vitest';
import { DefaultHttpTransport } from '../../src/social/adapters/threads-http-transport.js';

describe('DefaultHttpTransport', () => {
  it('enforces maximum response size during streaming', async () => {
    // Generate a response stream with more than 64KB (e.g. 70KB)
    const largeChunk = new Uint8Array(1024 * 70).fill(65); // 70KB of 'A'
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(largeChunk);
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: mockStream,
    });
    vi.stubGlobal('fetch', mockFetch);

    const transport = new DefaultHttpTransport(5000);
    await expect(
      transport.fetch({ method: 'GET', url: 'https://graph.threads.com/test' }),
    ).rejects.toThrow('Provider response exceeded maximum allowed payload size');

    vi.unstubAllGlobals();
  });

  it('rejects responses with non-JSON content type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>Hostile</html>'));
          controller.close();
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const transport = new DefaultHttpTransport(5000);
    await expect(
      transport.fetch({ method: 'GET', url: 'https://graph.threads.com/test' }),
    ).rejects.toThrow('Provider returned invalid content type: text/html');

    vi.unstubAllGlobals();
  });

  it('redacts access_token and client_secret from thrown network error messages', async () => {
    const sensitiveUrl =
      'https://graph.threads.com/access_token?grant_type=th_exchange_token&client_secret=secret_xyz123&access_token=token_abc456';
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error(`Failed to fetch ${sensitiveUrl}: connection refused`));
    vi.stubGlobal('fetch', mockFetch);

    const transport = new DefaultHttpTransport(5000);
    try {
      await transport.fetch({ method: 'GET', url: sensitiveUrl });
      expect.fail('Expected transport.fetch to throw');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).not.toContain('secret_xyz123');
      expect(msg).not.toContain('token_abc456');
      expect(msg).toContain('client_secret=[REDACTED]');
      expect(msg).toContain('access_token=[REDACTED]');
      expect((err as Error).cause).toBeUndefined();
    }

    vi.unstubAllGlobals();
  });

  it('throws timeout error on abort/timeout', async () => {
    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const transport = new DefaultHttpTransport(10); // 10ms timeout
    await expect(
      transport.fetch({ method: 'GET', url: 'https://graph.threads.com/test' }),
    ).rejects.toThrow('HTTP request to provider timed out');

    vi.unstubAllGlobals();
  });
});
