import type { SocialAccountEnvironment, SocialPlatform } from '@affiliate-content-os/domain';
import {
  SocialAuthExchangeError,
  SocialAuthOutcomeUnknownError,
  type CreateAuthorizationUrlInput,
  type CreateAuthorizationUrlResult,
  type ExchangeCodeInput,
  type ExchangeCodeResult,
  type RefreshTokenInput,
  type RefreshTokenResult,
  type RevokeTokenResult,
  type SocialAuthAdapter,
} from '@affiliate-content-os/application';
import { classifyThreadsError } from './threads-error-classifier.js';
import { DefaultHttpTransport, type HttpTransport } from './threads-http-transport.js';

export interface ThreadsSocialAuthAdapterOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly authBaseUrl?: string | undefined;
  readonly apiBaseUrl?: string | undefined;
  readonly apiVersion?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly environment?: SocialAccountEnvironment | undefined;
  readonly transport?: HttpTransport | undefined;
}

export class ThreadsSocialAuthAdapter implements SocialAuthAdapter {
  public readonly platform: SocialPlatform = 'threads';
  public readonly supportsRefresh = true;
  public readonly supportsRevocation = false;

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly authBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly environment: SocialAccountEnvironment;
  private readonly transport: HttpTransport;

  constructor(options: ThreadsSocialAuthAdapterOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.authBaseUrl = options.authBaseUrl ?? 'https://threads.net';
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://graph.threads.net';
    this.apiVersion = options.apiVersion ?? 'v1.0';
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.environment = options.environment ?? 'production';
    this.transport = options.transport ?? new DefaultHttpTransport(this.timeoutMs);
  }

