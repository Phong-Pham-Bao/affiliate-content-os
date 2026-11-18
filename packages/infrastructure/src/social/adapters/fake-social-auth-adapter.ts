import crypto from 'node:crypto';
import type { SocialAccountEnvironment, SocialPlatform } from '@affiliate-content-os/domain';
import {
  SocialAuthExchangeError,
  SocialAuthRateLimitError,
  type CreateAuthorizationUrlInput,
  type CreateAuthorizationUrlResult,
  type ExchangeCodeInput,
  type ExchangeCodeResult,
  type SocialAuthAdapter,
} from '@affiliate-content-os/application';

export interface FakeSocialAuthAdapterOptions {
  readonly platform: SocialPlatform;
  readonly authBaseUrl?: string | undefined;
  readonly environment?: SocialAccountEnvironment | undefined;
}

export class FakeSocialAuthAdapter implements SocialAuthAdapter {
  public readonly platform: SocialPlatform;
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
    };
  }

  public async revoke(_accessToken: string): Promise<void> {
    // No-op for fake adapter
  }
}
