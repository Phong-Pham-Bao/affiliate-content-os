import * as client from 'openid-client';
import type { OidcExchangeResult, OidcProtocolPort } from '@affiliate-content-os/application';
import {
  classifyGrantError,
  defaultDiagnosticLogger,
  mapDiagnosticOutcome,
  type DiagnosticLogger,
} from './oidc-grant-diagnostic.js';

export interface OidcAdapterConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly allowInsecureRequests?: boolean;
}

export interface OidcAdapterOptions {
  readonly grantFn?: typeof client.authorizationCodeGrant | undefined;
  readonly diagnosticLogger?: DiagnosticLogger | undefined;
}

export class OidcProtocolAdapter implements OidcProtocolPort {
  private readonly grantFn: typeof client.authorizationCodeGrant;
  private readonly diagnosticLogger: DiagnosticLogger;

  constructor(
    private readonly config: client.Configuration,
    private readonly adapterConfig: OidcAdapterConfig,
    grantFnOrOptions?: typeof client.authorizationCodeGrant | OidcAdapterOptions,
  ) {
    if (typeof grantFnOrOptions === 'function') {
      this.grantFn = grantFnOrOptions;
      this.diagnosticLogger = defaultDiagnosticLogger;
    } else {
      this.grantFn = grantFnOrOptions?.grantFn ?? client.authorizationCodeGrant;
      this.diagnosticLogger = grantFnOrOptions?.diagnosticLogger ?? defaultDiagnosticLogger;
    }
  }

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
    readonly iss?: string | undefined;
  }): Promise<OidcExchangeResult> {
    const callbackUrl = new URL(this.adapterConfig.redirectUri);
    callbackUrl.searchParams.set('code', params.code);
    if (typeof params.iss === 'string') {
      callbackUrl.searchParams.set('iss', params.iss);
    }

    let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
    try {
      tokens = await this.grantFn(this.config, callbackUrl, {
        pkceCodeVerifier: params.pkceVerifier,
        expectedNonce: params.nonce,
        expectedState: client.skipStateCheck,
      });
    } catch (err: unknown) {
      const entry = classifyGrantError(err);
      this.diagnosticLogger(entry);
      const outcome = mapDiagnosticOutcome(entry.category);
      return Object.freeze({ status: outcome });
    }

    let claims: Record<string, unknown>;
    try {
      const raw = tokens.claims();
      if (!raw || typeof raw !== 'object') {
        this.diagnosticLogger(Object.freeze({ category: 'protocol_token_claim_invalid' }));
        return Object.freeze({ status: 'invalid' });
      }
      claims = raw as Record<string, unknown>;
    } catch {
      this.diagnosticLogger(Object.freeze({ category: 'protocol_token_claim_invalid' }));
      return Object.freeze({ status: 'invalid' });
    }

    const isGoogleIssuer =
      this.adapterConfig.issuer === 'https://accounts.google.com' ||
      this.adapterConfig.issuer === 'accounts.google.com';
    const isIssuerMatch =
      claims.iss === this.adapterConfig.issuer ||
      (isGoogleIssuer &&
        (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'));

    if (!isIssuerMatch) {
      this.diagnosticLogger(Object.freeze({ category: 'protocol_issuer_invalid' }));
      return Object.freeze({ status: 'invalid' });
    }

    if (
      typeof claims.sub !== 'string' ||
      claims.sub.trim() === '' ||
      claims.sub !== claims.sub.trim()
    ) {
      this.diagnosticLogger(Object.freeze({ category: 'protocol_token_claim_invalid' }));
      return Object.freeze({ status: 'invalid' });
    }

    const email =
      typeof claims.email === 'string' && claims.email_verified === true ? claims.email : null;

    const displayName =
      typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name : null;

    return Object.freeze({
      status: 'verified',
      claims: Object.freeze({
        issuer: isGoogleIssuer ? this.adapterConfig.issuer : (claims.iss as string),
        subject: claims.sub,
        email,
        displayName,
      }),
    });
  }
}
