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
  readonly iss?: string | undefined;
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

  const issDesc = Object.getOwnPropertyDescriptor(query, 'iss');
  let iss: string | undefined;
  if (issDesc !== undefined) {
    if (
      issDesc.get !== undefined ||
      issDesc.set !== undefined ||
      typeof issDesc.value !== 'string' ||
      issDesc.value.length === 0 ||
      issDesc.value.length > 2048 ||
      hasControlChars(issDesc.value)
    ) {
      throw new OidcCallbackInvalidError();
    }
    iss = issDesc.value;
  }

  if (hasCode) {
    if (keys.length < 2 || keys.length > 3) throw new OidcCallbackInvalidError();
    for (const k of keys) {
      if (k !== 'code' && k !== 'state' && k !== 'iss') throw new OidcCallbackInvalidError();
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
    return Object.freeze({
      code: codeDesc.value,
      state,
      ...(iss !== undefined ? { iss } : {}),
      isDenial: false,
    });
  }

  const allowedDenialKeys = new Set(['error', 'state', 'error_description', 'error_uri', 'iss']);
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

  return Object.freeze({
    state,
    ...(iss !== undefined ? { iss } : {}),
    isDenial: true,
  });
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
