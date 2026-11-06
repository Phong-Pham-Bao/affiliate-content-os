import util from 'node:util';
import { ValidationError } from '../errors.js';

export function isProxy(val: unknown): boolean {
  if (val === null || (typeof val !== 'object' && typeof val !== 'function')) return false;
  try {
    return util.types.isProxy(val);
  } catch {
    return true;
  }
}

export function assertExactAllowedKeys(
  input: unknown,
  allowedKeys: readonly string[],
  contextName: string,
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError(`${contextName} must be a non-null object`, 'command');
  }
  if (isProxy(input)) {
    throw new ValidationError(`${contextName} must not be a proxy`, 'command');
  }
  if (Array.isArray(input)) {
    throw new ValidationError(`${contextName} must not be an array`, 'command');
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(input);
  } catch {
    throw new ValidationError(`Failed to inspect prototype of ${contextName}`, 'command');
  }
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError(`${contextName} must have plain Object prototype`, 'command');
  }
  if (proto !== null && isProxy(proto)) {
    throw new ValidationError(`${contextName} prototype must not be a proxy`, 'command');
  }

  const allowedSet = new Set(allowedKeys);
  const ownKeys = Reflect.ownKeys(input);
  for (const k of ownKeys) {
    if (typeof k === 'symbol') {
      throw new ValidationError(`Symbol properties are prohibited on ${contextName}`, 'command');
    }
    if (!allowedSet.has(k)) {
      throw new ValidationError(`Unexpected property "${k}" on ${contextName}`, k);
    }
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(input, k);
    } catch {
      throw new ValidationError(`Failed to get descriptor for "${k}"`, k);
    }
    if (!desc) {
      throw new ValidationError(`Missing descriptor for property "${k}"`, k);
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      throw new ValidationError(`Accessor properties are prohibited on ${contextName}: "${k}"`, k);
    }
  }

  return input as Record<string, unknown>;
}

export function extractExactString(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
): string | undefined {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || desc.value === undefined || desc.value === null) {
    if (required) {
      throw new ValidationError(`${key} is required`, key);
    }
    return undefined;
  }
  const val = desc.value;
  if (typeof val !== 'string') {
    throw new ValidationError(`${key} must be a string`, key);
  }
  return val;
}

export function extractExactNullableString(
  obj: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || desc.value === undefined) {
    return undefined;
  }
  const val = desc.value;
  if (val === null) {
    return null;
  }
  if (typeof val !== 'string') {
    throw new ValidationError(`${key} must be a string or null`, key);
  }
  return val;
}

export function extractExactInteger(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
): number | undefined {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || desc.value === undefined || desc.value === null) {
    if (required) {
      throw new ValidationError(`${key} is required`, key);
    }
    return undefined;
  }
  const val = desc.value;
  if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
    throw new ValidationError(`${key} must be a safe integer`, key);
  }
  return val;
}

export function extractPageLimit(obj: Record<string, unknown>, key = 'limit'): number {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || desc.value === undefined || desc.value === null) {
    return 20;
  }
  const val = desc.value;
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 1 || val > 100) {
    throw new ValidationError('limit must be an integer between 1 and 100', 'limit');
  }
  return val;
}

export function extractProductCreateStatus(
  obj: Record<string, unknown>,
  key = 'status',
): 'draft' | 'active' {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || desc.value === undefined || desc.value === null) {
    return 'draft';
  }
  const val = desc.value;
  if (typeof val !== 'string') {
    throw new ValidationError(`${key} must be a string`, key);
  }
  if (val === 'draft' || val === 'active') {
    return val;
  }
  if (val === 'archived') {
    throw new ValidationError('Product status cannot be created as archived', key);
  }
  throw new ValidationError(`Invalid product status: ${val}`, key);
}
