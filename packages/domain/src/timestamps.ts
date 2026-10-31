import { DomainValidationError } from './errors.js';

declare const TimestampBrand: unique symbol;
export type IsoTimestamp = string & { readonly [TimestampBrand]: typeof TimestampBrand };

const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isValidIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== 'string') {
    return false;
  }
  if (!ISO_TIMESTAMP_REGEX.test(value)) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString() === value;
}

export function parseIsoTimestamp(value: unknown): IsoTimestamp {
  if (typeof value !== 'string') {
    throw new DomainValidationError('Timestamp must be a string', 'timestamp');
  }
  if (!ISO_TIMESTAMP_REGEX.test(value)) {
    throw new DomainValidationError(
      'Timestamp must be in canonical YYYY-MM-DDTHH:mm:ss.sssZ RFC 3339 format',
      'timestamp',
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new DomainValidationError(
      'Timestamp represents an invalid calendar instant',
      'timestamp',
    );
  }
  return value as IsoTimestamp;
}

export function dateToIsoTimestamp(date: unknown): IsoTimestamp {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new DomainValidationError('Date object must represent a valid instant', 'timestamp');
  }
  return date.toISOString() as IsoTimestamp;
}
