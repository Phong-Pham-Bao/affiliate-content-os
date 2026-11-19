import type { SocialPlatform } from '@affiliate-content-os/domain';
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
  readonly appReviewStatus?: 'development' | 'approved' | undefined;
  readonly socialKillSwitchActive?: boolean | undefined;
  readonly connectionKillSwitchActive?: boolean | undefined;
}

export interface CompleteSocialCallbackResult {
  readonly redirectUrl: string;
  readonly resultKey: string;
  readonly isSuccess: boolean;
}
