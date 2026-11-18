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
import type { SocialAuditContext, SocialAuthAdapter, SocialPersistencePort } from './ports.js';

export interface BeginSocialAuthorizationCommand {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly platform: string;
  readonly redirectUri: string;
  readonly returnTo?: string | undefined;
}

export interface BeginSocialAuthorizationDependencies {
  readonly persistence: SocialPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
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

  await deps.persistence.saveOAuthTransaction({
    id: transactionId,
    workspaceId: wsId,
    platform,
    initiatedByUserId: actorId,
    stateHash,
    redirectUri: command.redirectUri,
    returnTo,
    requestedScopes: scopes,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const authUrlResult = await adapter.createAuthorizationUrl({
    workspaceId: wsId,
    platform,
    state: rawState,
    redirectUri: command.redirectUri,
    scopes,
  });

  return {
    transactionId,
    authorizationUrl: authUrlResult.authorizationUrl,
  };
}
