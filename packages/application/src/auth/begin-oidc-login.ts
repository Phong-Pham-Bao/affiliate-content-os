import { AuthPersistenceError, AuthRequestValidationError } from './errors.js';
import type { AuthCryptoPort, LoginTransactionStorePort, OidcProtocolPort } from './ports.js';
import { snapshotSafeClock } from './safe-clock.js';

export interface BeginOidcLoginCommand {
  readonly returnTo?: unknown;
}

export interface BeginOidcLoginDependencies {
  readonly crypto: AuthCryptoPort;
  readonly transactionStore: LoginTransactionStorePort;
  readonly oidc: OidcProtocolPort;
  readonly generateId: () => string;
  readonly now: () => Date;
  readonly transactionTtlSeconds: number;
}

export interface BeginOidcLoginResult {
  readonly authorizationUrl: string;
  readonly transactionCookieValue: string;
  readonly expiresAt: string;
}

export function validateReturnTo(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') {
    return '/';
  }
  if (typeof raw !== 'string') {
    throw new AuthRequestValidationError('returnTo');
  }
  if (raw.length < 1 || raw.length > 2048) {
    throw new AuthRequestValidationError('returnTo');
  }
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    throw new AuthRequestValidationError('returnTo');
  }
  if (raw.includes('#') || raw.includes('\\')) {
    throw new AuthRequestValidationError('returnTo');
  }
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      throw new AuthRequestValidationError('returnTo');
    }
  }

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '%') {
      if (i + 2 >= raw.length) {
        throw new AuthRequestValidationError('returnTo');
      }
      const hex = raw.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new AuthRequestValidationError('returnTo');
      }
      const upper = hex.toUpperCase();
      if (upper === '25' || upper === '2F' || upper === '5C' || upper === '23') {
        throw new AuthRequestValidationError('returnTo');
      }
      const byteVal = parseInt(hex, 16);
      if ((byteVal >= 0 && byteVal <= 0x1f) || byteVal === 0x7f) {
        throw new AuthRequestValidationError('returnTo');
      }
    }
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new AuthRequestValidationError('returnTo');
  }

  if (
    decoded.includes('#') ||
    decoded.includes('\\') ||
    decoded.startsWith('//') ||
    decoded.startsWith('/\\')
  ) {
    throw new AuthRequestValidationError('returnTo');
  }

  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      throw new AuthRequestValidationError('returnTo');
    }
  }

  const normalized = raw.normalize('NFC');
  if (
    normalized.includes('\uFF0F') ||
    normalized.includes('\uFF3C') ||
    normalized.includes('\u2044') ||
    normalized.includes('\u2215') ||
    normalized.includes('\u29F8') ||
    normalized.includes('\u29F9')
  ) {
    throw new AuthRequestValidationError('returnTo');
  }

  try {
    const parsed = new URL(raw, 'http://127.0.0.1');
    if (parsed.origin !== 'http://127.0.0.1') {
      throw new AuthRequestValidationError('returnTo');
    }
    if (parsed.hash !== '') {
      throw new AuthRequestValidationError('returnTo');
    }
    if (parsed.username !== '' || parsed.password !== '') {
      throw new AuthRequestValidationError('returnTo');
    }
    if (!parsed.pathname.startsWith('/')) {
      throw new AuthRequestValidationError('returnTo');
    }
  } catch (err) {
    if (err instanceof AuthRequestValidationError) throw err;
    throw new AuthRequestValidationError('returnTo');
  }

  return raw;
}

export async function beginOidcLogin(
  command: BeginOidcLoginCommand,
  deps: BeginOidcLoginDependencies,
): Promise<BeginOidcLoginResult> {
  const returnTo = validateReturnTo(command?.returnTo);

  const txId = deps.generateId();
  const state = deps.crypto.generateState();
  const browserBinding = deps.crypto.generateBrowserBinding();
  const nonce = deps.crypto.generateNonce();
  const pkce = deps.crypto.generatePkce();

  let clock;
  try {
    clock = snapshotSafeClock(deps.now);
  } catch {
    throw new AuthPersistenceError('transaction');
  }

  const expiresMs = clock.epochMs + deps.transactionTtlSeconds * 1000;
  const expiresIso = new Date(expiresMs).toISOString();

  const encryptedSecrets = deps.crypto.encryptSecrets(txId, {
    pkceVerifier: pkce.verifier,
    nonce,
  });

  try {
    await deps.transactionStore.createPendingTransaction({
      id: txId,
      stateHash: state.hash,
      browserBindingHash: browserBinding.hash,
      encryptedSecrets,
      returnTo,
      createdAt: clock.iso,
      expiresAt: expiresIso,
    });
  } catch {
    throw new AuthPersistenceError('transaction');
  }

  const authorizationUrl = deps.oidc.buildAuthorizationUrl({
    state: state.raw,
    nonce,
    codeChallenge: pkce.challenge,
  });

  return Object.freeze({
    authorizationUrl,
    transactionCookieValue: browserBinding.raw,
    expiresAt: expiresIso,
  });
}
