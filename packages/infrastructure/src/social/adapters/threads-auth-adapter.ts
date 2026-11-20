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
  readonly metaGraphBaseUrl?: string | undefined;
  readonly metaGraphVersion?: string | undefined;
  readonly appAccessToken?: string | undefined;
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
  private readonly metaGraphBaseUrl: string;
  private readonly metaGraphVersion: string;
  private cachedAppAccessToken: string | null;
  private readonly timeoutMs: number;
  private readonly environment: SocialAccountEnvironment;
  private readonly transport: HttpTransport;

  constructor(options: ThreadsSocialAuthAdapterOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.authBaseUrl = options.authBaseUrl ?? 'https://www.threads.com';
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://graph.threads.com';
    this.apiVersion = options.apiVersion ?? 'v1.0';
    this.metaGraphBaseUrl = options.metaGraphBaseUrl ?? 'https://graph.facebook.com';
    this.metaGraphVersion = options.metaGraphVersion ?? 'v21.0';
    this.cachedAppAccessToken = options.appAccessToken ?? null;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.environment = options.environment ?? 'production';
    this.transport = options.transport ?? new DefaultHttpTransport(this.timeoutMs);
  }

  private async getAppAccessToken(): Promise<string> {
    if (this.cachedAppAccessToken) {
      return this.cachedAppAccessToken;
    }
    const tokenUrl = `${this.metaGraphBaseUrl}/oauth/access_token?client_id=${encodeURIComponent(this.appId)}&client_secret=${encodeURIComponent(this.appSecret)}&grant_type=client_credentials`;
    let res;
    try {
      res = await this.transport.fetch({
        method: 'GET',
        url: tokenUrl,
        headers: { Accept: 'application/json' },
        timeoutMs: this.timeoutMs,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('timed out')) {
        throw new SocialAuthOutcomeUnknownError();
      }
      throw new SocialAuthExchangeError('Network error while requesting app access token');
    }

    if (res.status !== 200) {
      throw classifyThreadsError(res.status, res.body, false, res.headers);
    }

    let data: { access_token?: unknown };
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new SocialAuthExchangeError('Invalid JSON from app access token endpoint');
    }

    if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
      throw new SocialAuthExchangeError(
        'Provider omitted access_token during client_credentials flow',
      );
    }
    this.cachedAppAccessToken = String(data.access_token);
    return this.cachedAppAccessToken;
  }

  private async inspectTokenWithMetaDebug(
    userToken: string,
    expectedUserId: string,
  ): Promise<{ readonly grantedScopes: readonly string[]; readonly isValid: boolean }> {
    const appToken = await this.getAppAccessToken();
    const debugUrl = `${this.metaGraphBaseUrl}/${this.metaGraphVersion}/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(appToken)}`;
    let res;
    try {
      res = await this.transport.fetch({
        method: 'GET',
        url: debugUrl,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${appToken}`,
        },
        timeoutMs: this.timeoutMs,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('timed out')) {
        throw new SocialAuthOutcomeUnknownError();
      }
      throw new SocialAuthExchangeError('Network error during debug_token inspection');
    }

    if (res.status !== 200) {
      throw classifyThreadsError(res.status, res.body, false, res.headers);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new SocialAuthExchangeError('Invalid JSON from Meta debug_token endpoint');
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('data' in parsed) ||
      !parsed.data ||
      typeof parsed.data !== 'object'
    ) {
      throw new SocialAuthExchangeError(
        'Malformed response wrapper from Meta debug_token endpoint',
      );
    }

    const data = parsed.data as Record<string, unknown>;
    if (data.is_valid !== true) {
      return { grantedScopes: [], isValid: false };
    }

    const rawAppId = String(data.app_id ?? '').trim();
    if (!rawAppId || rawAppId !== this.appId) {
      throw new SocialAuthExchangeError('Meta debug_token app_id does not match configured app_id');
    }

    const rawUserId = String(data.user_id ?? '').trim();
    if (!rawUserId || rawUserId !== expectedUserId) {
      throw new SocialAuthExchangeError(
        'Meta debug_token user_id does not match provider account ID',
      );
    }

    if (
      data.expires_at !== undefined &&
      data.expires_at !== null &&
      (typeof data.expires_at !== 'number' ||
        !Number.isSafeInteger(data.expires_at) ||
        data.expires_at <= 0)
    ) {
      throw new SocialAuthExchangeError('Invalid expiry bounds in Meta debug_token response');
    }

    const grantedScopes: string[] = [];
    if (Array.isArray(data.scopes)) {
      const items = data.scopes.slice(0, 50);
      for (const scope of items) {
        if (typeof scope === 'string' && scope.length <= 64 && !hasControlCharacters(scope)) {
          if (
            REQUIRED_SCOPES.includes(scope as (typeof REQUIRED_SCOPES)[number]) &&
            !grantedScopes.includes(scope)
          ) {
            grantedScopes.push(scope);
          }
        }
      }
    }

    return { grantedScopes: Object.freeze(grantedScopes), isValid: true };
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

    // 4. Granted scopes determination via official Meta debug_token contract
    const grantedScopes: string[] = [];
    let grantsVerified = false;

    if (!isRecoverablePartial && profileVerified) {
      try {
        const debugResult = await this.inspectTokenWithMetaDebug(longLivedToken, providerAccountId);
        if (debugResult.isValid) {
          for (const s of debugResult.grantedScopes) {
            grantedScopes.push(s);
          }
          grantsVerified =
            grantedScopes.includes('threads_basic') &&
            grantedScopes.includes('threads_content_publish');
        }
      } catch (err: unknown) {
        if (
          err instanceof SocialAuthExchangeError &&
          (err.message.includes('does not match') || err.message.includes('Invalid expiry bounds'))
        ) {
          throw err;
        }
        // If inspection fails or is unavailable, do not fabricate permissions
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

    if (input.expectedProviderAccountId && rawId !== input.expectedProviderAccountId) {
      throw new SocialAuthExchangeError(
        'Provider profile user ID does not match expected account ID',
      );
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

    // 2. Official Meta debug_token inspection
    const debugResult = await this.inspectTokenWithMetaDebug(input.accessToken, rawId);
    if (!debugResult.isValid) {
      throw new SocialAuthExchangeError(
        'Token is not valid according to Meta debug_token endpoint',
      );
    }

    const grantedScopes = [...debugResult.grantedScopes];
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
