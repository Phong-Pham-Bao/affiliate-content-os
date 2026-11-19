import {
  parseUserId,
  parseWorkspaceId,
  type SocialAccountSnapshot,
  type SocialPlatform,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { SocialAccountNotFoundError, SocialAccountVersionMismatchError } from './errors.js';
import type {
  SocialAuditContext,
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from './ports.js';

export interface DisconnectSocialAccountCommand {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly actorUserId: string;
  readonly expectedVersion: number;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface DisconnectSocialAccountDependencies {
  readonly persistence: SocialPersistencePort;
  readonly workspaceAuthorization?: WorkspaceAuthorizationPort | undefined;
  readonly protector?: SocialCredentialProtectorPort | undefined;
  readonly adapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly clock: { now(): Date };
}

export interface DisconnectSocialAccountResult {
  readonly account: SocialAccountSnapshot;
  readonly alreadyDisconnected: boolean;
}

export async function disconnectSocialAccount(
  command: DisconnectSocialAccountCommand,
  deps: DisconnectSocialAccountDependencies,
): Promise<DisconnectSocialAccountResult> {
  if (deps.workspaceAuthorization) {
    await authorizeWorkspaceAction(
      {
        workspaceId: parseWorkspaceId(command.workspaceId),
        userId: parseUserId(command.actorUserId),
        capability: 'social_accounts.manage',
      },
      { authorization: deps.workspaceAuthorization },
    );
  }

  const existing = await deps.persistence.findSocialAccountById({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
  });

  if (!existing) {
    throw new SocialAccountNotFoundError();
  }

  // Idempotent completion if already disconnected
  if (existing.status === 'disconnected') {
    return { account: existing, alreadyDisconnected: true };
  }

  // Optimistic concurrency check
  if (existing.version !== command.expectedVersion) {
    throw new SocialAccountVersionMismatchError();
  }

  const adapter = deps.adapters.get(existing.platform);
  const supportsRevocation = Boolean(adapter && adapter.supportsRevocation);

  let revocationResult: 'succeeded' | 'failed' | 'unsupported' = supportsRevocation
    ? 'failed'
    : 'unsupported';
  let revocationAttempted = false;

  if (supportsRevocation && adapter?.revokeToken && deps.protector) {
    try {
      const encryptedCreds = await deps.persistence.findEncryptedCredentials({
        workspaceId: command.workspaceId,
        accountId: command.accountId,
      });
      if (encryptedCreds) {
        const decrypted = deps.protector.decrypt({
          workspaceId: command.workspaceId,
          socialAccountId: command.accountId,
          platform: existing.platform,
          credentials: encryptedCreds,
        });
        revocationAttempted = true;
        const res = await adapter.revokeToken(decrypted.accessToken);
        revocationResult = res.revoked ? 'succeeded' : 'failed';
      }
    } catch {
      revocationResult = 'failed';
    }
  }

  const now = deps.clock.now().toISOString();

  // Atomically disable account locally and remove/cryptographically erase credentials
  const account = await deps.persistence.disconnectSocialAccountAtomic({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
    actorUserId: command.actorUserId,
    expectedVersion: command.expectedVersion,
    externalRevocationAttempted: revocationAttempted,
    externalRevocationSupported: supportsRevocation,
    externalRevocationResult: revocationResult,
    now,
    auditContext: command.auditContext,
  });

  return { account, alreadyDisconnected: false };
}
