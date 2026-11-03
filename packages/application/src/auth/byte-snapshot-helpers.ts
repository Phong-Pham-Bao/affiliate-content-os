import util from 'node:util';
import { AuthenticationRequiredError } from './errors.js';

export function isProxySafe(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

const TypedArrayProto = Object.getPrototypeOf(Uint8Array.prototype);
const getByteLength = Object.getOwnPropertyDescriptor(TypedArrayProto, 'byteLength')?.get;

export function copyBytes(val: unknown): Uint8Array | null {
  if (val === null || typeof val !== 'object' || isProxySafe(val)) return null;
  if (!util.types.isUint8Array(val)) return null;
  if (Object.getPrototypeOf(val) !== Uint8Array.prototype) return null;
  if (!getByteLength) return null;
  let len: number;
  try {
    len = getByteLength.call(val);
  } catch {
    return null;
  }
  if (typeof len !== 'number' || !Number.isSafeInteger(len) || len < 0) return null;
  const ownKeys = Reflect.ownKeys(val);
  if (ownKeys.length !== len) return null;
  const copy = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (ownKeys[i] !== String(i)) return null;
    const desc = Object.getOwnPropertyDescriptor(val, String(i));
    if (
      !desc ||
      desc.get !== undefined ||
      desc.set !== undefined ||
      typeof desc.value !== 'number'
    ) {
      return null;
    }
    copy[i] = desc.value;
  }
  return copy;
}

export function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function validateSessionCookie(cookie: unknown): string {
  if (
    typeof cookie !== 'string' ||
    cookie.length !== 43 ||
    cookie.includes('=') ||
    !/^[A-Za-z0-9_-]{43}$/.test(cookie)
  ) {
    throw new AuthenticationRequiredError();
  }
  return cookie;
}
