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

  // Local-first atomic disconnect:
  // - If revocation is unsupported (e.g. Threads), disconnects locally without calling provider.
  // - If revocation is supported, stages encrypted token material for durable worker processing in the same transaction.
  // - Returns authoritative local disconnected state immediately; never awaits remote provider call in HTTP request.
  const initialResult = supportsRevocation ? 'pending' : 'unsupported';
  const account = await deps.persistence.disconnectSocialAccountAtomic({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
    actorUserId: command.actorUserId,
    expectedVersion: command.expectedVersion,
    externalRevocationAttempted: supportsRevocation,
    externalRevocationSupported: supportsRevocation,
    externalRevocationResult: initialResult,
    now,
    auditContext: command.auditContext,
    operationId: command.operationId,
  });

  return { account, alreadyDisconnected: false };
}
