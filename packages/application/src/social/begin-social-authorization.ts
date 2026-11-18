import crypto from 'node:crypto';
import {
  isSocialPlatform,
  parseUserId,
  parseWorkspaceId,
  validateOAuthReturnTo,
  type SocialPlatform,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { SocialAuthNotConfiguredError, SocialPlatformUnsupportedError } from './errors.js';
import type {
  AuthorizeResponseData,
  EncryptedOAuthVerifier,
  SocialAuditContext,
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from './ports.js';

export interface BeginSocialAuthorizationCommand {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly platform: string;
  readonly redirectUri: string;
  readonly returnTo?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly keyHash?: Uint8Array | undefined;
  readonly requestHash?: Uint8Array | undefined;
}

export interface BeginSocialAuthorizationDependencies {
  readonly persistence: SocialPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly protector?: SocialCredentialProtectorPort | undefined;
  readonly adapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly enabled: boolean;
  readonly transactionTtlSeconds: number;
  readonly idGenerator: { generate(): string };
  readonly clock: { now(): Date };
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface BeginSocialAuthorizationResult {
  readonly transactionId: string;
  readonly authorizationUrl: string;
  readonly expiresAt?: string | undefined;
}

const DEFAULT_SERVER_SCOPES: Record<SocialPlatform, readonly string[]> = {
  threads: Object.freeze(['threads_basic', 'threads_content_publish']),
  tiktok: Object.freeze(['user.info.basic', 'video.publish']),
};

export async function beginSocialAuthorization(
  command: BeginSocialAuthorizationCommand,
  deps: BeginSocialAuthorizationDependencies,
): Promise<BeginSocialAuthorizationResult> {
  if (!deps.enabled) {
    throw new SocialAuthNotConfiguredError();
  }

  const wsId = parseWorkspaceId(command.workspaceId);
  const actorId = parseUserId(command.actorUserId);

  await authorizeWorkspaceAction(
    {
      workspaceId: wsId,
      userId: actorId,
      capability: 'social_accounts.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  if (!isSocialPlatform(command.platform)) {
    throw new SocialPlatformUnsupportedError(command.platform);
  }
  const platform = command.platform;

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

  // 1. Create authorization URL from adapter first (capturing PKCE verifier if adapter produces one)
  const authUrlResult = await adapter.createAuthorizationUrl({
    workspaceId: wsId,
    platform,
    state: rawState,
    redirectUri: command.redirectUri,
    scopes,
  });

  // 2. Encrypt PKCE verifier if present
  let encryptedVerifier: EncryptedOAuthVerifier | undefined;
  if (authUrlResult.codeVerifier) {
    if (!deps.protector) {
      throw new SocialAuthNotConfiguredError('Missing protector for PKCE verifier encryption.');
    }
    encryptedVerifier = deps.protector.encryptOAuthVerifier({
      workspaceId: wsId,
      transactionId,
      platform,
      codeVerifier: authUrlResult.codeVerifier,
    });
  }

  const responseData: AuthorizeResponseData = {
    transactionId,
    authorizationUrl: authUrlResult.authorizationUrl,
    expiresAt: expiresAt.toISOString(),
  };

  // 3. Atomically persist transaction with idempotency if key is provided
  if (
    command.idempotencyKey &&
    command.keyHash &&
    command.requestHash &&
    typeof deps.persistence.saveOAuthTransactionWithIdempotency === 'function'
  ) {
    const routeKey = `POST /api/v1/workspaces/:workspaceId/social-connections/${platform}/authorize`;
    const idempResult = await deps.persistence.saveOAuthTransactionWithIdempotency({
      id: transactionId,
      workspaceId: wsId,
      platform,
      initiatedByUserId: actorId,
      stateHash,
      pkceVerifierCiphertext: encryptedVerifier?.ciphertext ?? null,
      pkceVerifierIv: encryptedVerifier?.iv ?? null,
      pkceVerifierAuthTag: encryptedVerifier?.authTag ?? null,
      encryptionKeyVersion: encryptedVerifier?.keyVersion ?? null,
      redirectUri: command.redirectUri,
      returnTo,
      requestedScopes: scopes,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      idempotencyKey: command.idempotencyKey,
      keyHash: command.keyHash,
      requestHash: command.requestHash,
      routeKey,
      responseData,
      auditContext: deps.auditContext,
    });

    return {
      transactionId: idempResult.response.transactionId,
      authorizationUrl: idempResult.response.authorizationUrl,
      expiresAt: idempResult.response.expiresAt,
    };
  }

  // Fallback if idempotency params omitted in test mock
  await deps.persistence.saveOAuthTransaction({
    id: transactionId,
    workspaceId: wsId,
    platform,
    initiatedByUserId: actorId,
    stateHash,
    pkceVerifierCiphertext: encryptedVerifier?.ciphertext ?? null,
    pkceVerifierIv: encryptedVerifier?.iv ?? null,
    pkceVerifierAuthTag: encryptedVerifier?.authTag ?? null,
    encryptionKeyVersion: encryptedVerifier?.keyVersion ?? null,
    redirectUri: command.redirectUri,
    returnTo,
    requestedScopes: scopes,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return responseData;
}
