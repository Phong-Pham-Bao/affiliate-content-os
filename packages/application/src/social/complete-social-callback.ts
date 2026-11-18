import crypto from 'node:crypto';
import { isSocialPlatform, type SocialPlatform } from '@affiliate-content-os/domain';
import {
  OAuthCallbackInvalidError,
  SocialAuthNotConfiguredError,
  SocialPlatformUnsupportedError,
} from './errors.js';
import type {
  SocialAuditContext,
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from './ports.js';

export interface CompleteSocialCallbackCommand {
  readonly platform: string;
  readonly state: unknown;
  readonly code?: unknown;
  readonly error?: unknown;
  readonly errorDescription?: unknown;
}

export interface CompleteSocialCallbackDependencies {
  readonly persistence: SocialPersistencePort;
  readonly protector: SocialCredentialProtectorPort;
  readonly adapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly enabled: boolean;
  readonly callbackResultTtlSeconds: number;
  readonly clock: { now(): Date };
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface CompleteSocialCallbackResult {
  readonly redirectUrl: string;
  readonly resultKey: string;
  readonly isSuccess: boolean;
}

function buildRedirectWithResult(returnTo: string | null | undefined, resultKey: string): string {
  const base = returnTo && returnTo.length > 0 ? returnTo : '/';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}connection_result=${encodeURIComponent(resultKey)}`;
}

function mapProviderErrorCode(rawError: unknown): { safeCode: string; safeDescription: string } {
  const str = typeof rawError === 'string' ? rawError.toLowerCase().trim() : '';
  if (str === 'access_denied' || str.includes('denied') || str.includes('cancel')) {
    return {
      safeCode: 'access_denied',
      safeDescription: 'The authorization request was denied.',
    };
  }
  if (str === 'timeout' || str.includes('timeout')) {
    return {
      safeCode: 'provider_timeout',
      safeDescription: 'The social provider timed out during authorization.',
    };
  }
  return {
    safeCode: 'provider_error',
    safeDescription: 'An error occurred during authorization with the provider.',
  };
}

export async function completeSocialCallback(
  command: CompleteSocialCallbackCommand,
  deps: CompleteSocialCallbackDependencies,
): Promise<CompleteSocialCallbackResult> {
  if (!deps.enabled) {
    throw new SocialAuthNotConfiguredError();
  }

  if (!isSocialPlatform(command.platform)) {
    throw new SocialPlatformUnsupportedError(command.platform);
  }
  const platform = command.platform;

  if (
    typeof command.state !== 'string' ||
    command.state.length < 16 ||
    command.state.length > 256 ||
    Array.isArray(command.state)
  ) {
    throw new OAuthCallbackInvalidError('Missing, oversized, or duplicate state parameter.');
  }

  const hasCode = typeof command.code === 'string' && command.code.length > 0;
  const hasError = typeof command.error === 'string' && command.error.length > 0;

  if ((hasCode && hasError) || (!hasCode && !hasError)) {
    throw new OAuthCallbackInvalidError(
      'Callback query must contain either code or error, not both or neither.',
    );
  }

  const now = deps.clock.now();
  const rawState = command.state;
  const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();

  // 1. Atomic claim fence: exactly one caller claims the pending transaction
  const claimedTx = await deps.persistence.claimOAuthTransaction({
    stateHash,
    platform,
    now: now.toISOString(),
    claimTtlSeconds: 120,
  });

  const resultKeyBytes = crypto.randomBytes(32);
  const resultKey = resultKeyBytes.toString('base64url');
  const resultKeyHash = crypto.createHash('sha256').update(resultKey, 'utf8').digest();
  const resultExpiresAt = new Date(
    now.getTime() + deps.callbackResultTtlSeconds * 1000,
  ).toISOString();

  // 2. Handle provider denial/error
  if (hasError) {
    const { safeCode, safeDescription } = mapProviderErrorCode(command.error);
    await deps.persistence.recordFailedOAuthCallbackAtomic({
      transactionId: claimedTx.id,
      stateHash,
      workspaceId: claimedTx.workspaceId,
      platform,
      actorUserId: claimedTx.initiatedByUserId,
      errorCode: safeCode,
      errorDescription: safeDescription,
      resultKeyHash,
      resultExpiresAt,
      now: now.toISOString(),
      auditContext: deps.auditContext,
    });

    return {
      redirectUrl: buildRedirectWithResult(claimedTx.returnTo, resultKey),
      resultKey,
      isSuccess: false,
    };
  }

  // 3. Handle successful code exchange
  const adapter = deps.adapters.get(platform);
  if (!adapter) {
    throw new SocialPlatformUnsupportedError(platform);
  }

  let codeVerifier: string | undefined;
  if (claimedTx.encryptedVerifier) {
    codeVerifier = deps.protector.decryptOAuthVerifier({
      workspaceId: claimedTx.workspaceId,
      transactionId: claimedTx.id,
      platform,
      encryptedVerifier: claimedTx.encryptedVerifier,
    });
  }

  const code = command.code as string;
  let exchangeResult;
  try {
    exchangeResult = await adapter.exchangeCode({
      platform,
      code,
      redirectUri: claimedTx.redirectUri,
      codeVerifier,
    });
  } catch (_err: unknown) {
    await deps.persistence.recordFailedOAuthCallbackAtomic({
      transactionId: claimedTx.id,
      stateHash,
      workspaceId: claimedTx.workspaceId,
      platform,
      actorUserId: claimedTx.initiatedByUserId,
      errorCode: 'exchange_failed',
      errorDescription: 'Failed to exchange authorization code with provider.',
      resultKeyHash,
      resultExpiresAt,
      now: now.toISOString(),
      auditContext: deps.auditContext,
    });

    return {
      redirectUrl: buildRedirectWithResult(claimedTx.returnTo, resultKey),
      resultKey,
      isSuccess: false,
    };
  }

  let tokenExpiresAt: string | null = null;
  if (exchangeResult.tokenExpiresInSeconds && exchangeResult.tokenExpiresInSeconds > 0) {
    tokenExpiresAt = new Date(
      now.getTime() + exchangeResult.tokenExpiresInSeconds * 1000,
    ).toISOString();
  }

  // Authoritative credential encryption inside narrow completion boundary
  await deps.persistence.completeOAuthCallbackAtomic({
    transactionId: claimedTx.id,
    stateHash,
    workspaceId: claimedTx.workspaceId,
    platform,
    actorUserId: claimedTx.initiatedByUserId,
    providerAccountId: exchangeResult.providerAccountId,
    displayName: exchangeResult.displayName,
    handle: exchangeResult.handle,
    grantedScopes: exchangeResult.grantedScopes,
    capabilities: exchangeResult.capabilities,
    capabilitiesCheckedAt: now.toISOString(),
    tokenExpiresAt,
    environment: exchangeResult.environment,
    encryptCredentials: (authoritativeAccountId: string) =>
      deps.protector.encrypt({
        workspaceId: claimedTx.workspaceId,
        socialAccountId: authoritativeAccountId,
        platform,
        accessToken: exchangeResult.accessToken,
        refreshToken: exchangeResult.refreshToken,
      }),
    resultKeyHash,
    resultExpiresAt,
    now: now.toISOString(),
    auditContext: deps.auditContext,
  });

  return {
    redirectUrl: buildRedirectWithResult(claimedTx.returnTo, resultKey),
    resultKey,
    isSuccess: true,
  };
}
