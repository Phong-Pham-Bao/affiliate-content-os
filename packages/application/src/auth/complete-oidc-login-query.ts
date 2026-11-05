import util from 'node:util';
import { OidcCallbackInvalidError } from './errors.js';

export function isProxySafe(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

function hasControlChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) return true;
  }
  return false;
}

export function parseCallbackQuery(query: unknown): {
  readonly code?: string | undefined;
  readonly state: string;
  readonly isDenial: boolean;
} {
  if (typeof query !== 'object' || query === null || isProxySafe(query)) {
    throw new OidcCallbackInvalidError();
  }
  const proto = Object.getPrototypeOf(query);
  if (proto !== Object.prototype && proto !== null) {
    throw new OidcCallbackInvalidError();
  }

  const keys = Reflect.ownKeys(query);
  const codeDesc = Object.getOwnPropertyDescriptor(query, 'code');
  const errorDesc = Object.getOwnPropertyDescriptor(query, 'error');
  const hasCode = codeDesc !== undefined;
  const hasError = errorDesc !== undefined;

  if ((hasCode && hasError) || (!hasCode && !hasError)) {
    throw new OidcCallbackInvalidError();
  }

  const stateDesc = Object.getOwnPropertyDescriptor(query, 'state');
  if (
    !stateDesc ||
    stateDesc.get !== undefined ||
    stateDesc.set !== undefined ||
    typeof stateDesc.value !== 'string' ||
    stateDesc.value.length === 0 ||
    stateDesc.value.length > 4096 ||
    hasControlChars(stateDesc.value)
  ) {
    throw new OidcCallbackInvalidError();
  }
  const state = stateDesc.value;

  if (hasCode) {
    if (keys.length !== 2) throw new OidcCallbackInvalidError();
    for (const k of keys) {
      if (k !== 'code' && k !== 'state') throw new OidcCallbackInvalidError();
    }
    if (
      codeDesc.get !== undefined ||
      codeDesc.set !== undefined ||
      typeof codeDesc.value !== 'string' ||
      codeDesc.value.length === 0 ||
      codeDesc.value.length > 4096 ||
      hasControlChars(codeDesc.value)
    ) {
      throw new OidcCallbackInvalidError();
    }
    return { code: codeDesc.value, state, isDenial: false };
  }

  const allowedDenialKeys = new Set(['error', 'state', 'error_description', 'error_uri']);
  for (const k of keys) {
    if (typeof k !== 'string' || !allowedDenialKeys.has(k)) {
      throw new OidcCallbackInvalidError();
    }
  }
  if (
    !errorDesc ||
    errorDesc.get !== undefined ||
    errorDesc.set !== undefined ||
    typeof errorDesc.value !== 'string' ||
    errorDesc.value.length === 0 ||
    errorDesc.value.length > 256 ||
    hasControlChars(errorDesc.value)
  ) {
    throw new OidcCallbackInvalidError();
  }

  for (const field of ['error_description', 'error_uri'] as const) {
    const d = Object.getOwnPropertyDescriptor(query, field);
    if (
      d &&
      (d.get !== undefined ||
        d.set !== undefined ||
        typeof d.value !== 'string' ||
        d.value.length > 1024 ||
        hasControlChars(d.value))
    ) {
      throw new OidcCallbackInvalidError();
    }
  }

  return { state, isDenial: true };
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