  public async createAuthorizationUrl(
    input: CreateAuthorizationUrlInput,
  ): Promise<CreateAuthorizationUrlResult> {
    const scopes =
      input.scopes.length > 0 ? input.scopes.join(',') : 'threads_basic,threads_content_publish';
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: input.redirectUri,
      scope: scopes,
      response_type: 'code',
      state: input.state,
    });
    return { authorizationUrl: `${this.authBaseUrl}/oauth/authorize?${params.toString()}` };
  }

  public async exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
    // 1. Short-token exchange (pre-token stage)
    const shortTokenBody = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code: input.code,
    });

    let shortRes;
    try {
      shortRes = await this.transport.fetch({
        method: 'POST',
        url: `${this.apiBaseUrl}/oauth/access_token`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: shortTokenBody,
        timeoutMs: this.timeoutMs,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('timed out')) {
        throw new SocialAuthOutcomeUnknownError();
      }
      throw new SocialAuthExchangeError('Network error during short token exchange');
    }

    if (shortRes.status !== 200) {
      throw classifyThreadsError(shortRes.status, shortRes.body, true);
    }

    let shortData: { access_token?: string; user_id?: string | number };
    try {
      shortData = JSON.parse(shortRes.body);
    } catch {
      throw new SocialAuthExchangeError('Invalid JSON from provider token endpoint');
    }

    if (!shortData.access_token || !shortData.user_id) {
      throw new SocialAuthExchangeError('Provider omitted access_token or user_id in response');
    }

    const shortLivedToken = String(shortData.access_token);
    const providerAccountId = String(shortData.user_id).trim();

    // 2. Long-token exchange (post-token stage; failure is recoverable!)
    let longLivedToken = shortLivedToken;
    let tokenExpiresInSeconds: number | null | undefined = 3600;
    let tokenKind: 'short_lived' | 'long_lived' = 'short_lived';
    let stage: 'short_token_exchanged' | 'long_token_exchanged' | 'completed' =
      'short_token_exchanged';
    let isRecoverablePartial = false;

    try {
      const longUrl = `${this.apiBaseUrl}/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(this.appSecret)}&access_token=${encodeURIComponent(shortLivedToken)}`;
      const longRes = await this.transport.fetch({
        method: 'GET',
        url: longUrl,
        headers: { Accept: 'application/json' },
        timeoutMs: this.timeoutMs,
      });

      if (longRes.status === 200) {
        const longData = JSON.parse(longRes.body);
        if (longData.access_token) {
          longLivedToken = String(longData.access_token);
          tokenExpiresInSeconds =
            typeof longData.expires_in === 'number' ? longData.expires_in : 5184000;
          tokenKind = 'long_lived';
          stage = 'long_token_exchanged';
        }
      } else {
        isRecoverablePartial = true;
      }
    } catch {
      isRecoverablePartial = true;
    }

    // 3. Profile lookup (post-token stage)
    let displayName = `Threads User ${providerAccountId}`;
    let handle: string | null = null;
    try {
      const profileUrl = `${this.apiBaseUrl}/${this.apiVersion}/me?fields=id,username,name&access_token=${encodeURIComponent(longLivedToken)}`;
      const profileRes = await this.transport.fetch({
        method: 'GET',
        url: profileUrl,
        headers: { Accept: 'application/json' },
        timeoutMs: this.timeoutMs,
      });
      if (profileRes.status === 200) {
        const profileData = JSON.parse(profileRes.body);
        if (profileData.username) handle = `@${String(profileData.username).trim()}`;
        if (profileData.name) displayName = String(profileData.name).trim();
        else if (profileData.username) displayName = String(profileData.username).trim();
        if (!isRecoverablePartial) stage = 'completed';
      } else {
        isRecoverablePartial = true;
      }
    } catch {
      isRecoverablePartial = true;
    }

    // 4. Granted scopes determination
    const grantedScopes: string[] = ['threads_basic'];
    if (!isRecoverablePartial) {
      try {
        const permUrl = `${this.apiBaseUrl}/${this.apiVersion}/me/permissions?access_token=${encodeURIComponent(longLivedToken)}`;
        const permRes = await this.transport.fetch({
          method: 'GET',
          url: permUrl,
          headers: { Accept: 'application/json' },
          timeoutMs: this.timeoutMs,
        });
        if (permRes.status === 200) {
          const permData = JSON.parse(permRes.body);
          if (Array.isArray(permData.data)) {
            for (const item of permData.data) {
              if (item.status === 'granted' && typeof item.permission === 'string') {
                if (!grantedScopes.includes(item.permission)) grantedScopes.push(item.permission);
              }
            }
          }
        } else {
          // If me/permissions is unavailable, threads_content_publish is assumed if requested and unblocked
          grantedScopes.push('threads_content_publish');
        }
      } catch {
        grantedScopes.push('threads_content_publish');
      }
    }

    const capabilities: Record<string, boolean> = {
      canPublishText: !isRecoverablePartial && grantedScopes.includes('threads_content_publish'),
      canPublishMedia: false,
    };

    return {
      providerAccountId,
      displayName,
      handle,
      accessToken: longLivedToken,
      tokenExpiresInSeconds,
      grantedScopes: Object.freeze(grantedScopes),
      capabilities: Object.freeze(capabilities),
      environment: this.environment,
      stage,
      tokenKind,
      isRecoverablePartial,
    };
  }

  public async refreshToken(input: RefreshTokenInput): Promise<RefreshTokenResult> {
    const refreshUrl = `${this.apiBaseUrl}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(input.accessToken)}`;
    const res = await this.transport.fetch({
      method: 'GET',
      url: refreshUrl,
      headers: { Accept: 'application/json' },
      timeoutMs: this.timeoutMs,
    });

    if (res.status !== 200) {
      throw classifyThreadsError(res.status, res.body, false);
    }

    const data = JSON.parse(res.body);
    if (!data.access_token) {
      throw new SocialAuthExchangeError('Provider omitted access_token during refresh');
    }

    return {
      accessToken: String(data.access_token),
      tokenExpiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : 5184000,
      tokenKind: 'long_lived',
    };
  }

  public async revokeToken(_accessToken?: string): Promise<RevokeTokenResult> {
    // Official Threads API does not provide a client token revocation endpoint
    return { supported: false, revoked: false };
  }
}
