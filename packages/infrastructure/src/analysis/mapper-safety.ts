import util from 'node:util';
import { DatabaseError } from '../database/errors.js';

export function validateSafeInteger(
  val: unknown,
  fieldName: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof val === 'number') {
    if (!Number.isSafeInteger(val) || val < min || val > max) {
      throw new DatabaseError(`Invalid integer for ${fieldName}: ${val}`);
    }
    return val;
  }
  if (typeof val === 'string') {
    if (!/^-?\d+$/.test(val)) {
      throw new DatabaseError(`Invalid integer string for ${fieldName}: ${val}`);
    }
    const num = Number(val);
    if (!Number.isSafeInteger(num) || num < min || num > max) {
      throw new DatabaseError(`Integer out of range for ${fieldName}: ${val}`);
    }
    return num;
  }
  throw new DatabaseError(`Expected integer for ${fieldName}`);
}

export function validateOptionalSafeInteger(
  val: unknown,
  fieldName: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  if (val === null || val === undefined) {
    return null;
  }
  return validateSafeInteger(val, fieldName, min, max);
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (util.types.isProxy(value)) {
    throw new DatabaseError('Cannot freeze proxy object in database mapper');
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value) as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Invalid prototype for JSON content object');
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc) continue;
    if (desc.get !== undefined || desc.set !== undefined) {
      throw new DatabaseError(`Accessor property "${key}" prohibited in mapper`);
    }
    deepFreeze((value as Record<string, unknown>)[key]);
  }

  return Object.freeze(value) as T;
}
