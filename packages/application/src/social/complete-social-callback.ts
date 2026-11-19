import crypto from 'node:crypto';
import { deriveAccountLifecycle, isSocialPlatform } from '@affiliate-content-os/domain';
import {
  SocialAuthNotConfiguredError,
  SocialAuthOutcomeUnknownError,
  SocialPlatformUnsupportedError,
} from './errors.js';
import { buildRedirectWithResult, mapProviderErrorCode } from './callback-error-mapper.js';
import { validateCallbackQuery } from './callback-validation.js';
import type {
  CompleteSocialCallbackCommand,
  CompleteSocialCallbackDependencies,
  CompleteSocialCallbackResult,
} from './callback-types.js';

export type {
  CompleteSocialCallbackCommand,
  CompleteSocialCallbackDependencies,
  CompleteSocialCallbackResult,
} from './callback-types.js';

export async function completeSocialCallback(
  command: CompleteSocialCallbackCommand,
  deps: CompleteSocialCallbackDependencies,
): Promise<CompleteSocialCallbackResult> {
  if (!deps.enabled) throw new SocialAuthNotConfiguredError();
  if (!isSocialPlatform(command.platform))
    throw new SocialPlatformUnsupportedError(command.platform);
  const platform = command.platform;
  const validated = validateCallbackQuery(command);

  const now = deps.clock.now();
  const stateHash = crypto.createHash('sha256').update(validated.rawState, 'utf8').digest();

  // 1. Claim transaction fence
  const claimedTx = await deps.persistence.claimOAuthTransaction({
    stateHash,
    platform,
    now: now.toISOString(),
    claimTtlSeconds: 120,
    auditContext: deps.auditContext,
  });

  const resultKey = crypto.randomBytes(32).toString('base64url');
  const resultKeyHash = crypto.createHash('sha256').update(resultKey, 'utf8').digest();
  const resultExpiresAt = new Date(
    now.getTime() + deps.callbackResultTtlSeconds * 1000,
  ).toISOString();

  // 2. Handle provider denial
  if (validated.error) {
    const { safeCode, safeDescription } = mapProviderErrorCode(validated.error);
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

  // 3. Handle code exchange
  const adapter = deps.adapters.get(platform);
  if (!adapter) throw new SocialPlatformUnsupportedError(platform);

  let codeVerifier: string | undefined;
  if (claimedTx.encryptedVerifier) {
    codeVerifier = deps.protector.decryptOAuthVerifier({
      workspaceId: claimedTx.workspaceId,
      transactionId: claimedTx.id,
      platform,
      encryptedVerifier: claimedTx.encryptedVerifier,
    });
  }

  let exchangeResult;
  try {
    exchangeResult = await adapter.exchangeCode({
      platform,
      code: validated.code!,
      redirectUri: claimedTx.redirectUri,
      codeVerifier,
    });
  } catch (err: unknown) {
    const errorCode =
      err instanceof SocialAuthOutcomeUnknownError ? 'outcome_unknown' : 'exchange_failed';
    const errorDescription =
      err instanceof SocialAuthOutcomeUnknownError
        ? 'Network timeout occurred before issuance could be confirmed.'
        : 'Failed to exchange authorization code with provider.';

    await deps.persistence.recordFailedOAuthCallbackAtomic({
      transactionId: claimedTx.id,
      stateHash,
      workspaceId: claimedTx.workspaceId,
      platform,
      actorUserId: claimedTx.initiatedByUserId,
      errorCode,
      errorDescription,
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

  // 4. Reconnect identity binding check: reject account substitution
  if (
    claimedTx.expectedProviderAccountId &&
    exchangeResult.providerAccountId !== claimedTx.expectedProviderAccountId
  ) {
    await deps.persistence.recordFailedOAuthCallbackAtomic({
      transactionId: claimedTx.id,
      stateHash,
      workspaceId: claimedTx.workspaceId,
      platform,
      actorUserId: claimedTx.initiatedByUserId,
      errorCode: 'account_mismatch',
      errorDescription: 'The reconnected account does not match the original account.',
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

  const tokenExpiresAt =
    exchangeResult.tokenExpiresInSeconds && exchangeResult.tokenExpiresInSeconds > 0
      ? new Date(now.getTime() + exchangeResult.tokenExpiresInSeconds * 1000).toISOString()
      : null;

  const exchangeStage =
    exchangeResult.stage ??
    (exchangeResult.isRecoverablePartial ? 'short_token_exchanged' : 'completed');

  const lifecycle = deriveAccountLifecycle({
    platform,
    exchangeStage,
    hasValidCredential: true,
    tokenExpiresAt,
    verifiedIdentity: {
      providerAccountId: exchangeResult.providerAccountId,
      displayName: exchangeResult.displayName,
    },
    grantedScopes: exchangeResult.grantedScopes,
    capabilitiesCheckedAt: now.toISOString(),
    appReviewStatus: deps.appReviewStatus ?? 'development',
    killSwitches: {
      globalKillSwitch: deps.socialKillSwitchActive,
      connectionKillSwitch: deps.connectionKillSwitchActive,
    },
    now,
  });

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
    capabilities: lifecycle.capabilities,
    capabilitiesCheckedAt: now.toISOString(),
    tokenExpiresAt,
    environment: exchangeResult.environment,
    reconnectAccountId: claimedTx.reconnectAccountId,
    exchangeStage,
    statusReason: lifecycle.statusReason,
    derivedStatus: lifecycle.status,
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
    isSuccess: !exchangeResult.isRecoverablePartial,
  };
}
