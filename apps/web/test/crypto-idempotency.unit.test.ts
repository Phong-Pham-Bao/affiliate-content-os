import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateCryptoIdempotencyKey,
  normalizeWorkspacePayload,
} from '../src/lib/crypto-idempotency.js';

describe('apps/web - crypto-idempotency', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('uses crypto.randomUUID when available', () => {
    const mockUuid = '0192b012-3456-789a-8bcd-ef0123456799';
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        randomUUID: vi.fn().mockReturnValue(mockUuid),
      },
      configurable: true,
      writable: true,
    });

    const key = generateCryptoIdempotencyKey();
    expect(key).toBe(mockUuid);
  });

  it('uses crypto.getRandomValues when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: vi.fn((buf: Uint8Array) => {
          for (let i = 0; i < buf.length; i++) {
            buf[i] = i + 1;
          }
          return buf;
        }),
      },
      configurable: true,
      writable: true,
    });

    const key = generateCryptoIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns null when crypto is missing without calling Math.random', () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const key = generateCryptoIdempotencyKey();
    expect(key).toBeNull();
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('returns null when crypto has neither randomUUID nor getRandomValues', () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');
    Object.defineProperty(globalThis, 'crypto', {
      value: {},
      configurable: true,
      writable: true,
    });

    const key = generateCryptoIdempotencyKey();
    expect(key).toBeNull();
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('normalizeWorkspacePayload produces identical JSON for logically equal trimmed inputs', () => {
    const p1 = normalizeWorkspacePayload(
      '  Acme ',
      ' acme-ws ',
      ' UTC ',
      ' Voice ',
      ' Disclosure ',
      true,
    );
    const p2 = normalizeWorkspacePayload('Acme', 'acme-ws', 'UTC', 'Voice', 'Disclosure', true);
    expect(p1).toBe(p2);
  });

  it('normalizeWorkspacePayload produces different JSON when fields change', () => {
    const p1 = normalizeWorkspacePayload('Acme', 'acme-ws', 'UTC', '', '', true);
    const p2 = normalizeWorkspacePayload('Beta', 'acme-ws', 'UTC', '', '', true);
    expect(p1).not.toBe(p2);
  });

  it('normalizes omitted aiEnabled to false, matching explicit false', () => {
    const omitted = normalizeWorkspacePayload('Acme', 'acme-ws', 'UTC', null, null, undefined);
    const explicitFalse = normalizeWorkspacePayload('Acme', 'acme-ws', 'UTC', null, null, false);
    expect(omitted).toBe(explicitFalse);
    expect(JSON.parse(omitted).aiEnabled).toBe(false);
  });

  it('produces different payload between omitted (default false) and true', () => {
    const omitted = normalizeWorkspacePayload('Acme', 'acme-ws', 'UTC', null, null, undefined);
    const explicitTrue = normalizeWorkspacePayload('Acme', 'acme-ws', 'UTC', null, null, true);
    expect(omitted).not.toBe(explicitTrue);
  });
});
