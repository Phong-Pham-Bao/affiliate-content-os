import type {
  ExternalRevocationResult,
  OAuthCallbackResultStatus,
  SocialAccountAction,
  SocialAccountSnapshot,
  SocialAccountStatus,
  SocialAccountStatusReason,
  SocialPlatform,
} from '@affiliate-content-os/domain';
import type {
  BeginSocialAuthorizationResult,
  SafeCallbackResultDTO,
} from '@affiliate-content-os/application';

export interface SocialAccountDto {
  readonly id: string;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly providerAccountId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly status: SocialAccountStatus;
  readonly statusReason: SocialAccountStatusReason | null;
  readonly grantedScopes: readonly string[];
  readonly capabilities: {
    readonly canPublishText?: boolean | undefined;
    readonly canPublishMedia?: boolean | undefined;
    readonly isBusinessAccount?: boolean | undefined;
  };
  readonly capabilitiesCheckedAt: string | null;
  readonly tokenExpiresAt: string | null;
  readonly reauthRequiredAt: string | null;
  readonly lastRefreshedAt: string | null;
  readonly nextRefreshAt: string | null;
  readonly allowedActions: readonly SocialAccountAction[];
  readonly externalRevocationSupported: boolean;
  readonly externalRevocationResult: ExternalRevocationResult | null;
  readonly connectedByUserId: string;
  readonly environment: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface SocialAccountListDto {
  readonly items: readonly SocialAccountDto[];
}

export interface SocialAuthorizeResponseDto {
  readonly authorizationUrl: string;
  readonly transactionId: string;
  readonly expiresAt: string;
}

export interface SocialCallbackResultDto {
  readonly id: string;
  readonly status: OAuthCallbackResultStatus;
  readonly platform: SocialPlatform;
  readonly socialAccountId: string | null;
  readonly errorCode: string | null;
  readonly errorDescription: string | null;
}

export function serializeSocialAccount(account: SocialAccountSnapshot): SocialAccountDto {
  return Object.freeze({
    id: account.id,
    workspaceId: account.workspaceId,
    platform: account.platform,
    providerAccountId: account.providerAccountId,
    displayName: account.displayName,
    handle: account.handle,
    status: account.status,
    statusReason: account.statusReason ?? null,
    grantedScopes: Object.freeze([...account.grantedScopes]),
    capabilities: Object.freeze({ ...account.capabilities }),
    capabilitiesCheckedAt: account.capabilitiesCheckedAt,
    tokenExpiresAt: account.tokenExpiresAt,
    reauthRequiredAt: account.reauthRequiredAt ?? null,
    lastRefreshedAt: account.lastRefreshedAt ?? null,
    nextRefreshAt: account.nextRefreshAt ?? null,
    allowedActions: Object.freeze([...(account.allowedActions ?? [])]),
    externalRevocationSupported: account.externalRevocationSupported ?? false,
    externalRevocationResult: account.externalRevocationResult ?? null,
    connectedByUserId: account.connectedByUserId,
    environment: account.environment,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    version: account.version,
  });
}

export function serializeSocialAccountList(
  accounts: readonly SocialAccountSnapshot[],
): SocialAccountListDto {
  return Object.freeze({
    items: Object.freeze(accounts.map(serializeSocialAccount)),
  });
}

export function serializeAuthorizeResponse(
  result: BeginSocialAuthorizationResult,
  expiresAt: string,
): SocialAuthorizeResponseDto {
  return Object.freeze({
    authorizationUrl: result.authorizationUrl,
    transactionId: result.transactionId,
    expiresAt,
  });
}

export function serializeCallbackResult(result: SafeCallbackResultDTO): SocialCallbackResultDto {
  return Object.freeze({
    id: result.id,
    status: result.status,
    platform: result.platform,
    socialAccountId: result.socialAccountId,
    errorCode: result.errorCode,
    errorDescription: result.errorDescription,
  });
}
