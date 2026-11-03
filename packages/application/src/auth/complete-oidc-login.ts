import { resolveVerifiedIdentity } from '../resolve-verified-identity.js';
import {
  AuthenticationRequiredError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
} from './errors.js';
import type {
  CompleteOidcLoginCommand,
  CompleteOidcLoginDependencies,
  CompleteOidcLoginResult,
} from './complete-oidc-login-types.js';
import {
  parseCallbackQuery,
  snapshotConsumedTx,
  snapshotExchangeResult,
  snapshotSecrets,
  validateTransactionCookie,
} from './complete-oidc-login-snapshots.js';
import { snapshotSafeClock } from './safe-clock.js';

export type {
  CompleteOidcLoginCommand,
  CompleteOidcLoginDependencies,
  CompleteOidcLoginResult,
} from './complete-oidc-login-types.js';

export async function completeOidcLogin(
  command: CompleteOidcLoginCommand,
  deps: CompleteOidcLoginDependencies,
): Promise<CompleteOidcLoginResult> {
  const parsed = parseCallbackQuery(command.query);
  const cookie = validateTransactionCookie(command.transactionCookie);

  let clock;
  try {
    clock = snapshotSafeClock(deps.now);
  } catch {
    throw new OidcCallbackInvalidError();
  }

  const stateHash = deps.crypto.hashToken(parsed.state);
  const cookieHash = deps.crypto.hashToken(cookie);

  const rawConsumed = await deps.transactionStore.consumePendingTransaction({
    stateHash,
    browserBindingHash: cookieHash,
    now: clock.iso,
  });

  const consumedTx = snapshotConsumedTx(rawConsumed);
  if (!consumedTx) {
    throw new OidcCallbackInvalidError();
  }

  if (consumedTx.createdAt > clock.iso || clock.iso >= consumedTx.expiresAt) {
    throw new OidcCallbackInvalidError();
  }

  if (parsed.isDenial) {
    throw new OidcCallbackInvalidError();
  }

  let secrets;
  try {
    const rawSec = deps.crypto.decryptSecrets(consumedTx.id, consumedTx.encryptedSecrets);
    secrets = snapshotSecrets(rawSec);
    if (!secrets) throw new OidcCallbackInvalidError();
  } catch {
    throw new OidcCallbackInvalidError();
  }

  let rawExchangeResult: unknown;
  try {
    rawExchangeResult = await deps.oidc.exchangeCodeAndValidateIdToken({
      code: parsed.code!,
      pkceVerifier: secrets.pkceVerifier,
      nonce: secrets.nonce,
    });
  } catch {
    throw new OidcCallbackInvalidError();
  }

  const exchangeResult = snapshotExchangeResult(rawExchangeResult);
  if (!exchangeResult) {
    throw new OidcCallbackInvalidError();
  }

  if (exchangeResult.status === 'invalid') {
    throw new OidcCallbackInvalidError();
  }

  if (exchangeResult.status === 'unavailable') {
    throw new OidcProviderUnavailableError();
  }

  const claims = exchangeResult.claims;

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

  const nowIso = clock.iso;
  const idleExpiresIso = new Date(clock.epochMs + deps.sessionIdleTtlSeconds * 1000).toISOString();
  const absoluteExpiresIso = new Date(
    clock.epochMs + deps.sessionAbsoluteTtlSeconds * 1000,
  ).toISOString();

  await deps.sessionStore.createSession({
    id: sessionId,
    userId: principal.user.id,
    currentTokenHash: sessionTokenHash,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    idleExpiresAt: idleExpiresIso,
    absoluteExpiresAt: absoluteExpiresIso,
    rotatedAt: nowIso,
  });

  return {
    sessionToken,
    returnTo: consumedTx.returnTo,
    absoluteExpiresAt: absoluteExpiresIso,
  };
}
