import util from 'node:util';
import type { IsoTimestamp } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

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

export function parseIsoTimestamp(val: unknown): IsoTimestamp {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(val)) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime()) && d.toISOString() === val) {
      return val as IsoTimestamp;
    }
  }
  if (typeof val === 'object' && val !== null && !isProxySafe(val)) {
    if (Object.getPrototypeOf(val) === Date.prototype) {
      if (Reflect.ownKeys(val).length === 0) {
        const epoch = Date.prototype.getTime.call(val);
        if (typeof epoch === 'number' && Number.isFinite(epoch)) {
          const freshDate = new Date(epoch);
          const isoString = Date.prototype.toISOString.call(freshDate);
          if (new Date(isoString).toISOString() === isoString) {
            return isoString as IsoTimestamp;
          }
        }
      }
    }
  }
  throw new DatabaseError('Failed to map row timestamp');
}

export function parseVersion(val: unknown): number {
  if (typeof val === 'number' && Number.isSafeInteger(val) && val >= 1) {
    return val;
  }
  if (typeof val === 'string' && /^[1-9]\d*$/.test(val)) {
    const num = Number.parseInt(val, 10);
    if (Number.isSafeInteger(num) && num >= 1) {
      return num;
    }
  }
  if (typeof val === 'bigint' && val >= 1n && val <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(val);
  }
  throw new DatabaseError('Failed to map row version');
}

const TypedArrayProto = Object.getPrototypeOf(Uint8Array.prototype);
const getByteLength = Object.getOwnPropertyDescriptor(TypedArrayProto, 'byteLength')?.get;

export function copyBytes(val: unknown): Uint8Array | null {
  if (val === null || val === undefined) {
    return null;
  }
  if (typeof val !== 'object' || isProxySafe(val)) {
    throw new DatabaseError('Failed to map byte column');
  }
  if (!util.types.isUint8Array(val)) {
    throw new DatabaseError('Failed to map byte column');
  }
  const proto = Object.getPrototypeOf(val);
  if (proto !== Uint8Array.prototype && proto !== Buffer.prototype) {
    throw new DatabaseError('Failed to map byte column');
  }
  if (!getByteLength) {
    throw new DatabaseError('Failed to map byte column');
  }
  let len: number;
  try {
    len = getByteLength.call(val);
  } catch {
    throw new DatabaseError('Failed to map byte column');
  }
  if (typeof len !== 'number' || !Number.isSafeInteger(len) || len < 0) {
    throw new DatabaseError('Failed to map byte column');
  }
  const ownKeys = Reflect.ownKeys(val);
  if (ownKeys.length !== len) {
    throw new DatabaseError('Failed to map byte column');
  }
  const copy = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (ownKeys[i] !== String(i)) {
      throw new DatabaseError('Failed to map byte column');
    }
    const desc = Object.getOwnPropertyDescriptor(val, String(i));
    if (
      !desc ||
      desc.get !== undefined ||
      desc.set !== undefined ||
      typeof desc.value !== 'number'
    ) {
      throw new DatabaseError('Failed to map byte column');
    }
    copy[i] = desc.value;
  }
  return copy;
}
