import { OidcCallbackInvalidError } from '@affiliate-content-os/application';

const MAX_RAW_QUERY_LENGTH = 16384;
const MAX_QUERY_PAIRS = 32;
const MAX_PARAM_KEY_LENGTH = 256;
const MAX_PARAM_VALUE_LENGTH = 4096;

const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validates the raw callback URL query string and extracts only the allowlisted core
 * OAuth response parameters (code/state/iss or error/state/iss/error_description/error_uri).
 *
 * Implements RFC 6749 Section 4.1.2 by safely ignoring bounded, unrecognized response parameters
 * (such as Google's `scope`, `authuser`, `prompt`, `hd`) while continuing strict validation of
 * URL structure, percent-encoding, duplicate keys, control characters, bounds, and mutual exclusivity.
 * Preserves RFC 9207 `iss` parameter when present.
 */
export function parseAndValidateRawCallback(rawUrlStr: string): Record<string, string> {
  if (typeof rawUrlStr !== 'string' || rawUrlStr.includes('#')) {
    throw new OidcCallbackInvalidError();
  }

  const qIdx = rawUrlStr.indexOf('?');
  if (qIdx === -1) {
    throw new OidcCallbackInvalidError();
  }

  const rawQuery = rawUrlStr.slice(qIdx + 1);
  if (
    rawQuery.length === 0 ||
    rawQuery.length > MAX_RAW_QUERY_LENGTH ||
    rawQuery.includes('?') ||
    rawQuery.startsWith('&') ||
    rawQuery.endsWith('&') ||
    rawQuery.includes('&&') ||
    rawQuery.includes(';')
  ) {
    throw new OidcCallbackInvalidError();
  }

  for (let i = 0; i < rawQuery.length; i++) {
    if (rawQuery[i] === '%') {
      if (i + 2 >= rawQuery.length) {
        throw new OidcCallbackInvalidError();
      }
      const hex = rawQuery.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new OidcCallbackInvalidError();
      }
    }
  }

  const pairs = rawQuery.split('&');
  if (pairs.length === 0 || pairs.length > MAX_QUERY_PAIRS) {
    throw new OidcCallbackInvalidError();
  }

  const seenDecodedKeys = new Set<string>();
  const seenRawKeys = new Set<string>();
  const allDecodedParams: Record<string, string> = Object.create(null);

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);

    if (rawKey.length === 0) {
      throw new OidcCallbackInvalidError();
    }

    let decodedKey: string;
    let decodedVal: string;
    try {
      decodedKey = decodeURIComponent(rawKey);
      decodedVal = decodeURIComponent(rawVal);
    } catch {
      throw new OidcCallbackInvalidError();
    }

    if (
      decodedKey.length === 0 ||
      decodedKey.length > MAX_PARAM_KEY_LENGTH ||
      decodedVal.length > MAX_PARAM_VALUE_LENGTH ||
      FORBIDDEN_PROTOTYPE_KEYS.has(decodedKey)
    ) {
      throw new OidcCallbackInvalidError();
    }

    if (seenRawKeys.has(rawKey) || seenDecodedKeys.has(decodedKey)) {
      throw new OidcCallbackInvalidError();
    }
    seenRawKeys.add(rawKey);
    seenDecodedKeys.add(decodedKey);

    for (let i = 0; i < decodedKey.length; i++) {
      const c = decodedKey.charCodeAt(i);
      if ((c >= 0 && c <= 0x1f) || c === 0x7f) {
        throw new OidcCallbackInvalidError();
      }
    }
    for (let i = 0; i < decodedVal.length; i++) {
      const c = decodedVal.charCodeAt(i);
      if ((c >= 0 && c <= 0x1f) || c === 0x7f) {
        throw new OidcCallbackInvalidError();
      }
    }

    allDecodedParams[decodedKey] = decodedVal;
  }

  const hasCode = Object.prototype.hasOwnProperty.call(allDecodedParams, 'code');
  const hasError = Object.prototype.hasOwnProperty.call(allDecodedParams, 'error');
  if ((hasCode && hasError) || (!hasCode && !hasError)) {
    throw new OidcCallbackInvalidError();
  }

  const stateVal = allDecodedParams['state'];
  if (!stateVal || stateVal.length === 0 || stateVal.length > 4096) {
    throw new OidcCallbackInvalidError();
  }

  const filteredCore: Record<string, string> = Object.create(null);

  if (Object.prototype.hasOwnProperty.call(allDecodedParams, 'iss')) {
    const issVal = allDecodedParams['iss'];
    if (!issVal || issVal.length === 0 || issVal.length > 2048) {
      throw new OidcCallbackInvalidError();
    }
    filteredCore['iss'] = issVal;
  }

  if (hasCode) {
    if (
      Object.prototype.hasOwnProperty.call(allDecodedParams, 'error_description') ||
      Object.prototype.hasOwnProperty.call(allDecodedParams, 'error_uri')
    ) {
      throw new OidcCallbackInvalidError();
    }
    const codeVal = allDecodedParams['code'];
    if (!codeVal || codeVal.length === 0 || codeVal.length > 4096) {
      throw new OidcCallbackInvalidError();
    }
    filteredCore['code'] = codeVal;
    filteredCore['state'] = stateVal;
  } else {
    const errorVal = allDecodedParams['error'];
    if (!errorVal || errorVal.length === 0 || errorVal.length > 256) {
      throw new OidcCallbackInvalidError();
    }
    filteredCore['error'] = errorVal;
    filteredCore['state'] = stateVal;

    const errorDescVal = allDecodedParams['error_description'];
    if (typeof errorDescVal === 'string') {
      if (errorDescVal.length > 1024) {
        throw new OidcCallbackInvalidError();
      }
      filteredCore['error_description'] = errorDescVal;
    }

    const errorUriVal = allDecodedParams['error_uri'];
    if (typeof errorUriVal === 'string') {
      if (errorUriVal.length > 1024) {
        throw new OidcCallbackInvalidError();
      }
      filteredCore['error_uri'] = errorUriVal;
    }
  }

  return filteredCore;
}
