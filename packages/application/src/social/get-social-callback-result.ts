import crypto from 'node:crypto';
import {
  parseUserId,
  parseWorkspaceId,
  type OAuthCallbackResultStatus,
  type SocialPlatform,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { CallbackResultGoneError, SocialAuthNotConfiguredError } from './errors.js';
import type { SocialPersistencePort } from './ports.js';

export interface GetSocialCallbackResultQuery {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly resultKey: string;
}

export interface GetSocialCallbackResultDependencies {
  readonly persistence: SocialPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly enabled: boolean;
  readonly clock: { now(): Date };
}

export interface SafeCallbackResultDTO {
  readonly id: string;
  readonly status: OAuthCallbackResultStatus;
  readonly platform: SocialPlatform;
  readonly socialAccountId: string | null;
  readonly errorCode: string | null;
  readonly errorDescription: string | null;
}

export async function getSocialCallbackResult(
  query: GetSocialCallbackResultQuery,
  deps: GetSocialCallbackResultDependencies,
): Promise<SafeCallbackResultDTO> {
  if (!deps.enabled) {
    throw new SocialAuthNotConfiguredError();
  }

  const wsId = parseWorkspaceId(query.workspaceId);
  const actorId = parseUserId(query.actorUserId);

  await authorizeWorkspaceAction(
    {
      workspaceId: wsId,
      userId: actorId,
      capability: 'publications.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  if (
    typeof query.resultKey !== 'string' ||
    query.resultKey.length < 16 ||
    query.resultKey.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(query.resultKey)
  ) {
    throw new ValidationError(
      'Invalid resultKey: must be 16-256 base64url characters.',
      'resultKey',
    );
  }

  const now = deps.clock.now();
  const resultKeyHash = crypto.createHash('sha256').update(query.resultKey, 'utf8').digest();

  const consumed = await deps.persistence.consumeCallbackResult({
    workspaceId: wsId,
    actorUserId: actorId,
    resultKeyHash,
    now: now.toISOString(),
  });

  if (!consumed) {
    // If consume returned null, it is either gone/already consumed or never existed.
    // Throw CallbackResultGoneError (or NotFound if never existed - let adapter distinguish or throw Gone)
    throw new CallbackResultGoneError();
  }

  return {
    id: consumed.id,
    status: consumed.status,
    platform: consumed.platform,
    socialAccountId: consumed.socialAccountId,
    errorCode: consumed.errorCode,
    errorDescription: consumed.errorDescription,
  };
}
