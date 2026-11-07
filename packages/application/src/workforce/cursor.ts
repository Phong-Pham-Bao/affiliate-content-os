import {
  isValidIsoTimestamp,
  parseWorkOrderId,
  type IsoTimestamp,
  type WorkOrderId,
} from '@affiliate-content-os/domain';
import { ValidationError } from '../errors.js';

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;
const MAX_ENCODED_CURSOR_LENGTH = 512;
const MAX_DECODED_JSON_LENGTH = 512;

function validateAndParseRawCursor(rawCursor: string): Record<string, unknown> {
  if (
    typeof rawCursor !== 'string' ||
    rawCursor.length === 0 ||
    rawCursor.length > MAX_ENCODED_CURSOR_LENGTH ||
    !BASE64URL_REGEX.test(rawCursor)
  ) {
    throw new ValidationError('Invalid cursor parameter', 'cursor');
  }

  const buf = Buffer.from(rawCursor, 'base64url');
  if (buf.toString('base64url') !== rawCursor) {
    throw new ValidationError('Non-canonical base64url cursor encoding', 'cursor');
  }

  const jsonStr = buf.toString('utf8');
  if (jsonStr.length > MAX_DECODED_JSON_LENGTH) {
    throw new ValidationError('Cursor payload exceeds maximum allowed size', 'cursor');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new ValidationError('Malformed JSON in cursor', 'cursor');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError('Invalid cursor payload structure', 'cursor');
  }

  const proto = Object.getPrototypeOf(parsed);
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError('Invalid cursor prototype', 'cursor');
  }

  return parsed as Record<string, unknown>;
}

export interface DecodedWorkOrderCursor {
  readonly updatedAt: IsoTimestamp;
  readonly id: WorkOrderId;
}

export function encodeWorkOrderCursor(
  cursorOrUpdatedAt: DecodedWorkOrderCursor | IsoTimestamp,
  maybeId?: WorkOrderId | string,
): string {
  const u =
    typeof cursorOrUpdatedAt === 'object' && cursorOrUpdatedAt !== null
      ? cursorOrUpdatedAt.updatedAt
      : cursorOrUpdatedAt;
  const i =
    typeof cursorOrUpdatedAt === 'object' && cursorOrUpdatedAt !== null
      ? cursorOrUpdatedAt.id
      : maybeId!;
  const payload = JSON.stringify({ u, i });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeWorkOrderCursor(rawCursor: string): DecodedWorkOrderCursor {
  const parsed = validateAndParseRawCursor(rawCursor);
  const keys = Reflect.ownKeys(parsed);
  if (keys.length !== 2 || !keys.includes('u') || !keys.includes('i')) {
    throw new ValidationError('Cursor has unexpected payload keys', 'cursor');
  }

  const u = parsed['u'];
  const i = parsed['i'];

  if (typeof u !== 'string' || !isValidIsoTimestamp(u)) {
    throw new ValidationError('Cursor contains invalid timestamp', 'cursor');
  }

  let validId: WorkOrderId;
  try {
    validId = parseWorkOrderId(i, 'cursor');
  } catch {
    throw new ValidationError('Cursor contains invalid work order ID', 'cursor');
  }

  return Object.freeze({
    updatedAt: u as IsoTimestamp,
    id: validId,
  });
}
