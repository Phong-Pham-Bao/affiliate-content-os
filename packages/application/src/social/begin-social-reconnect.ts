import crypto from 'node:crypto';
import {
  parseUserId,
  parseWorkspaceId,
  validateOAuthReturnTo,
  type SocialPlatform,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import {
  SocialAccountNotFoundError,
  SocialAuthNotConfiguredError,
  SocialKillSwitchActiveError,
  SocialPlatformUnsupportedError,
} from './errors.js';
import type {
  AuthorizeResponseData,
  EncryptedOAuthVerifier,
  SocialAuditContext,
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from './ports.js';

export interface BeginSocialReconnectCommand {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly actorUserId: string;
  readonly redirectUri: string;
  readonly returnTo?: string | undefined;
  readonly idempotencyKey: string;
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface BeginSocialReconnectDependencies {
  readonly persistence: SocialPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly protector?: SocialCredentialProtectorPort | undefined;
  readonly adapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly enabled: boolean;
  readonly socialKillSwitchActive?: boolean | undefined;
  readonly connectionKillSwitchActive?: boolean | undefined;
  readonly clock: { now(): Date };
  readonly idGenerator: { generate(): string };
  readonly transactionTtlSeconds: number;
}

export interface BeginSocialReconnectResult {
  readonly authorizationUrl: string;
  readonly transactionId: string;
  readonly expiresAt: string;
  readonly replayed: boolean;
}

const DEFAULT_SERVER_SCOPES: Record<SocialPlatform, readonly string[]> = {
  threads: Object.freeze(['threads_basic', 'threads_content_publish']),
  tiktok: Object.freeze(['user.info.basic', 'video.publish']),
};

export async function beginSocialReconnect(
  command: BeginSocialReconnectCommand,
  deps: BeginSocialReconnectDependencies,
): Promise<BeginSocialReconnectResult> {
  if (!deps.enabled) {
    throw new SocialAuthNotConfiguredError();
  }
  if (deps.socialKillSwitchActive || deps.connectionKillSwitchActive) {
    throw new SocialKillSwitchActiveError();
  }

  await authorizeWorkspaceAction(
    {
      workspaceId: parseWorkspaceId(command.workspaceId),
      userId: parseUserId(command.actorUserId),
      capability: 'social_accounts.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const existingAccount = await deps.persistence.findSocialAccountById({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
  });

  if (!existingAccount) {
    throw new SocialAccountNotFoundError();
  }

  const platform = existingAccount.platform;
  const adapter = deps.adapters.get(platform);
  if (!adapter) {
    throw new SocialPlatformUnsupportedError(platform);
  }

  const rawReturnTo = command.returnTo ?? '/';
  const returnTo = validateOAuthReturnTo(rawReturnTo);

  const rawStateBytes = crypto.randomBytes(32);
  const rawState = rawStateBytes.toString('base64url');
  const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();

  const scopes = DEFAULT_SERVER_SCOPES[platform] ?? [];
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + deps.transactionTtlSeconds * 1000);
  const transactionId = deps.idGenerator.generate();

  const authUrlResult = await adapter.createAuthorizationUrl({
    workspaceId: command.workspaceId,
    platform,
    state: rawState,
    redirectUri: command.redirectUri,
    scopes,
  });

  let encryptedVerifier: EncryptedOAuthVerifier | undefined;
  if (authUrlResult.codeVerifier) {
    if (!deps.protector) {
      throw new SocialAuthNotConfiguredError('Missing protector for PKCE verifier encryption.');
    }
    encryptedVerifier = deps.protector.encryptOAuthVerifier({
      workspaceId: command.workspaceId,
      transactionId,
      platform,
      codeVerifier: authUrlResult.codeVerifier,
    });
  }

  const responseData: AuthorizeResponseData = {
    authorizationUrl: authUrlResult.authorizationUrl,
    transactionId,
    expiresAt: expiresAt.toISOString(),
  };

  const routeKey = `POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/reconnect`;
  const result = await deps.persistence.saveOAuthTransactionWithIdempotency({
    id: transactionId,
    workspaceId: command.workspaceId,
    platform,
    initiatedByUserId: command.actorUserId,
    stateHash,
    pkceVerifierCiphertext: encryptedVerifier?.ciphertext ?? null,
    pkceVerifierIv: encryptedVerifier?.iv ?? null,
    pkceVerifierAuthTag: encryptedVerifier?.authTag ?? null,
    encryptionKeyVersion: encryptedVerifier?.keyVersion ?? null,
    redirectUri: command.redirectUri,
    returnTo,
    requestedScopes: scopes,
    reconnectAccountId: existingAccount.id,
    expectedProviderAccountId: existingAccount.providerAccountId,
    exchangeStage: 'code_received',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    idempotencyKey: command.idempotencyKey,
    keyHash: command.keyHash,
    requestHash: command.requestHash,
    routeKey,
    responseData,
    auditContext: command.auditContext,
  });

  return {
    authorizationUrl: result.response.authorizationUrl,
    transactionId: result.response.transactionId,
    expiresAt: result.response.expiresAt,
    replayed: result.replayed,
  };
}
