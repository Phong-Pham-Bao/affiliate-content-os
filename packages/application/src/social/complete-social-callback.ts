import crypto from 'node:crypto';
import { isSocialPlatform, type SocialPlatform } from '@affiliate-content-os/domain';
import {
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
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

function buildRedirectWithResult(returnTo: string, resultKey: string): string {
  const separator = returnTo.includes('?') ? '&' : '?';
  return `${returnTo}${separator}connection_result=${encodeURIComponent(resultKey)}`;
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

  const rawState = command.state;
  const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();

  const transaction = await deps.persistence.findPendingTransactionByStateHash(stateHash);
  if (!transaction) {
    throw new OAuthTransactionNotFoundError();
  }

  const now = deps.clock.now();
  const expiresAt = new Date(transaction.expiresAt);
  if (now > expiresAt) {
    throw new OAuthTransactionExpiredError();
  }

  if (transaction.status !== 'pending') {
    throw new OAuthTransactionReplayedError();
  }

  if (transaction.platform !== platform) {
    throw new OAuthCallbackInvalidError('Platform mismatch for OAuth transaction.');
  }

  const resultKeyBytes = crypto.randomBytes(32);
  const resultKey = resultKeyBytes.toString('base64url');
  const resultKeyHash = crypto.createHash('sha256').update(resultKey, 'utf8').digest();
  const resultExpiresAt = new Date(
    now.getTime() + deps.callbackResultTtlSeconds * 1000,
  ).toISOString();

  // Handle provider-denied or error callback
  if (hasError) {
    const errorCode =
      typeof command.error === 'string' ? command.error.slice(0, 100) : 'unknown_error';
    const errorDesc =
      typeof command.errorDescription === 'string'
        ? command.errorDescription.slice(0, 500)
        : 'Authorization was denied or failed at provider.';

    await deps.persistence.recordFailedOAuthCallbackAtomic({
      transactionId: transaction.id,
      stateHash,
      workspaceId: transaction.workspaceId,
      platform,
      errorCode,
      errorDescription: errorDesc,
      resultKeyHash,
      resultExpiresAt,
      now: now.toISOString(),
      auditContext: deps.auditContext,
    });

    return {
      redirectUrl: buildRedirectWithResult(transaction.returnTo, resultKey),
      resultKey,
      isSuccess: false,
    };
  }

  // Handle successful code callback
  const adapter = deps.adapters.get(platform);
  if (!adapter) {
    throw new SocialPlatformUnsupportedError(platform);
  }

  const code = command.code as string;
  let exchangeResult;
  try {
    exchangeResult = await adapter.exchangeCode({
      platform,
      code,
      redirectUri: transaction.redirectUri,
    });
  } catch (_err: unknown) {
    await deps.persistence.recordFailedOAuthCallbackAtomic({
      transactionId: transaction.id,
      stateHash,
      workspaceId: transaction.workspaceId,
      platform,
      errorCode: 'exchange_failed',
      errorDescription: 'Failed to exchange authorization code with provider.',
      resultKeyHash,
      resultExpiresAt,
      now: now.toISOString(),
      auditContext: deps.auditContext,
    });

    return {
      redirectUrl: buildRedirectWithResult(transaction.returnTo, resultKey),
      resultKey,
      isSuccess: false,
    };
  }

  const socialAccountId = crypto.randomUUID();
  const encryptedCredentials = deps.protector.encrypt({
    workspaceId: transaction.workspaceId,
    socialAccountId,
    platform,
    accessToken: exchangeResult.accessToken,
    refreshToken: exchangeResult.refreshToken,
  });

  let tokenExpiresAt: string | null = null;
  if (exchangeResult.tokenExpiresInSeconds && exchangeResult.tokenExpiresInSeconds > 0) {
    tokenExpiresAt = new Date(
      now.getTime() + exchangeResult.tokenExpiresInSeconds * 1000,
    ).toISOString();
  }

  await deps.persistence.completeOAuthCallbackAtomic({
    transactionId: transaction.id,
    stateHash,
    workspaceId: transaction.workspaceId,
    platform,
    actorUserId: transaction.initiatedByUserId,
    providerAccountId: exchangeResult.providerAccountId,
    displayName: exchangeResult.displayName,
    handle: exchangeResult.handle,
    grantedScopes: exchangeResult.grantedScopes,
    capabilities: exchangeResult.capabilities,
    capabilitiesCheckedAt: now.toISOString(),
    tokenExpiresAt,
    environment: exchangeResult.environment,
    encryptedCredentials,
    resultKeyHash,
    resultExpiresAt,
    now: now.toISOString(),
    auditContext: deps.auditContext,
  });

  return {
    redirectUrl: buildRedirectWithResult(transaction.returnTo, resultKey),
    resultKey,
    isSuccess: true,
  };
}
