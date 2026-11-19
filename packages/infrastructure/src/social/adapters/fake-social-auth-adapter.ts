import crypto from 'node:crypto';
import type { SocialAccountEnvironment, SocialPlatform } from '@affiliate-content-os/domain';
import {
  SocialAuthExchangeError,
  SocialAuthRateLimitError,
  type CreateAuthorizationUrlInput,
  type CreateAuthorizationUrlResult,
  type ExchangeCodeInput,
  type ExchangeCodeResult,
  type InspectAccountInput,
  type InspectAccountResult,
  type RefreshTokenInput,
  type RefreshTokenResult,
  type RevokeTokenResult,
  type SocialAuthAdapter,
} from '@affiliate-content-os/application';

export interface FakeSocialAuthAdapterOptions {
  readonly platform: SocialPlatform;
  readonly authBaseUrl?: string | undefined;
  readonly environment?: SocialAccountEnvironment | undefined;
}

export class FakeSocialAuthAdapter implements SocialAuthAdapter {
  public readonly platform: SocialPlatform;
  public readonly supportsRefresh = true;
  public readonly supportsRevocation = false;
  private readonly authBaseUrl: string;
  private readonly environment: SocialAccountEnvironment;

  constructor(options: FakeSocialAuthAdapterOptions) {
    this.platform = options.platform;
    this.authBaseUrl = options.authBaseUrl ?? 'http://localhost:3000';
    this.environment = options.environment ?? 'local';
  }

  public async createAuthorizationUrl(
    input: CreateAuthorizationUrlInput,
  ): Promise<CreateAuthorizationUrlResult> {
    const params = new URLSearchParams({
      platform: this.platform,
      state: input.state,
      redirect_uri: input.redirectUri,
      scopes: input.scopes.join(' '),
      client_id: `fake_${this.platform}_client_id`,
      mock_env: this.environment,
    });

    const authorizationUrl = `${this.authBaseUrl}/fake-social-auth?${params.toString()}`;
    return { authorizationUrl };
  }

  public async exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
    const code = input.code;

    if (code.startsWith('fail_exchange') || code === 'invalid_code') {
      throw new SocialAuthExchangeError('Simulated fake code exchange failure.');
    }

    if (code.startsWith('fail_rate_limit')) {
      throw new SocialAuthRateLimitError('Simulated fake provider rate limit.', 60);
    }

    if (code.startsWith('fail_long_token')) {
      const deterministicSuffix = crypto
        .createHash('sha256')
        .update(code, 'utf8')
        .digest('hex')
        .slice(0, 8);
      return {
        providerAccountId: `fake_${this.platform}_user_${deterministicSuffix}`,
        displayName: `Fake ${this.platform === 'threads' ? 'Threads' : 'TikTok'} Creator`,
        handle: `@fake_${this.platform}_${deterministicSuffix}`,
        accessToken: `fake_short_token_${deterministicSuffix}`,
        tokenExpiresInSeconds: 3600,
        grantedScopes: ['threads_basic'],
        capabilities: { canPublishText: false, canPublishMedia: false },
        environment: this.environment,
        stage: 'short_token_exchanged',
        isRecoverablePartial: true,
      };
    }

    const deterministicSuffix = crypto
      .createHash('sha256')
      .update(code, 'utf8')
      .digest('hex')
      .slice(0, 8);

    const providerAccountId = `fake_${this.platform}_user_${deterministicSuffix}`;
    const displayName =
      this.platform === 'threads' ? 'Fake Threads Creator' : 'Fake TikTok Creator';
    const handle = `@fake_${this.platform}_${deterministicSuffix}`;

    const accessToken = `fake_access_token_${crypto
      .createHash('sha256')
      .update(`access_${code}`, 'utf8')
      .digest('hex')
      .slice(0, 32)}`;

    const refreshToken = `fake_refresh_token_${crypto
      .createHash('sha256')
      .update(`refresh_${code}`, 'utf8')
      .digest('hex')
      .slice(0, 32)}`;

    const grantedScopes =
      this.platform === 'threads'
        ? ['threads_basic', 'threads_content_publish']
        : ['user.info.basic', 'video.publish'];

    const capabilities: Record<string, boolean> = {
      canPublishText: true,
      canPublishMedia: false,
    };

    return {
      providerAccountId,
      displayName,
      handle,
      accessToken,
      refreshToken,
      tokenExpiresInSeconds: 5184000,
      grantedScopes,
      capabilities,
      environment: this.environment,
      stage: 'completed',
    };
  }

  public async refreshToken(input: RefreshTokenInput): Promise<RefreshTokenResult> {
    const refreshedToken = `fake_refreshed_${crypto
      .createHash('sha256')
      .update(input.accessToken, 'utf8')
      .digest('hex')
      .slice(0, 32)}`;
    return {
      accessToken: refreshedToken,
      tokenExpiresInSeconds: 5184000,
      tokenKind: 'long_lived',
    };
  }

  public async inspectCurrentAccount(input: InspectAccountInput): Promise<InspectAccountResult> {
    if (input.accessToken.includes('fail_inspection')) {
      throw new Error('Simulated fake inspection failure');
    }
    if (input.accessToken.includes('mismatch_identity')) {
      return {
        providerAccountId: 'mismatched_provider_account_id',
        displayName: 'Mismatched User',
        handle: '@mismatched',
        grantedScopes: ['threads_basic', 'threads_content_publish'],
        capabilities: { canPublishText: true, canPublishMedia: false },
      };
    }
    if (input.accessToken.includes('missing_grants')) {
      return {
        providerAccountId: 'fake_user_id',
        displayName: 'Missing Grants User',
        handle: '@missing_grants',
        grantedScopes: ['threads_basic'],
        capabilities: { canPublishText: false, canPublishMedia: false },
      };
    }
    const grantedScopes =
      this.platform === 'threads'
        ? ['threads_basic', 'threads_content_publish']
        : ['user.info.basic', 'video.publish'];
    return {
      providerAccountId: 'fake_user_id',
      displayName: this.platform === 'threads' ? 'Fake Threads Creator' : 'Fake TikTok Creator',
      handle: `@fake_${this.platform}_user`,
      grantedScopes,
      capabilities: { canPublishText: true, canPublishMedia: false },
    };
  }

  public async revokeToken(_accessToken?: string): Promise<RevokeTokenResult> {
    return { supported: false, revoked: false };
  }

  public async revoke(_accessToken: string): Promise<void> {
    // No-op for fake adapter
  }
}
