import { isValidIsoTimestamp, isValidUuidV7 } from '@affiliate-content-os/domain';
import type {
  ConsumedLoginTransactionDTO,
  OidcExchangeResult,
  VerifiedOidcClaimsDTO,
} from './ports.js';
import { copyBytes, isProxySafe } from './byte-snapshot-helpers.js';
import { validateReturnTo } from './begin-oidc-login.js';

export { copyBytes, isProxySafe };
export { parseCallbackQuery, validateTransactionCookie } from './complete-oidc-login-query.js';

const ALLOWED_TX_KEYS = new Set([
  'id',
  'keyVersion',
  'returnTo',
  'encryptedSecrets',
  'createdAt',
  'expiresAt',
]);
const ALLOWED_SEC_KEYS = new Set(['ciphertext', 'iv', 'authTag', 'keyVersion']);
const KEY_VERSION_REGEX = /^[A-Za-z0-9._-]{1,64}$/;

export function snapshotConsumedTx(val: unknown): ConsumedLoginTransactionDTO | null {
  if (typeof val !== 'object' || val === null || isProxySafe(val)) return null;
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null) return null;

  const valKeys = Reflect.ownKeys(val);
  if (valKeys.length !== ALLOWED_TX_KEYS.size) return null;
  for (const k of valKeys) {
    if (typeof k !== 'string' || !ALLOWED_TX_KEYS.has(k)) return null;
  }

  const idDesc = Object.getOwnPropertyDescriptor(val, 'id');
  const kvDesc = Object.getOwnPropertyDescriptor(val, 'keyVersion');
  const returnToDesc = Object.getOwnPropertyDescriptor(val, 'returnTo');
  const secDesc = Object.getOwnPropertyDescriptor(val, 'encryptedSecrets');
  const createdDesc = Object.getOwnPropertyDescriptor(val, 'createdAt');
  const expiresDesc = Object.getOwnPropertyDescriptor(val, 'expiresAt');

  if (
    !idDesc ||
    idDesc.get !== undefined ||
    idDesc.set !== undefined ||
    typeof idDesc.value !== 'string' ||
    !isValidUuidV7(idDesc.value) ||
    !kvDesc ||
    kvDesc.get !== undefined ||
    kvDesc.set !== undefined ||
    typeof kvDesc.value !== 'string' ||
    !KEY_VERSION_REGEX.test(kvDesc.value) ||
    !returnToDesc ||
    returnToDesc.get !== undefined ||
    returnToDesc.set !== undefined ||
    typeof returnToDesc.value !== 'string' ||
    !createdDesc ||
    createdDesc.get !== undefined ||
    createdDesc.set !== undefined ||
    typeof createdDesc.value !== 'string' ||
    !isValidIsoTimestamp(createdDesc.value) ||
    !expiresDesc ||
    expiresDesc.get !== undefined ||
    expiresDesc.set !== undefined ||
    typeof expiresDesc.value !== 'string' ||
    !isValidIsoTimestamp(expiresDesc.value) ||
    !secDesc ||
    secDesc.get !== undefined ||
    secDesc.set !== undefined ||
    typeof secDesc.value !== 'object' ||
    secDesc.value === null ||
    isProxySafe(secDesc.value)
  ) {
    return null;
  }

  try {
    const validatedPath = validateReturnTo(returnToDesc.value);
    if (validatedPath !== returnToDesc.value) {
      return null;
    }
  } catch {
    return null;
  }

  if (createdDesc.value >= expiresDesc.value) {
    return null;
  }

  const rawSec = secDesc.value;
  const secProto = Object.getPrototypeOf(rawSec);
  if (secProto !== Object.prototype && secProto !== null) return null;

  const secKeys = Reflect.ownKeys(rawSec);
  if (secKeys.length !== ALLOWED_SEC_KEYS.size) return null;
  for (const k of secKeys) {
    if (typeof k !== 'string' || !ALLOWED_SEC_KEYS.has(k)) return null;
  }

  const cipherDesc = Object.getOwnPropertyDescriptor(rawSec, 'ciphertext');
  const ivDesc = Object.getOwnPropertyDescriptor(rawSec, 'iv');
  const tagDesc = Object.getOwnPropertyDescriptor(rawSec, 'authTag');
  const secKvDesc = Object.getOwnPropertyDescriptor(rawSec, 'keyVersion');
  if (
    !cipherDesc ||
    cipherDesc.get !== undefined ||
    cipherDesc.set !== undefined ||
    !ivDesc ||
    ivDesc.get !== undefined ||
    ivDesc.set !== undefined ||
    !tagDesc ||
    tagDesc.get !== undefined ||
    tagDesc.set !== undefined ||
    !secKvDesc ||
    secKvDesc.get !== undefined ||
    secKvDesc.set !== undefined ||
    typeof secKvDesc.value !== 'string' ||
    !KEY_VERSION_REGEX.test(secKvDesc.value) ||
    secKvDesc.value !== kvDesc.value
  ) {
    return null;
  }

  const ciphertext = copyBytes(cipherDesc.value);
  const iv = copyBytes(ivDesc.value);
  const authTag = copyBytes(tagDesc.value);
  if (
    !ciphertext ||
    ciphertext.length < 1 ||
    !iv ||
    iv.length !== 12 ||
    !authTag ||
    authTag.length !== 16
  ) {
    return null;
  }

  return Object.freeze({
    id: idDesc.value,
    keyVersion: kvDesc.value,
    returnTo: returnToDesc.value,
    encryptedSecrets: Object.freeze({
      ciphertext,
      iv,
      authTag,
      keyVersion: secKvDesc.value,
    }),
    createdAt: createdDesc.value,
    expiresAt: expiresDesc.value,
  });
}

