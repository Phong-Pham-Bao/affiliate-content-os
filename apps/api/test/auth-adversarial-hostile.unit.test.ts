import { describe, expect, it } from 'vitest';
import { completeOidcLogin, OidcCallbackInvalidError } from '@affiliate-content-os/application';
import { mapSessionRow } from '@affiliate-content-os/infrastructure/auth';
import { DatabaseError } from '@affiliate-content-os/infrastructure/database';
import { resolveProblemSpec } from '../src/auth/problem-details.js';

describe('Auth Adversarial Hostile Accessors & Non-Disclosure', () => {
  it('rejects hostile query with throwing getter on state with zero getter invocations', async () => {
    let trapCalls = 0;
    const hostileQuery = {
      get state(): string {
        trapCalls++;
        throw new Error('SENTINEL_QUERY_GETTER');
      },
      code: 'valid-code-12345',
    };

    await expect(
      completeOidcLogin(
        {
          query: hostileQuery,
          transactionCookie: 'binding-raw-value-32-chars-long-12345678901',
        },
        {} as never,
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);

    expect(trapCalls).toBe(0);
  });

  it('rejects hostile query with throwing getter on code with zero getter invocations', async () => {
    let trapCalls = 0;
    const hostileQuery = {
      state: 'valid-state-12345',
      get code(): string {
        trapCalls++;
        throw new Error('SENTINEL_QUERY_GETTER');
      },
    };

    await expect(
      completeOidcLogin(
        {
          query: hostileQuery,
          transactionCookie: 'binding-raw-value-32-chars-long-12345678901',
        },
        {} as never,
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);

    expect(trapCalls).toBe(0);
  });

  it('rejects hostile query with throwing getter on error with zero getter invocations', async () => {
    let trapCalls = 0;
    const hostileQuery = {
      state: 'valid-state-12345',
      get error(): string {
        trapCalls++;
        throw new Error('SENTINEL_QUERY_GETTER');
      },
    };

    await expect(
      completeOidcLogin(
        {
          query: hostileQuery,
          transactionCookie: 'binding-raw-value-32-chars-long-12345678901',
        },
        {} as never,
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);

    expect(trapCalls).toBe(0);
  });

  it('rejects hostile session row with throwing getter on id with zero getter invocations', () => {
    let trapCalls = 0;
    const hostileRow = {
      get id(): string {
        trapCalls++;
        throw new Error('SENTINEL_ROW_GETTER');
      },
      user_id: '0192b012-3456-789a-8bcd-ef0123456789',
      current_token_hash: new Uint8Array(32).fill(1),
      previous_token_hash: null,
      previous_token_valid_until: null,
      created_at: '2026-11-02T12:00:00.000Z',
      last_seen_at: '2026-11-02T12:00:00.000Z',
      idle_expires_at: '2026-11-02T12:30:00.000Z',
      absolute_expires_at: '2026-11-02T20:00:00.000Z',
      rotated_at: '2026-11-02T12:00:00.000Z',
      revoked_at: null,
      revocation_reason: null,
      version: 1,
    };

    expect(() => mapSessionRow(hostileRow)).toThrow(DatabaseError);
    expect(trapCalls).toBe(0);
  });

  it('safely maps hostile error with throwing code getter to INTERNAL_ERROR with zero trap calls', () => {
    let trapCalls = 0;
    const hostileError = {
      get code(): string {
        trapCalls++;
        throw new Error('SENTINEL_AUTH_GETTER');
      },
    };

    const spec = resolveProblemSpec(hostileError);
    expect(spec.code).toBe('INTERNAL_ERROR');
    expect(spec.status).toBe(500);
    expect(trapCalls).toBe(0);
  });

  it('safely maps hostile error with throwing statusCode getter to INTERNAL_ERROR with zero trap calls', () => {
    let trapCalls = 0;
    const hostileError = {
      get statusCode(): number {
        trapCalls++;
        throw new Error('SENTINEL_AUTH_GETTER');
      },
    };

    const spec = resolveProblemSpec(hostileError);
    expect(spec.code).toBe('INTERNAL_ERROR');
    expect(spec.status).toBe(500);
    expect(trapCalls).toBe(0);
  });

  it('safely maps Proxy error to INTERNAL_ERROR with zero trap calls', () => {
    let trapCalls = 0;
    const target = { code: 'FST_ERR_RATE_LIMIT', statusCode: 429 };
    const proxyError = new Proxy(target, {
      get(t, prop, receiver) {
        trapCalls++;
        return Reflect.get(t, prop, receiver);
      },
    });

    const spec = resolveProblemSpec(proxyError);
    expect(spec.code).toBe('INTERNAL_ERROR');
    expect(spec.status).toBe(500);
    expect(trapCalls).toBe(0);
  });
});
