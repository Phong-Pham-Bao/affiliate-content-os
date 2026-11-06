import util from 'node:util';
import { DomainValidationError } from '../errors.js';

export function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

export function assertPlainObject(
  target: unknown,
  fieldName = 'input',
): Record<string | symbol, unknown> {
  if (typeof target !== 'object' || target === null) {
    throw new DomainValidationError(`${fieldName} must be a non-null object`, fieldName);
  }
  if (isProxySafe(target)) {
    throw new DomainValidationError(`${fieldName} must not be a proxy`, fieldName);
  }
  if (Array.isArray(target)) {
    throw new DomainValidationError(`${fieldName} must not be an array`, fieldName);
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(target);
  } catch {
    throw new DomainValidationError(`Failed to inspect prototype of ${fieldName}`, fieldName);
  }

  if (proto !== Object.prototype && proto !== null) {
    throw new DomainValidationError(
      `${fieldName} must have Object.prototype or null prototype`,
      fieldName,
    );
  }

  return target as Record<string | symbol, unknown>;
}

export function getDataPropertyDescriptor(
  obj: object,
  key: string | symbol,
  fieldName = String(key),
): PropertyDescriptor {
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    throw new DomainValidationError(
      `Failed to inspect property descriptor for ${fieldName}`,
      fieldName,
    );
  }

  if (!desc) {
    throw new DomainValidationError(`Missing property descriptor for ${fieldName}`, fieldName);
  }

  if (desc.get !== undefined || desc.set !== undefined) {
    throw new DomainValidationError(
      `Accessor properties (getters/setters) are prohibited for ${fieldName}`,
      fieldName,
    );
  }

  if (isProxySafe(desc.value)) {
    throw new DomainValidationError(
      `Property value for ${fieldName} must not be a proxy`,
      fieldName,
    );
  }

  return desc;
}

export function assertNoCoercionHooks(value: unknown, fieldName: string): void {
  if (typeof value === 'object' && value !== null) {
    if (isProxySafe(value)) {
      throw new DomainValidationError(`${fieldName} must not be a proxy`, fieldName);
    }
    const hasValueOf = Object.prototype.hasOwnProperty.call(value, 'valueOf');
    const hasToString = Object.prototype.hasOwnProperty.call(value, 'toString');
    const hasToPrimitive = Object.prototype.hasOwnProperty.call(value, Symbol.toPrimitive);
    if (hasValueOf || hasToString || hasToPrimitive) {
      throw new DomainValidationError(`Coercion hooks are prohibited on ${fieldName}`, fieldName);
    }
  }
}