const ALLOWED_CLAIMS_KEYS = new Set(['issuer', 'subject', 'email', 'displayName']);

export function snapshotVerifiedClaims(claims: unknown): VerifiedOidcClaimsDTO | null {
  if (typeof claims !== 'object' || claims === null || isProxySafe(claims)) return null;
  const proto = Object.getPrototypeOf(claims);
  if (proto !== Object.prototype && proto !== null) return null;

  const claimKeys = Reflect.ownKeys(claims);
  if (claimKeys.length !== ALLOWED_CLAIMS_KEYS.size) return null;
  for (const k of claimKeys) {
    if (typeof k !== 'string' || !ALLOWED_CLAIMS_KEYS.has(k)) return null;
  }

  const issDesc = Object.getOwnPropertyDescriptor(claims, 'issuer');
  const subDesc = Object.getOwnPropertyDescriptor(claims, 'subject');
  const emailDesc = Object.getOwnPropertyDescriptor(claims, 'email');
  const nameDesc = Object.getOwnPropertyDescriptor(claims, 'displayName');

  if (
    !issDesc ||
    issDesc.get !== undefined ||
    issDesc.set !== undefined ||
    typeof issDesc.value !== 'string' ||
    issDesc.value.length === 0 ||
    issDesc.value.trim() !== issDesc.value ||
    !subDesc ||
    subDesc.get !== undefined ||
    subDesc.set !== undefined ||
    typeof subDesc.value !== 'string' ||
    subDesc.value.length === 0 ||
    subDesc.value.trim() !== subDesc.value ||
    !emailDesc ||
    emailDesc.get !== undefined ||
    emailDesc.set !== undefined ||
    (emailDesc.value !== null && typeof emailDesc.value !== 'string') ||
    !nameDesc ||
    nameDesc.get !== undefined ||
    nameDesc.set !== undefined ||
    (nameDesc.value !== null && typeof nameDesc.value !== 'string')
  ) {
    return null;
  }

  return Object.freeze({
    issuer: issDesc.value,
    subject: subDesc.value,
    email: emailDesc.value,
    displayName: nameDesc.value,
  });
}

const ALLOWED_SECRETS_KEYS = new Set(['pkceVerifier', 'nonce']);

export function snapshotSecrets(sec: unknown): { pkceVerifier: string; nonce: string } | null {
  if (typeof sec !== 'object' || sec === null || isProxySafe(sec)) return null;
  const proto = Object.getPrototypeOf(sec);
  if (proto !== Object.prototype && proto !== null) return null;

  const secKeys = Reflect.ownKeys(sec);
  if (secKeys.length !== ALLOWED_SECRETS_KEYS.size) return null;
  for (const k of secKeys) {
    if (typeof k !== 'string' || !ALLOWED_SECRETS_KEYS.has(k)) return null;
  }

  const pkceDesc = Object.getOwnPropertyDescriptor(sec, 'pkceVerifier');
  const nonceDesc = Object.getOwnPropertyDescriptor(sec, 'nonce');
  if (
    !pkceDesc ||
    pkceDesc.get !== undefined ||
    pkceDesc.set !== undefined ||
    typeof pkceDesc.value !== 'string' ||
    pkceDesc.value.length === 0 ||
    !nonceDesc ||
    nonceDesc.get !== undefined ||
    nonceDesc.set !== undefined ||
    typeof nonceDesc.value !== 'string' ||
    nonceDesc.value.length === 0
  ) {
    return null;
  }
  return Object.freeze({ pkceVerifier: pkceDesc.value, nonce: nonceDesc.value });
}

export function snapshotExchangeResult(res: unknown): OidcExchangeResult | null {
  if (typeof res !== 'object' || res === null || isProxySafe(res)) return null;
  const proto = Object.getPrototypeOf(res);
  if (proto !== Object.prototype && proto !== null) return null;

  const keys = Reflect.ownKeys(res);
  const statusDesc = Object.getOwnPropertyDescriptor(res, 'status');
  if (!statusDesc || statusDesc.get !== undefined || statusDesc.set !== undefined) {
    return null;
  }

  if (statusDesc.value === 'invalid') {
    if (keys.length !== 1 || keys[0] !== 'status') return null;
    return Object.freeze({ status: 'invalid' as const });
  }

  if (statusDesc.value === 'unavailable') {
    if (keys.length !== 1 || keys[0] !== 'status') return null;
    return Object.freeze({ status: 'unavailable' as const });
  }

  if (statusDesc.value === 'verified') {
    if (keys.length !== 2) return null;
    if (!keys.includes('status') || !keys.includes('claims')) return null;
    const claimsDesc = Object.getOwnPropertyDescriptor(res, 'claims');
    if (!claimsDesc || claimsDesc.get !== undefined || claimsDesc.set !== undefined) {
      return null;
    }
    const claims = snapshotVerifiedClaims(claimsDesc.value);
    if (!claims) return null;
    return Object.freeze({
      status: 'verified' as const,
      claims,
    });
  }

  return null;
}
