import type { ConsumedLoginTransactionDTO, VerifiedOidcClaimsDTO } from './ports.js';
import { copyBytes, isProxySafe } from './byte-snapshot-helpers.js';

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
  const returnToDesc = Object.getOwnPropertyDescriptor(val, 'returnTo');
  const secDesc = Object.getOwnPropertyDescriptor(val, 'encryptedSecrets');
  if (
    !idDesc ||
    idDesc.get !== undefined ||
    idDesc.set !== undefined ||
    typeof idDesc.value !== 'string' ||
    !returnToDesc ||
    returnToDesc.get !== undefined ||
    returnToDesc.set !== undefined ||
    typeof returnToDesc.value !== 'string' ||
    !secDesc ||
    secDesc.get !== undefined ||
    secDesc.set !== undefined ||
    typeof secDesc.value !== 'object' ||
    secDesc.value === null ||
    isProxySafe(secDesc.value)
  ) {
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
  const kvDesc = Object.getOwnPropertyDescriptor(rawSec, 'keyVersion');
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
    !kvDesc ||
    kvDesc.get !== undefined ||
    kvDesc.set !== undefined ||
    typeof kvDesc.value !== 'string'
  ) {
    return null;
  }

  const ciphertext = copyBytes(cipherDesc.value);
  const iv = copyBytes(ivDesc.value);
  const authTag = copyBytes(tagDesc.value);
  if (!ciphertext || !iv || !authTag) return null;

  return Object.freeze({
    id: idDesc.value,
    returnTo: returnToDesc.value,
    encryptedSecrets: Object.freeze({
      ciphertext,
      iv,
      authTag,
      keyVersion: kvDesc.value,
    }),
    keyVersion: kvDesc.value,
    createdAt: '',
    expiresAt: '',
  });
}

const ALLOWED_CLAIMS_KEYS = new Set(['issuer', 'subject', 'email', 'displayName']);

export function snapshotVerifiedClaims(claims: unknown): VerifiedOidcClaimsDTO | null {
  if (typeof claims !== 'object' || claims === null || isProxySafe(claims)) return null;
  const proto = Object.getPrototypeOf(claims);
  if (proto !== Object.prototype && proto !== null) return null;

  const claimKeys = Reflect.ownKeys(claims);
  for (const k of claimKeys) {
    if (typeof k !== 'string' || !ALLOWED_CLAIMS_KEYS.has(k)) return null;
  }

  const issDesc = Object.getOwnPropertyDescriptor(claims, 'issuer');
  const subDesc = Object.getOwnPropertyDescriptor(claims, 'subject');
  if (
    !issDesc ||
    issDesc.get !== undefined ||
    issDesc.set !== undefined ||
    typeof issDesc.value !== 'string' ||
    !subDesc ||
    subDesc.get !== undefined ||
    subDesc.set !== undefined ||
    typeof subDesc.value !== 'string'
  ) {
    return null;
  }

  let email: string | null = null;
  const emailDesc = Object.getOwnPropertyDescriptor(claims, 'email');
  if (emailDesc) {
    if (emailDesc.get !== undefined || emailDesc.set !== undefined) return null;
    if (typeof emailDesc.value === 'string' || emailDesc.value === null) {
      email = emailDesc.value;
    } else {
      return null;
    }
  }

  let displayName: string | null = null;
  const nameDesc = Object.getOwnPropertyDescriptor(claims, 'displayName');
  if (nameDesc) {
    if (nameDesc.get !== undefined || nameDesc.set !== undefined) return null;
    if (typeof nameDesc.value === 'string' || nameDesc.value === null) {
      displayName = nameDesc.value;
    } else {
      return null;
    }
  }

  return Object.freeze({
    issuer: issDesc.value,
    subject: subDesc.value,
    email,
    displayName,
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
    !nonceDesc ||
    nonceDesc.get !== undefined ||
    nonceDesc.set !== undefined ||
    typeof nonceDesc.value !== 'string'
  ) {
    return null;
  }
  return { pkceVerifier: pkceDesc.value, nonce: nonceDesc.value };
}
