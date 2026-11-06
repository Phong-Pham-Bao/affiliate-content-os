import util from 'node:util';
import {
  isValidIsoTimestamp,
  isValidUuidV7,
  validateSafeHttpUrl,
  type IsoTimestamp,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

export function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

export function extractOwnRowProperties(
  row: unknown,
  expectedColumns: readonly string[],
): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || isProxySafe(row)) {
    throw new DatabaseError('Corrupt database row: invalid row structure');
  }

  const proto = Object.getPrototypeOf(row);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Corrupt database row: invalid row prototype');
  }

  const ownKeys = Reflect.ownKeys(row);
  if (ownKeys.length !== expectedColumns.length) {
    throw new DatabaseError('Corrupt database row: unexpected column count');
  }

  const result: Record<string, unknown> = {};
  for (const col of expectedColumns) {
    const desc = Object.getOwnPropertyDescriptor(row, col);
    if (!desc || desc.get !== undefined || desc.set !== undefined || !desc.enumerable) {
      throw new DatabaseError(`Corrupt database row: invalid descriptor for ${col}`);
    }
    result[col] = desc.value;
  }

  return result;
}

export function mapSafeTimestamp(value: unknown, fieldName: string): IsoTimestamp {
  if (typeof value === 'string') {
    if (!isValidIsoTimestamp(value)) {
      throw new DatabaseError(`Corrupt database row: invalid ${fieldName} timestamp string`);
    }
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    if (isProxySafe(value)) {
      throw new DatabaseError(`Corrupt database row: invalid ${fieldName} timestamp proxy`);
    }
    if (Object.getPrototypeOf(value) !== Date.prototype) {
      throw new DatabaseError(`Corrupt database row: invalid ${fieldName} timestamp prototype`);
    }
    if (Reflect.ownKeys(value).length !== 0) {
      throw new DatabaseError(`Corrupt database row: invalid ${fieldName} timestamp keys`);
    }
    const epoch = Date.prototype.getTime.call(value);
    if (typeof epoch !== 'number' || !Number.isFinite(epoch)) {
      throw new DatabaseError(`Corrupt database row: invalid ${fieldName} timestamp epoch`);
    }
    const freshDate = new Date(epoch);
    const isoString = Date.prototype.toISOString.call(freshDate);
    if (!isValidIsoTimestamp(isoString)) {
      throw new DatabaseError(`Corrupt database row: invalid ${fieldName} timestamp iso`);
    }
    return isoString;
  }
  throw new DatabaseError(`Corrupt database row: invalid ${fieldName} timestamp type`);
}

export function validateSafeVersion(value: unknown, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new DatabaseError(`Corrupt database row: invalid version for ${fieldName}`);
    }
    return value;
  }
  if (typeof value === 'string') {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new DatabaseError(`Corrupt database row: invalid version for ${fieldName}`);
    }
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num < 1) {
      throw new DatabaseError(`Corrupt database row: invalid version for ${fieldName}`);
    }
    return num;
  }
  throw new DatabaseError(`Corrupt database row: invalid version type for ${fieldName}`);
}

export function validateSafeRevision(value: unknown, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new DatabaseError(`Corrupt database row: invalid revision for ${fieldName}`);
    }
    return value;
  }
  if (typeof value === 'string') {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new DatabaseError(`Corrupt database row: invalid revision for ${fieldName}`);
    }
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num < 1) {
      throw new DatabaseError(`Corrupt database row: invalid revision for ${fieldName}`);
    }
    return num;
  }
  throw new DatabaseError(`Corrupt database row: invalid revision type for ${fieldName}`);
}

export function validateUuid(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !isValidUuidV7(value)) {
    throw new DatabaseError(`Corrupt database row: invalid UUIDv7 for ${fieldName}`);
  }
  return value;
}

export function validateAndCopy32ByteHash(raw: unknown, fieldName: string): Uint8Array {
  if (typeof raw !== 'object' || raw === null || isProxySafe(raw)) {
    throw new DatabaseError(`Corrupt database row: ${fieldName} must be a binary buffer`);
  }
  if (!(raw instanceof Uint8Array || Buffer.isBuffer(raw))) {
    throw new DatabaseError(`Corrupt database row: ${fieldName} must be a binary buffer`);
  }
  if (raw.byteLength !== 32) {
    throw new DatabaseError(`Corrupt database row: ${fieldName} must be exactly 32 bytes`);
  }
  return new Uint8Array(raw);
}

export function validateBoundedString(
  val: unknown,
  fieldName: string,
  minLen: number,
  maxLen: number,
  allowControlChars = false,
): string {
  if (typeof val !== 'string' || isProxySafe(val)) {
    throw new DatabaseError(`Corrupt database row: ${fieldName} must be a string`);
  }
  const trimmed = val.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    throw new DatabaseError(`Corrupt database row: ${fieldName} length out of bounds`);
  }
  if (!allowControlChars && CONTROL_CHARS_REGEX.test(trimmed)) {
    throw new DatabaseError(`Corrupt database row: ${fieldName} contains control characters`);
  }
  return trimmed;
}

export function validateOptionalBoundedString(
  val: unknown,
  fieldName: string,
  maxLen: number,
  allowControlChars = false,
): string | null {
  if (val === null || val === undefined) {
    return null;
  }
  return validateBoundedString(val, fieldName, 1, maxLen, allowControlChars);
}

export function validateSafeUrl(val: unknown, fieldName: string): string {
  try {
    return validateSafeHttpUrl(val, fieldName);
  } catch {
    throw new DatabaseError(`Corrupt database row: invalid URL for ${fieldName}`);
  }
}

export function validateEnum<T extends string>(
  val: unknown,
  fieldName: string,
  allowed: readonly T[],
): T {
  if (typeof val !== 'string' || !allowed.includes(val as T)) {
    throw new DatabaseError(`Corrupt database row: invalid enum value for ${fieldName}`);
  }
  return val as T;
}
