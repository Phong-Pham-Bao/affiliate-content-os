import { describe, expect, it } from 'vitest';
import {
  copyBytes as appCandidateCopyBytes,
  extractSingleCandidate,
  safeExtractUser,
} from '../../src/auth/authenticate-session-candidate.js';
import {
  copyBytes as appSnapshotCopyBytes,
  snapshotConsumedTx,
  snapshotSecrets,
  snapshotVerifiedClaims,
} from '../../src/auth/complete-oidc-login-snapshots.js';

describe('Issue 1: Hostile Proxies, Byte Snapshots, and Closed Keys Matrix (Application)', () => {
  it('executes zero getPrototypeOf trap calls when proxy is passed to application copyBytes helpers', () => {
    let trapCalls = 0;
    const proxyTarget = new Uint8Array(16);
    const hostileProxy = new Proxy(proxyTarget, {
      getPrototypeOf() {
        trapCalls++;
        throw new Error('PROXY_TRAP_SENTINEL');
      },
    });

    expect(appCandidateCopyBytes(hostileProxy)).toBeNull();
    expect(appSnapshotCopyBytes(hostileProxy)).toBeNull();
    expect(trapCalls).toBe(0);
  });

  it('executes zero own byteLength/length getters and leaks no sentinels', () => {
    let hookCalls = 0;
    const u8App = new Uint8Array(32);
    Object.defineProperty(u8App, 'byteLength', {
      get() {
        hookCalls++;
        throw new Error('app:SENTINEL');
      },
    });

    const u8AppLen = new Uint8Array(32);
    Object.defineProperty(u8AppLen, 'length', {
      get() {
        hookCalls++;
        throw new Error('app:SENTINEL');
      },
    });

    expect(appCandidateCopyBytes(u8App)).toBeNull();
    expect(appSnapshotCopyBytes(u8App)).toBeNull();
    expect(appCandidateCopyBytes(u8AppLen)).toBeNull();
    expect(appSnapshotCopyBytes(u8AppLen)).toBeNull();
    expect(hookCalls).toBe(0);
  });

  it('safely handles revoked proxies across byte helpers with zero unhandled exceptions', () => {
    const { proxy, revoke } = Proxy.revocable(new Uint8Array(10), {});
    revoke();

    expect(appCandidateCopyBytes(proxy)).toBeNull();
    expect(appSnapshotCopyBytes(proxy)).toBeNull();
  });

  it('rejects verified claims with extra string or symbol keys', () => {
    const valid = {
      issuer: 'https://issuer.example.com',
      subject: 'sub-1',
      email: 'a@b.com',
      displayName: 'Name',
    };
    expect(snapshotVerifiedClaims(valid)).not.toBeNull();

    const withExtraString = { ...valid, extraKey: 'attacker-value' };
    expect(snapshotVerifiedClaims(withExtraString)).toBeNull();

    const withExtraSymbol = { ...valid, [Symbol('hostile')]: 'sentinel' };
    expect(snapshotVerifiedClaims(withExtraSymbol)).toBeNull();
  });

  it('rejects decrypted secrets with extra string or symbol keys', () => {
    const valid = { pkceVerifier: 'verifier-val-12345', nonce: 'nonce-val-12345' };
    expect(snapshotSecrets(valid)).not.toBeNull();

    const withExtraString = { ...valid, extra: 'bad' };
    expect(snapshotSecrets(withExtraString)).toBeNull();

    const withExtraSymbol = { ...valid, [Symbol('hostile')]: 'bad' };
    expect(snapshotSecrets(withExtraSymbol)).toBeNull();
  });

  it('rejects consumed transactions with extra string or symbol keys', () => {
    const valid = {
      id: '0192b012-3456-789a-8bcd-ef0123456789',
      keyVersion: 'v1',
      returnTo: '/',
      encryptedSecrets: {
        ciphertext: new Uint8Array([1, 2, 3]),
        iv: new Uint8Array(12).fill(4),
        authTag: new Uint8Array(16).fill(5),
        keyVersion: 'v1',
      },
      createdAt: '2026-11-02T12:00:00.000Z',
      expiresAt: '2026-11-02T12:10:00.000Z',
    };
    expect(snapshotConsumedTx(valid)).not.toBeNull();

    const withExtraTxKey = { ...valid, extra: 'forbidden' };
    expect(snapshotConsumedTx(withExtraTxKey)).toBeNull();

    const withExtraTxSymbol = { ...valid, [Symbol('forbidden')]: 'x' };
    expect(snapshotConsumedTx(withExtraTxSymbol)).toBeNull();

    const withExtraSecKey = {
      ...valid,
      encryptedSecrets: { ...valid.encryptedSecrets, extraSec: 'bad' },
    };
    expect(snapshotConsumedTx(withExtraSecKey)).toBeNull();
  });

  it('rejects candidate sessions and users with extra string or symbol keys', () => {
    const validCand = {
      id: '0192b012-3456-789a-8bcd-ef0123456720',
      userId: '0192b012-3456-789a-8bcd-ef0123456710',
      currentTokenHash: new Uint8Array(32).fill(1),
      previousTokenHash: null,
      previousTokenValidUntil: null,
      createdAt: '2026-11-02T11:00:00.000Z',
      lastSeenAt: '2026-11-02T11:58:00.000Z',
      idleExpiresAt: '2026-11-02T12:28:00.000Z',
      absoluteExpiresAt: '2026-11-02T19:00:00.000Z',
      rotatedAt: '2026-11-02T11:50:00.000Z',
      revokedAt: null,
      revocationReason: null,
      version: 1,
    };
    expect(extractSingleCandidate([validCand])).not.toBeNull();

    const withExtraCand = { ...validCand, extra: 'bad' };
    expect(extractSingleCandidate([withExtraCand])).toBeNull();

    const withCandSymbol = { ...validCand, [Symbol('sym')]: 'bad' };
    expect(extractSingleCandidate([withCandSymbol])).toBeNull();

    const validUser = {
      id: '0192b012-3456-789a-8bcd-ef0123456710',
      identityProvider: 'https://auth.example.com',
      identitySubject: 'sub-1',
      email: 'u@ex.com',
      displayName: 'User',
      status: 'active',
      createdAt: '2026-11-02T11:00:00.000Z',
      updatedAt: '2026-11-02T11:00:00.000Z',
      version: 1,
    };
    expect(safeExtractUser(validUser)).not.toBeNull();

    const withExtraUser = { ...validUser, extraUserKey: 123 };
    expect(safeExtractUser(withExtraUser)).toBeNull();

    const withUserSymbol = { ...validUser, [Symbol('userSym')]: 123 };
    expect(safeExtractUser(withUserSymbol)).toBeNull();
  });
});
