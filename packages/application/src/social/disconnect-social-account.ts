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
  readonly operationId?: string | undefined;
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
  const now = deps.clock.now().toISOString();

  // If revocation is unsupported (e.g. Threads), locally disconnect in one fast atomic transaction
  if (!supportsRevocation) {
    const account = await deps.persistence.disconnectSocialAccountAtomic({
      workspaceId: command.workspaceId,
      accountId: command.accountId,
      actorUserId: command.actorUserId,
      expectedVersion: command.expectedVersion,
      externalRevocationAttempted: false,
      externalRevocationSupported: false,
      externalRevocationResult: 'unsupported',
      now,
      auditContext: command.auditContext,
      operationId: command.operationId,
    });
    return { account, alreadyDisconnected: false };
  }

  // For adapters supporting remote revocation:
  // 1. Decrypt token material needed for remote call before committing local deletion
  let decryptedToken: string | null = null;
  if (adapter?.revokeToken && deps.protector) {
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
        decryptedToken = decrypted.accessToken;
      }
    } catch {
      // Proceed with local disconnect, record revocation failure
    }
  }

  // 2. CRITICAL: Commit local disconnect FIRST. Credentials deleted, account status=disconnected.
  // External revocation status is staged as 'pending' (or 'failed' if decryption failed).
  const initialResult = decryptedToken ? 'pending' : 'failed';
  const disconnectedAccount = await deps.persistence.disconnectSocialAccountAtomic({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
    actorUserId: command.actorUserId,
    expectedVersion: command.expectedVersion,
    externalRevocationAttempted: Boolean(decryptedToken),
    externalRevocationSupported: true,
    externalRevocationResult: initialResult,
    now,
    auditContext: command.auditContext,
    operationId: command.operationId,
  });

  // 3. Staged provider revocation call OUTSIDE database transaction
  // The provider call cannot roll back or reactivate the locally disconnected account
  if (decryptedToken && adapter?.revokeToken) {
    let finalResult: 'succeeded' | 'failed';
    try {
      const res = await adapter.revokeToken(decryptedToken);
      finalResult = res.revoked ? 'succeeded' : 'failed';
    } catch {
      finalResult = 'failed';
    }

    if (typeof deps.persistence.updateExternalRevocationResultAtomic === 'function') {
      await deps.persistence.updateExternalRevocationResultAtomic({
        workspaceId: command.workspaceId,
        accountId: command.accountId,
        externalRevocationResult: finalResult,
        now: deps.clock.now().toISOString(),
      });
    }

    // Return updated account snapshot with truthful externalRevocationResult
    return {
      account: {
        ...disconnectedAccount,
        externalRevocationResult: finalResult,
      },
      alreadyDisconnected: false,
    };
  }

  return { account: disconnectedAccount, alreadyDisconnected: false };
}
