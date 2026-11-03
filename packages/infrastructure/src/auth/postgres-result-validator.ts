import { DatabaseError } from '../database/errors.js';
import { isProxySafe } from './mapper-helpers.js';

const ALLOWED_RESULT_KEYS = new Set(['rows', 'rowCount', 'command']);

export interface ValidatedQueryResultSnapshot {
  readonly rows: unknown;
  readonly rowCount: number;
  readonly command: string;
}

export function validateDatabaseQueryResult(
  result: unknown,
  expectedCommand?: 'SELECT' | 'INSERT' | 'UPDATE',
): ValidatedQueryResultSnapshot {
  if (typeof result !== 'object' || result === null || isProxySafe(result)) {
    throw new DatabaseError('Database query result validation failed');
  }

  const proto = Object.getPrototypeOf(result);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Database query result validation failed');
  }

  const keys = Reflect.ownKeys(result);
  if (keys.length !== ALLOWED_RESULT_KEYS.size) {
    throw new DatabaseError('Database query result validation failed');
  }
  for (const k of keys) {
    if (typeof k !== 'string' || !ALLOWED_RESULT_KEYS.has(k)) {
      throw new DatabaseError('Database query result validation failed');
    }
  }

  const rowsDesc = Object.getOwnPropertyDescriptor(result, 'rows');
  const countDesc = Object.getOwnPropertyDescriptor(result, 'rowCount');
  const cmdDesc = Object.getOwnPropertyDescriptor(result, 'command');

  if (
    !rowsDesc ||
    rowsDesc.get !== undefined ||
    rowsDesc.set !== undefined ||
    !countDesc ||
    countDesc.get !== undefined ||
    countDesc.set !== undefined ||
    !cmdDesc ||
    cmdDesc.get !== undefined ||
    cmdDesc.set !== undefined
  ) {
    throw new DatabaseError('Database query result validation failed');
  }

  const rowCount = countDesc.value;
  if (typeof rowCount !== 'number' || !Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new DatabaseError('Database query result validation failed');
  }

  const command = cmdDesc.value;
  if (typeof command !== 'string') {
    throw new DatabaseError('Database query result validation failed');
  }

  if (expectedCommand !== undefined && command !== expectedCommand) {
    throw new DatabaseError('Database query result validation failed');
  }

  return {
    rows: rowsDesc.value,
    rowCount,
    command,
  };
}

export function validateSelectQueryResult(
  result: unknown,
  minLen: number,
  maxLen: number,
): unknown[] {
  const validated = validateDatabaseQueryResult(result, 'SELECT');
  const rows = validateGenuineRowsArray(validated.rows, minLen, maxLen);
  if (validated.rowCount !== rows.length) {
    throw new DatabaseError('Database query result validation failed');
  }
  return rows;
}

export function validateGenuineRowsArray(
  rawRows: unknown,
  minLen: number,
  maxLen: number,
): unknown[] {
  if (typeof rawRows !== 'object' || rawRows === null || isProxySafe(rawRows)) {
    throw new DatabaseError('Database query result validation failed');
  }

  if (!Array.isArray(rawRows)) {
    throw new DatabaseError('Database query result validation failed');
  }

  if (Object.getPrototypeOf(rawRows) !== Array.prototype) {
    throw new DatabaseError('Database query result validation failed');
  }

  const lenDesc = Object.getOwnPropertyDescriptor(rawRows, 'length');
  if (
    !lenDesc ||
    lenDesc.get !== undefined ||
    lenDesc.set !== undefined ||
    typeof lenDesc.value !== 'number' ||
    !Number.isSafeInteger(lenDesc.value) ||
    lenDesc.value < minLen ||
    lenDesc.value > maxLen
  ) {
    throw new DatabaseError('Database query result validation failed');
  }

  const len = lenDesc.value;
  const ownKeys = Reflect.ownKeys(rawRows);
  if (ownKeys.length !== len + 1) {
    throw new DatabaseError('Database query result validation failed');
  }

  for (let i = 0; i < len; i++) {
    if (ownKeys[i] !== String(i)) {
      throw new DatabaseError('Database query result validation failed');
    }
  }
  if (ownKeys[len] !== 'length') {
    throw new DatabaseError('Database query result validation failed');
  }

  const capturedRows: unknown[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const desc = Object.getOwnPropertyDescriptor(rawRows, String(i));
    if (!desc || desc.get !== undefined || desc.set !== undefined) {
      throw new DatabaseError('Database query result validation failed');
    }
    capturedRows[i] = desc.value;
  }

  return capturedRows;
}
