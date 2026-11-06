import util from 'node:util';
import { isValidIsoTimestamp, type IsoTimestamp } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

export function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

export function mapSafeTimestamp(value: unknown, fieldName: string): IsoTimestamp {
  if (typeof value === 'string') {
    if (!isValidIsoTimestamp(value)) {
      throw new DatabaseError(`Invalid ${fieldName} timestamp string`);
    }
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    if (isProxySafe(value)) {
      throw new DatabaseError(`Invalid ${fieldName} timestamp proxy`);
    }
    if (Object.getPrototypeOf(value) !== Date.prototype) {
      throw new DatabaseError(`Invalid ${fieldName} timestamp prototype`);
    }
    if (Reflect.ownKeys(value).length !== 0) {
      throw new DatabaseError(`Invalid ${fieldName} timestamp keys`);
    }
    const epoch = Date.prototype.getTime.call(value);
    if (typeof epoch !== 'number' || !Number.isFinite(epoch)) {
      throw new DatabaseError(`Invalid ${fieldName} timestamp epoch`);
    }
    const freshDate = new Date(epoch);
    const isoString = Date.prototype.toISOString.call(freshDate);
    if (!isValidIsoTimestamp(isoString)) {
      throw new DatabaseError(`Invalid ${fieldName} timestamp iso`);
    }
    return isoString;
  }
  throw new DatabaseError(`Invalid ${fieldName} timestamp`);
}

export function copyPlainJsonValue(val: unknown, depth = 0): unknown {
  if (depth > 20) {
    throw new DatabaseError('JSON depth limit exceeded');
  }
  if (val === null || typeof val === 'boolean' || typeof val === 'string') {
    return val;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new DatabaseError('Invalid JSON number');
    }
    return val;
  }
  if (typeof val !== 'object' || isProxySafe(val)) {
    throw new DatabaseError('Invalid JSON value type or proxy');
  }
  if (Array.isArray(val)) {
    if (Object.getPrototypeOf(val) !== Array.prototype) {
      throw new DatabaseError('Invalid array prototype');
    }
    const ownKeys = Reflect.ownKeys(val);
    if (ownKeys.length !== val.length + 1) {
      throw new DatabaseError('Array has unexpected own properties or sparse elements');
    }
    const lenDesc = Object.getOwnPropertyDescriptor(val, 'length');
    if (!lenDesc || lenDesc.get !== undefined || lenDesc.set !== undefined) {
      throw new DatabaseError('Invalid length descriptor in array');
    }
    const copiedArray: unknown[] = new Array(val.length);
    for (let i = 0; i < val.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(val, String(i));
      if (!desc || desc.get !== undefined || desc.set !== undefined || !desc.enumerable) {
        throw new DatabaseError(`Getter/setter detected in array index ${i}`);
      }
      copiedArray[i] = copyPlainJsonValue(desc.value, depth + 1);
    }
    return Object.freeze(copiedArray);
  }
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('response_json must have Object or null prototype');
  }
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(val)) {
    if (typeof key !== 'string') {
      throw new DatabaseError('response_json keys must be strings');
    }
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new DatabaseError('Prototype pollution attempt in response_json');
    }
    const desc = Object.getOwnPropertyDescriptor(val, key);
    if (!desc || desc.get !== undefined || desc.set !== undefined || !desc.enumerable) {
      throw new DatabaseError(`Getter/setter detected in response_json for ${key}`);
    }
    result[key] = copyPlainJsonValue(desc.value, depth + 1);
  }
  return Object.freeze(result);
}
