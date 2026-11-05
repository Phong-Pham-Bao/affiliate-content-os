import * as client from 'openid-client';
import { OidcProviderUnavailableError } from '@affiliate-content-os/application';
import {
  OidcProtocolAdapter,
  type OidcAdapterConfig,
  type OidcAdapterOptions,
} from './oidc-adapter.js';

export async function discoverOidcAdapter(
  adapterConfig: OidcAdapterConfig,
  options?: ({ signal?: AbortSignal | undefined } & OidcAdapterOptions) | undefined,
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
      client.ClientSecretPost(adapterConfig.clientSecret),
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

  const serverIssuer = configuration.serverMetadata().issuer;
  if (serverIssuer !== adapterConfig.issuer) {
    throw new OidcProviderUnavailableError();
  }

  const metadata = configuration.serverMetadata();
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) {
    throw new OidcProviderUnavailableError();
  }

  return new OidcProtocolAdapter(configuration, adapterConfig, {
    grantFn: options?.grantFn,
    diagnosticLogger: options?.diagnosticLogger,
  });
}
