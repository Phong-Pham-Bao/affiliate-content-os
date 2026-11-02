import util from 'node:util';
import {
  AuthenticationRequiredError,
  AuthPersistenceError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
} from './errors.js';
import type {
  AuthCryptoPort,
  LoginTransactionStorePort,
  OidcProtocolPort,
  SessionStorePort,
} from './ports.js';
import {
  resolveVerifiedIdentity,
  type ResolveVerifiedIdentityDependencies,
} from '../resolve-verified-identity.js';
import { validateReturnTo } from './begin-oidc-login.js';

export interface CompleteOidcLoginCommand {
  readonly query: unknown;
  readonly transactionCookie: unknown;
}

export interface CompleteOidcLoginDependencies {
  readonly crypto: AuthCryptoPort;
  readonly transactionStore: LoginTransactionStorePort;
  readonly sessionStore: SessionStorePort;
  readonly oidc: OidcProtocolPort;
  readonly identityResolution: ResolveVerifiedIdentityDependencies;
  readonly generateId: () => string;
  readonly now: () => Date;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
}

export interface CompleteOidcLoginResult {
  readonly sessionToken: string;
  readonly returnTo: string;
  readonly absoluteExpiresAt: Date;
}

interface ParsedCallbackQuery {
  readonly isDenial: boolean;
  readonly state: string;
  readonly code?: string;
}

function parseCallbackQuery(query: unknown): ParsedCallbackQuery {
  if (typeof query !== 'object' || query === null || util.types.isProxy(query)) {
    throw new OidcCallbackInvalidError();
  }
  const q = query as Record<string, unknown>;
  const keys = Object.keys(q);

  const state = q['state'];
  if (typeof state !== 'string' || state.length === 0 || state.length > 512) {
    throw new OidcCallbackInvalidError();
  }

  const error = q['error'];
  if (error !== undefined) {
    if (typeof error !== 'string' || error.length === 0 || error.length > 128) {
      throw new OidcCallbackInvalidError();
    }
    const allowed = new Set(['error', 'state', 'error_description', 'error_uri']);
    for (const k of keys) {
      if (!allowed.has(k)) throw new OidcCallbackInvalidError();
      if (typeof q[k] !== 'string' || (q[k] as string).length > 2048) {
        throw new OidcCallbackInvalidError();
      }
    }
    return { isDenial: true, state };
  }

  const code = q['code'];
  if (typeof code !== 'string' || code.length === 0 || code.length > 2048) {
    throw new OidcCallbackInvalidError();
  }
  if (keys.length !== 2 || !keys.includes('code') || !keys.includes('state')) {
    throw new OidcCallbackInvalidError();
  }
  return { isDenial: false, state, code };
}

function validateTransactionCookie(cookie: unknown): string {
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

export async function completeOidcLogin(
  command: CompleteOidcLoginCommand,
  deps: CompleteOidcLoginDependencies,
): Promise<CompleteOidcLoginResult> {
  const parsed = parseCallbackQuery(command.query);
  const cookie = validateTransactionCookie(command.transactionCookie);

  const stateHash = deps.crypto.hashToken(parsed.state);
  const cookieHash = deps.crypto.hashToken(cookie);
  const currentInstant = deps.now();

  const consumedTx = await deps.transactionStore.consumePendingTransaction({
    stateHash,
    browserBindingHash: cookieHash,
    now: currentInstant.toISOString(),
  });

  if (!consumedTx) {
    throw new OidcCallbackInvalidError();
  }

  if (parsed.isDenial) {
    throw new OidcCallbackInvalidError();
  }

  let secrets;
  try {
    secrets = deps.crypto.decryptSecrets(consumedTx.id, consumedTx.encryptedSecrets);
  } catch {
    throw new OidcCallbackInvalidError();
  }

  let claims;
  try {
    claims = await deps.oidc.exchangeCodeAndValidateIdToken({
      code: parsed.code!,
      pkceVerifier: secrets.pkceVerifier,
      nonce: secrets.nonce,
    });
  } catch (err) {
    if (err instanceof OidcProviderUnavailableError) {
      throw err;
    }
    throw new OidcCallbackInvalidError();
  }

  const plainClaims = Object.create(null);
  plainClaims.identityProvider = claims.issuer;
  plainClaims.identitySubject = claims.subject;
  plainClaims.email = claims.email;
  plainClaims.displayName = claims.displayName;

  let principal;
  try {
    principal = await resolveVerifiedIdentity({ claims: plainClaims }, deps.identityResolution);
  } catch {
    throw new AuthenticationRequiredError();
  }

  const sessionId = deps.generateId();
  const sessionToken = deps.crypto.generateRandomToken();
  const sessionTokenHash = deps.crypto.hashToken(sessionToken);

  const nowIso = currentInstant.toISOString();
  const idleExpiresIso = new Date(
    currentInstant.getTime() + deps.sessionIdleTtlSeconds * 1000,
  ).toISOString();
  const absExpiresDate = new Date(currentInstant.getTime() + deps.sessionAbsoluteTtlSeconds * 1000);
  const absExpiresIso = absExpiresDate.toISOString();

  try {
    await deps.sessionStore.createSession({
      id: sessionId,
      userId: principal.user.id,
      currentTokenHash: sessionTokenHash,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      idleExpiresAt: idleExpiresIso,
      absoluteExpiresAt: absExpiresIso,
      rotatedAt: nowIso,
    });
  } catch {
    throw new AuthPersistenceError('session');
  }

  const validatedReturnTo = validateReturnTo(consumedTx.returnTo);

  return Object.freeze({
    sessionToken,
    returnTo: validatedReturnTo,
    absoluteExpiresAt: absExpiresDate,
  });
}
