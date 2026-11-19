import type {
  SocialAccountSnapshot,
  SocialAccountStatus,
  SocialAccountStatusReason,
} from '@affiliate-content-os/domain';
import type { EncryptedSocialCredentials } from './ports-crypto.js';

export interface SocialAuditContext {
  readonly ipHash?: string | null | undefined;
  readonly userAgentSummary?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
}

export interface ClaimSocialAccountForRefreshParams {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly workerId?: string | undefined;
  readonly leaseDurationSeconds: number;
  readonly now: string;
}

export interface ClaimedSocialAccountRefresh {
  readonly account: SocialAccountSnapshot;
  readonly encryptedCredentials: EncryptedSocialCredentials;
  readonly claimedAccountVersion: number;
  readonly claimedCredentialVersion: number;
}

export interface CompleteSocialAccountRefreshParams {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly expectedAccountVersion: number;
  readonly expectedCredentialVersion: number;
  readonly encryptedCredentials: EncryptedSocialCredentials;
  readonly tokenExpiresAt: string | null;
  readonly nextRefreshAt: string | null;
  readonly derivedStatus: SocialAccountStatus;
  readonly statusReason: SocialAccountStatusReason;
  readonly now: string;
  readonly actorUserId?: string | undefined;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface RecordFailedSocialAccountRefreshParams {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly expectedAccountVersion: number;
  readonly derivedStatus: SocialAccountStatus;
  readonly statusReason: SocialAccountStatusReason;
  readonly nextRefreshAt: string | null;
  readonly reauthRequiredAt?: string | null | undefined;
  readonly now: string;
  readonly actorUserId?: string | undefined;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface DisconnectSocialAccountParams {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly actorUserId: string;
  readonly expectedVersion: number;
  readonly externalRevocationAttempted: boolean;
  readonly externalRevocationSupported: boolean;
  readonly externalRevocationResult: 'succeeded' | 'failed' | 'unsupported';
  readonly now: string;
  readonly auditContext?: SocialAuditContext | undefined;
}
