import util from 'node:util';
import { OidcCallbackInvalidError } from './errors.js';
import type { ConsumedLoginTransactionDTO, VerifiedOidcClaimsDTO } from './ports.js';

export function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

export function parseCallbackQuery(query: unknown): {
  readonly code?: string | undefined;
  readonly state: string;
  readonly isDenial: boolean;
} {
  if (typeof query !== 'object' || query === null || isProxySafe(query)) {
    throw new OidcCallbackInvalidError();
  }

  const allowedKeys = new Set(['code', 'state', 'error', 'error_description', 'error_uri']);
  for (const key of Reflect.ownKeys(query)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new OidcCallbackInvalidError();
    }
  }

  const codeDesc = Object.getOwnPropertyDescriptor(query, 'code');
  const stateDesc = Object.getOwnPropertyDescriptor(query, 'state');
  const errorDesc = Object.getOwnPropertyDescriptor(query, 'error');

  const code = codeDesc && typeof codeDesc.value === 'string' ? codeDesc.value : undefined;
  const state = stateDesc && typeof stateDesc.value === 'string' ? stateDesc.value : undefined;
  const error = errorDesc && typeof errorDesc.value === 'string' ? errorDesc.value : undefined;

  if (!state || (!code && !error)) {
    throw new OidcCallbackInvalidError();
  }
  return { code, state, isDenial: Boolean(error) };
}

export function validateTransactionCookie(cookie: unknown): string {
  if (
    typeof cookie !== 'string' ||
    cookie.length !== 43 ||
    cookie.includes('=') ||
    !/^[A-Za-z0-9_-]{43}$/.test(cookie)
  ) {
    throw new OidcCallbackInvalidError();
  }
  return cookie;
}

export function copyBytes(val: unknown): Uint8Array | null {
  if (!(val instanceof Uint8Array) || isProxySafe(val)) return null;
  const copy = new Uint8Array(val.byteLength);
  copy.set(val);
  return copy;
}

export function snapshotConsumedTx(val: unknown): ConsumedLoginTransactionDTO | null {
  if (typeof val !== 'object' || val === null || isProxySafe(val)) return null;
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null) return null;

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

export function snapshotVerifiedClaims(claims: unknown): VerifiedOidcClaimsDTO | null {
  if (typeof claims !== 'object' || claims === null || isProxySafe(claims)) return null;
  const proto = Object.getPrototypeOf(claims);
  if (proto !== Object.prototype && proto !== null) return null;

  const issDesc = Object.getOwnPropertyDescriptor(claims, 'issuer');
  const subDesc = Object.getOwnPropertyDescriptor(claims, 'subject');
  const emailDesc = Object.getOwnPropertyDescriptor(claims, 'email');
  const nameDesc = Object.getOwnPropertyDescriptor(claims, 'displayName');

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
  if (emailDesc && emailDesc.get === undefined && emailDesc.set === undefined) {
    if (typeof emailDesc.value === 'string' || emailDesc.value === null) {
      email = emailDesc.value;
    } else {
      return null;
    }
  }
  let displayName: string | null = null;
  if (nameDesc && nameDesc.get === undefined && nameDesc.set === undefined) {
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

export function snapshotSecrets(sec: unknown): { pkceVerifier: string; nonce: string } | null {
  if (typeof sec !== 'object' || sec === null || isProxySafe(sec)) return null;
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
