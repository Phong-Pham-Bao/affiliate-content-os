import { isValidUuidV7, type IsoTimestamp } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { copyBytes, isProxySafe, parseIsoTimestamp } from './mapper-helpers.js';

export interface ConsumedLoginTransactionRow {
  readonly id: string;
  readonly keyVersion: string;
  readonly returnTo: string;
  readonly secretsCiphertext: Uint8Array;
  readonly secretsIv: Uint8Array;
  readonly secretsAuthTag: Uint8Array;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
}

const REQUIRED_TRANSACTION_ROW_KEYS = [
  'id',
  'key_version',
  'return_to',
  'secrets_ciphertext',
  'secrets_iv',
  'secrets_auth_tag',
  'created_at',
  'expires_at',
] as const;

export function mapConsumedTransactionRow(rawRow: unknown): ConsumedLoginTransactionRow {
  if (typeof rawRow !== 'object' || rawRow === null || isProxySafe(rawRow)) {
    throw new DatabaseError('Failed to map transaction row');
  }
  const proto = Object.getPrototypeOf(rawRow);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Failed to map transaction row');
  }

  const ownKeys = Reflect.ownKeys(rawRow);
  if (ownKeys.length !== REQUIRED_TRANSACTION_ROW_KEYS.length) {
    throw new DatabaseError('Failed to map transaction row');
  }

  const values: Record<string, unknown> = Object.create(null);
  for (const key of REQUIRED_TRANSACTION_ROW_KEYS) {
    const desc = Object.getOwnPropertyDescriptor(rawRow, key);
    if (!desc || desc.get !== undefined || desc.set !== undefined) {
      throw new DatabaseError('Failed to map transaction row');
    }
    values[key] = desc.value;
  }

  const id = values['id'];
  if (typeof id !== 'string' || !isValidUuidV7(id)) {
    throw new DatabaseError('Failed to map transaction row');
  }

  const keyVersion = values['key_version'];
  if (typeof keyVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) {
    throw new DatabaseError('Failed to map transaction row');
  }

  const returnTo = values['return_to'];
  if (typeof returnTo !== 'string' || returnTo.length === 0 || returnTo.length > 2048) {
    throw new DatabaseError('Failed to map transaction row');
  }

  const ciphertext = copyBytes(values['secrets_ciphertext']);
  const iv = copyBytes(values['secrets_iv']);
  const tag = copyBytes(values['secrets_auth_tag']);

  if (!ciphertext || !iv || !tag || iv.length !== 12 || tag.length !== 16) {
    throw new DatabaseError('Failed to map transaction row');
  }

  const createdAt = parseIsoTimestamp(values['created_at']);
  const expiresAt = parseIsoTimestamp(values['expires_at']);

  const createdMs = new Date(createdAt).getTime();
  const expiresMs = new Date(expiresAt).getTime();
  if (createdMs >= expiresMs) {
    throw new DatabaseError('Failed to map transaction row');
  }

  return Object.freeze({
    id,
    keyVersion,
    returnTo,
    secretsCiphertext: ciphertext,
    secretsIv: iv,
    secretsAuthTag: tag,
    createdAt,
    expiresAt,
  });
}
