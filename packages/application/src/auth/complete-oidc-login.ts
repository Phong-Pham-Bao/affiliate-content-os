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
  snapshotSecrets,
  snapshotVerifiedClaims,
  validateTransactionCookie,
} from './complete-oidc-login-snapshots.js';

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

  const stateHash = deps.crypto.hashToken(parsed.state);
  const cookieHash = deps.crypto.hashToken(cookie);
  const currentInstant = deps.now();

  const rawConsumed = await deps.transactionStore.consumePendingTransaction({
    stateHash,
    browserBindingHash: cookieHash,
    now: currentInstant.toISOString(),
  });

  const consumedTx = snapshotConsumedTx(rawConsumed);
  if (!consumedTx) {
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

  let claims;
  try {
    const rawClaims = await deps.oidc.exchangeCodeAndValidateIdToken({
      code: parsed.code!,
      pkceVerifier: secrets.pkceVerifier,
      nonce: secrets.nonce,
    });
    claims = snapshotVerifiedClaims(rawClaims);
    if (!claims) throw new OidcCallbackInvalidError();
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
  const absoluteExpiresAt = new Date(
    currentInstant.getTime() + deps.sessionAbsoluteTtlSeconds * 1000,
  );
  const absoluteExpiresIso = absoluteExpiresAt.toISOString();

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
    absoluteExpiresAt,
  };
}
