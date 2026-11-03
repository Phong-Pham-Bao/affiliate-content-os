import { describe, expect, it } from 'vitest';
import { copyBytes as dbCopyBytes } from '../../src/auth/mapper-helpers.js';

describe('Issue 1: Hostile Proxies and Byte Snapshots (Infrastructure)', () => {
  it('executes zero getPrototypeOf trap calls when proxy is passed to infrastructure copyBytes', () => {
    let trapCalls = 0;
    const proxyTarget = new Uint8Array(16);
    const hostileProxy = new Proxy(proxyTarget, {
      getPrototypeOf() {
        trapCalls++;
        throw new Error('PROXY_TRAP_SENTINEL');
      },
    });

    expect(() => dbCopyBytes(hostileProxy)).toThrow('Failed to map byte column');
    expect(trapCalls).toBe(0);
  });

  it('executes zero own byteLength/length getters and leaks no sentinels in infrastructure copyBytes', () => {
    let hookCalls = 0;
    const u8Db = new Uint8Array(32);
    Object.defineProperty(u8Db, 'length', {
      get() {
        hookCalls++;
        throw new Error('db:SENTINEL');
      },
    });

    const u8ByteLen = new Uint8Array(32);
    Object.defineProperty(u8ByteLen, 'byteLength', {
      get() {
        hookCalls++;
        throw new Error('db:SENTINEL');
      },
    });

    expect(() => dbCopyBytes(u8Db)).toThrow('Failed to map byte column');
    expect(() => dbCopyBytes(u8ByteLen)).toThrow('Failed to map byte column');
    expect(hookCalls).toBe(0);
  });

  it('safely handles revoked proxies with zero unhandled exceptions', () => {
    const { proxy, revoke } = Proxy.revocable(new Uint8Array(10), {});
    revoke();

    expect(() => dbCopyBytes(proxy)).toThrow('Failed to map byte column');
  });

  it('safely copies canonical Buffer and Uint8Array instances', () => {
    const buf = Buffer.from([10, 20, 30]);
    const copiedBuf = dbCopyBytes(buf);
    expect(copiedBuf).toEqual(new Uint8Array([10, 20, 30]));
    expect(copiedBuf).not.toBe(buf);

    const u8 = new Uint8Array([40, 50, 60]);
    const copiedU8 = dbCopyBytes(u8);
    expect(copiedU8).toEqual(new Uint8Array([40, 50, 60]));
    expect(copiedU8).not.toBe(u8);

    expect(dbCopyBytes(null)).toBeNull();
    expect(dbCopyBytes(undefined)).toBeNull();
  });
});
