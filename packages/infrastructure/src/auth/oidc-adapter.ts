import * as client from 'openid-client';
import {
  OidcProviderUnavailableError,
  type OidcExchangeResult,
  type OidcProtocolPort,
} from '@affiliate-content-os/application';

export interface OidcAdapterConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly allowInsecureRequests?: boolean;
}

export class OidcProtocolAdapter implements OidcProtocolPort {
  constructor(
    private readonly config: client.Configuration,
    private readonly adapterConfig: OidcAdapterConfig,
  ) {}

  public buildAuthorizationUrl(params: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): string {
    const url = client.buildAuthorizationUrl(this.config, {
      redirect_uri: this.adapterConfig.redirectUri,
      scope: 'openid profile email',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    });
    return url.href;
  }

  public async exchangeCodeAndValidateIdToken(params: {
    readonly code: string;
    readonly pkceVerifier: string;
    readonly nonce: string;
  }): Promise<OidcExchangeResult> {
    const callbackUrl = new URL(this.adapterConfig.redirectUri);
    callbackUrl.searchParams.set('code', params.code);

    let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
    try {
      tokens = await client.authorizationCodeGrant(this.config, callbackUrl, {
        pkceCodeVerifier: params.pkceVerifier,
        expectedNonce: params.nonce,
        expectedState: client.skipStateCheck,
      });
    } catch {
      return Object.freeze({ status: 'unavailable' });
    }

    let claims: Record<string, unknown>;
    try {
      const raw = tokens.claims();
      if (!raw || typeof raw !== 'object') {
        return Object.freeze({ status: 'invalid' });
      }
      claims = raw as Record<string, unknown>;
    } catch {
      return Object.freeze({ status: 'invalid' });
    }

    if (claims.iss !== this.adapterConfig.issuer) {
      return Object.freeze({ status: 'invalid' });
    }

    if (
      typeof claims.sub !== 'string' ||
      claims.sub.trim() === '' ||
      claims.sub !== claims.sub.trim()
    ) {
      return Object.freeze({ status: 'invalid' });
    }

    const email =
      typeof claims.email === 'string' && claims.email_verified === true ? claims.email : null;

    const displayName =
      typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name : null;

    return Object.freeze({
      status: 'verified',
      claims: Object.freeze({
        issuer: claims.iss as string,
        subject: claims.sub,
        email,
        displayName,
      }),
    });
  }
}

export async function discoverOidcAdapter(
  adapterConfig: OidcAdapterConfig,
  options?: { signal?: AbortSignal },
): Promise<OidcProtocolAdapter> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new OidcProviderUnavailableError();
  }

  let configuration: client.Configuration;
  try {
    const issuerUrl = new URL(adapterConfig.issuer);
    const execute = adapterConfig.allowInsecureRequests ? [client.allowInsecureRequests] : [];

    const discoveryOptions: client.DiscoveryRequestOptions = {
      execute,
      timeout: 5,
    };

    if (signal) {
      discoveryOptions[client.customFetch] = (url, init) => {
        const reqInit: RequestInit = {
          method: init.method,
          headers: init.headers,
          redirect: init.redirect,
          signal,
        };
        if (init.body !== undefined) {
          reqInit.body = init.body;
        }
        return fetch(url, reqInit);
      };
    }

    const discoveryPromise = client.discovery(
      issuerUrl,
      adapterConfig.clientId,
      adapterConfig.clientSecret,
      client.ClientSecretBasic(),
      discoveryOptions,
    );

    if (signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new OidcProviderUnavailableError()), {
          once: true,
        });
      });
      configuration = await Promise.race([discoveryPromise, abortPromise]);
    } else {
      configuration = await discoveryPromise;
    }
  } catch {
    throw new OidcProviderUnavailableError();
  }

  // Require discovery issuer to match configured issuer exactly
  const serverIssuer = configuration.serverMetadata().issuer;
  if (serverIssuer !== adapterConfig.issuer) {
    throw new OidcProviderUnavailableError();
  }

  // Require authorization, token, and jwks endpoints
  const metadata = configuration.serverMetadata();
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) {
    throw new OidcProviderUnavailableError();
  }

  return new OidcProtocolAdapter(configuration, adapterConfig);
}
