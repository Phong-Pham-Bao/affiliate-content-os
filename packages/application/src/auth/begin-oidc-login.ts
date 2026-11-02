import { AuthPersistenceError, AuthRequestValidationError } from './errors.js';
import type { AuthCryptoPort, LoginTransactionStorePort, OidcProtocolPort } from './ports.js';

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
  readonly expiresAt: Date;
}

export function validateReturnTo(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') {
    return '/';
  }
  if (typeof raw !== 'string') {
    throw new AuthRequestValidationError('returnTo');
  }
  if (raw.length > 2048) {
    throw new AuthRequestValidationError('returnTo');
  }
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    throw new AuthRequestValidationError('returnTo');
  }
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      throw new AuthRequestValidationError('returnTo');
    }
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

  const currentInstant = deps.now();
  const expiresInstant = new Date(currentInstant.getTime() + deps.transactionTtlSeconds * 1000);

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
      createdAt: currentInstant.toISOString(),
      expiresAt: expiresInstant.toISOString(),
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
    expiresAt: expiresInstant,
  });
}
