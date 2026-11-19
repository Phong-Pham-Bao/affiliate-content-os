import type { SocialAccountEnvironment, SocialPlatform } from '@affiliate-content-os/domain';
import {
  SocialAuthExchangeError,
  SocialAuthOutcomeUnknownError,
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

const REQUIRED_SCOPES = ['threads_basic', 'threads_content_publish'] as const;

function hasControlCharacters(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
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
    this.authBaseUrl = options.authBaseUrl ?? 'https://www.threads.com';
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://graph.threads.com';
    this.apiVersion = options.apiVersion ?? 'v1.0';
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.environment = options.environment ?? 'production';
    this.transport = options.transport ?? new DefaultHttpTransport(this.timeoutMs);
  }

  public async createAuthorizationUrl(
    input: CreateAuthorizationUrlInput,
  ): Promise<CreateAuthorizationUrlResult> {
    if (!input.scopes || input.scopes.length !== 2) {
      throw new SocialAuthExchangeError('Invalid authorization scopes requested');
    }
    const scopeSet = new Set(input.scopes);
    if (
      scopeSet.size !== 2 ||
      !scopeSet.has('threads_basic') ||
      !scopeSet.has('threads_content_publish')
    ) {
      throw new SocialAuthExchangeError('Invalid authorization scopes requested');
    }

    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: input.redirectUri,
      scope: 'threads_basic,threads_content_publish',
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
      throw classifyThreadsError(shortRes.status, shortRes.body, true, shortRes.headers);
    }

    let shortData: { access_token?: unknown; user_id?: unknown };
    try {
      shortData = JSON.parse(shortRes.body);
    } catch {
      throw new SocialAuthExchangeError('Invalid JSON from provider token endpoint');
    }

    if (
      typeof shortData.access_token !== 'string' ||
      shortData.access_token.length === 0 ||
      shortData.access_token.length > 1024 ||
      (!shortData.user_id && shortData.user_id !== 0)
    ) {
      throw new SocialAuthExchangeError(
        'Provider omitted or returned invalid access_token or user_id',
      );
    }

    const shortLivedToken = String(shortData.access_token);
    const rawId = String(shortData.user_id).trim();
    if (!rawId || rawId.length > 128 || hasControlCharacters(rawId)) {
      throw new SocialAuthExchangeError('Invalid provider user ID');
    }
    const providerAccountId = rawId;

    // 2. Long-token exchange (post-token stage; failure is recoverable)
    let longLivedToken = shortLivedToken;
    let tokenExpiresInSeconds: number | null | undefined = 3600;
    let tokenKind: 'short_lived' | 'long_lived' = 'short_lived';
    let stage:
      'short_token_exchanged' | 'long_token_exchanged' | 'profile_inspected' | 'completed' =
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
        if (typeof longData.access_token === 'string' && longData.access_token.length > 0) {
          if (
            longData.expires_in !== undefined &&
            (typeof longData.expires_in !== 'number' ||
              !Number.isSafeInteger(longData.expires_in) ||
              longData.expires_in <= 0)
          ) {
            throw new SocialAuthExchangeError('Invalid token expires_in returned by provider');
          }
          longLivedToken = String(longData.access_token);
          tokenExpiresInSeconds =
            typeof longData.expires_in === 'number' &&
            Number.isSafeInteger(longData.expires_in) &&
            longData.expires_in > 0 &&
            longData.expires_in <= 31536000
              ? longData.expires_in
              : 5184000;
          tokenKind = 'long_lived';
          stage = 'long_token_exchanged';
        } else {
          isRecoverablePartial = true;
        }
      } else {
        isRecoverablePartial = true;
      }
    } catch (err: unknown) {
      if (err instanceof SocialAuthExchangeError) {
        throw err;
      }
      isRecoverablePartial = true;
    }

    // 3. Profile lookup (post-token stage)
    let displayName = providerAccountId;
    let handle: string | null = null;
    let profileVerified = false;

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
        if (typeof profileData.id === 'string' || typeof profileData.id === 'number') {
          const profileId = String(profileData.id).trim();
          if (!profileId || profileId.length > 128 || hasControlCharacters(profileId)) {
            throw new SocialAuthExchangeError('Invalid provider profile user ID');
          }
          if (profileId !== providerAccountId) {
            throw new SocialAuthExchangeError(
              'Provider profile user ID does not match token exchange user ID',
            );
          }
          profileVerified = true;
          const validName =
            typeof profileData.name === 'string' && profileData.name.trim().length > 0
              ? profileData.name.trim().slice(0, 128)
              : null;
          const validUsername =
            typeof profileData.username === 'string' && profileData.username.trim().length > 0
              ? profileData.username.trim().slice(0, 64)
              : null;
          displayName = validName ?? validUsername ?? providerAccountId;
          if (validUsername) handle = `@${validUsername}`;
          if (!isRecoverablePartial) stage = 'profile_inspected';
        } else {
          isRecoverablePartial = true;
        }
      } else {
        isRecoverablePartial = true;
      }
    } catch (err: unknown) {
      if (err instanceof SocialAuthExchangeError && err.message.includes('does not match')) {
        throw err;
      }
      isRecoverablePartial = true;
    }

    // 4. Granted scopes determination: start empty, NEVER fabricate
    const grantedScopes: string[] = [];
    let grantsVerified = false;

    if (!isRecoverablePartial && profileVerified) {
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
            const items = permData.data.slice(0, 50);
            for (const item of items) {
              if (
                item &&
                item.status === 'granted' &&
                typeof item.permission === 'string' &&
                item.permission.length <= 64 &&
                !hasControlCharacters(item.permission)
              ) {
                if (
                  REQUIRED_SCOPES.includes(item.permission as (typeof REQUIRED_SCOPES)[number]) &&
                  !grantedScopes.includes(item.permission)
                ) {
                  grantedScopes.push(item.permission);
                }
              }
            }
            grantsVerified =
              grantedScopes.includes('threads_basic') &&
              grantedScopes.includes('threads_content_publish');
          }
        }
      } catch {
        // If inspection fails, do not fabricate permissions
      }
    }

    if (!isRecoverablePartial && profileVerified && grantsVerified) {
      stage = 'completed';
    } else {
      isRecoverablePartial = true;
    }

    const capabilities: Record<string, boolean> = {
      canPublishText:
        stage === 'completed' &&
        grantedScopes.includes('threads_basic') &&
        grantedScopes.includes('threads_content_publish'),
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
      throw classifyThreadsError(res.status, res.body, false, res.headers);
    }

    const data = JSON.parse(res.body);
    if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
      throw new SocialAuthExchangeError('Provider omitted access_token during refresh');
    }

    return {
      accessToken: String(data.access_token),
      tokenExpiresInSeconds:
        typeof data.expires_in === 'number' &&
        Number.isSafeInteger(data.expires_in) &&
        data.expires_in > 0 &&
        data.expires_in <= 31536000
          ? data.expires_in
          : 5184000,
      tokenKind: 'long_lived',
    };
  }

  public async inspectCurrentAccount(input: InspectAccountInput): Promise<InspectAccountResult> {
    // 1. Profile inspection
    const profileUrl = `${this.apiBaseUrl}/${this.apiVersion}/me?fields=id,username,name&access_token=${encodeURIComponent(input.accessToken)}`;
    const profileRes = await this.transport.fetch({
      method: 'GET',
      url: profileUrl,
      headers: { Accept: 'application/json' },
      timeoutMs: this.timeoutMs,
    });

    if (profileRes.status !== 200) {
      throw classifyThreadsError(profileRes.status, profileRes.body, false, profileRes.headers);
    }

    const profileData = JSON.parse(profileRes.body);
    const rawId = String(profileData.id ?? '').trim();
    if (!rawId || rawId.length > 128 || hasControlCharacters(rawId)) {
      throw new SocialAuthExchangeError('Invalid provider profile user ID');
    }

    const validName =
      typeof profileData.name === 'string' && profileData.name.trim().length > 0
        ? profileData.name.trim().slice(0, 128)
        : null;
    const validUsername =
      typeof profileData.username === 'string' && profileData.username.trim().length > 0
        ? profileData.username.trim().slice(0, 64)
        : null;
    const displayName = validName ?? validUsername ?? rawId;
    const handle = validUsername ? `@${validUsername}` : null;

    // 2. Permissions inspection
    const permUrl = `${this.apiBaseUrl}/${this.apiVersion}/me/permissions?access_token=${encodeURIComponent(input.accessToken)}`;
    const permRes = await this.transport.fetch({
      method: 'GET',
      url: permUrl,
      headers: { Accept: 'application/json' },
      timeoutMs: this.timeoutMs,
    });

    if (permRes.status !== 200) {
      throw classifyThreadsError(permRes.status, permRes.body, false, permRes.headers);
    }

    const permData = JSON.parse(permRes.body);
    const grantedScopes: string[] = [];
    if (Array.isArray(permData.data)) {
      const items = permData.data.slice(0, 50);
      for (const item of items) {
        if (
          item &&
          item.status === 'granted' &&
          typeof item.permission === 'string' &&
          item.permission.length <= 64 &&
          !hasControlCharacters(item.permission)
        ) {
          if (
            REQUIRED_SCOPES.includes(item.permission as (typeof REQUIRED_SCOPES)[number]) &&
            !grantedScopes.includes(item.permission)
          ) {
            grantedScopes.push(item.permission);
          }
        }
      }
    }

    const capabilities = {
      canPublishText:
        grantedScopes.includes('threads_basic') &&
        grantedScopes.includes('threads_content_publish'),
      canPublishMedia: false,
    };

    return {
      providerAccountId: rawId,
      displayName,
      handle,
      grantedScopes: Object.freeze(grantedScopes),
      capabilities: Object.freeze(capabilities),
    };
  }

  public async revokeToken(_accessToken?: string): Promise<RevokeTokenResult> {
    // Official Threads API does not provide a client token revocation endpoint
    return { supported: false, revoked: false };
  }
}
