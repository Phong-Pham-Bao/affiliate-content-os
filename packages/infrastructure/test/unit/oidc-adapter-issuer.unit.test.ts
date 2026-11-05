import crypto from 'node:crypto';
import * as client from 'openid-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { discoverOidcAdapter } from '../../src/auth/oidc-adapter-discovery.js';
import { createTestOidcIssuer, type TestOidcIssuer } from '../helpers/test-oidc-issuer.js';

describe('packages/infrastructure - OIDC Protocol Adapter Issuer Validation (RFC 9207)', () => {
  let issuer: TestOidcIssuer;
  const clientId = 'test-client-id';
  const clientSecret = 'test-client-secret';
  const redirectUri = 'http://localhost:3001/auth/callback';
  const verifier = 'test-verifier-string-43-chars-long-12345678901';
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  beforeAll(async () => {
    issuer = await createTestOidcIssuer(clientId, clientSecret);
  });

  afterAll(async () => {
    if (issuer) {
      await issuer.close();
    }
  });

  it('exchanges code successfully when provider requires iss and exact matching iss is provided', async () => {
    issuer.setIssParameterSupported(true);
    const code = issuer.issueCode({
      redirectUri,
      codeChallenge: challenge,
      nonce: 'test-nonce-exact',
    });

    const adapter = await discoverOidcAdapter({
      issuer: issuer.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    const result = await adapter.exchangeCodeAndValidateIdToken({
      code,
      pkceVerifier: verifier,
      nonce: 'test-nonce-exact',
      iss: issuer.issuerUrl,
    });

    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.claims.issuer).toBe(issuer.issuerUrl);
      expect(result.claims.subject).toBe('test-subject-001');
    }
    issuer.setIssParameterSupported(false);
  });

  it('returns status: invalid when provider requires iss but iss is missing from callback', async () => {
    issuer.setIssParameterSupported(true);
    const code = issuer.issueCode({
      redirectUri,
      codeChallenge: challenge,
      nonce: 'test-nonce-missing',
    });

    const adapter = await discoverOidcAdapter({
      issuer: issuer.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    const result = await adapter.exchangeCodeAndValidateIdToken({
      code,
      pkceVerifier: verifier,
      nonce: 'test-nonce-missing',
    });

    expect(result).toEqual({ status: 'invalid' });
    issuer.setIssParameterSupported(false);
  });

  it('returns status: invalid when provider requires iss but mismatched iss is provided', async () => {
    issuer.setIssParameterSupported(true);
    const code = issuer.issueCode({
      redirectUri,
      codeChallenge: challenge,
      nonce: 'test-nonce-mismatched',
    });

    const adapter = await discoverOidcAdapter({
      issuer: issuer.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    const result = await adapter.exchangeCodeAndValidateIdToken({
      code,
      pkceVerifier: verifier,
      nonce: 'test-nonce-mismatched',
      iss: 'https://attacker-issuer.example.com',
    });

    expect(result).toEqual({ status: 'invalid' });
    issuer.setIssParameterSupported(false);
  });

  it('proves the exact callback issuer reaches openid-client authorizationCodeGrant validation', async () => {
    issuer.setIssParameterSupported(true);
    const code = issuer.issueCode({
      redirectUri,
      codeChallenge: challenge,
      nonce: 'test-nonce-spy',
    });

    const grantSpy = vi.fn(client.authorizationCodeGrant);

    const adapter = await discoverOidcAdapter(
      {
        issuer: issuer.issuerUrl,
        clientId,
        clientSecret,
        redirectUri,
        allowInsecureRequests: true,
      },
      { grantFn: grantSpy as unknown as typeof client.authorizationCodeGrant },
    );

    const exactReceivedIss = 'https://exact-received-issuer.example.com';

    const result = await adapter.exchangeCodeAndValidateIdToken({
      code,
      pkceVerifier: verifier,
      nonce: 'test-nonce-spy',
      iss: exactReceivedIss,
    });

    expect(grantSpy).toHaveBeenCalledTimes(1);
    const calledUrl = grantSpy.mock.calls[0]?.[1];
    expect(calledUrl).toBeInstanceOf(URL);
    expect((calledUrl as URL).searchParams.get('iss')).toBe(exactReceivedIss);
    expect(result).toEqual({ status: 'invalid' });
    issuer.setIssParameterSupported(false);
  });

  it('classifies actual network failure to token endpoint as status: unavailable', async () => {
    const networkFailGrant = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const adapter = await discoverOidcAdapter(
      {
        issuer: issuer.issuerUrl,
        clientId,
        clientSecret,
        redirectUri,
        allowInsecureRequests: true,
      },
      { grantFn: networkFailGrant as unknown as typeof client.authorizationCodeGrant },
    );

    const result = await adapter.exchangeCodeAndValidateIdToken({
      code: 'any-code',
      pkceVerifier: verifier,
      nonce: 'any-nonce',
      iss: issuer.issuerUrl,
    });

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('classifies protocol validation failure as status: invalid', async () => {
    const invalidResponseError = new client.ClientError('invalid response encountered');
    invalidResponseError.code = 'OAUTH_INVALID_RESPONSE';
    const protocolFailGrant = vi.fn().mockRejectedValue(invalidResponseError);

    const adapter = await discoverOidcAdapter(
      {
        issuer: issuer.issuerUrl,
        clientId,
        clientSecret,
        redirectUri,
        allowInsecureRequests: true,
      },
      { grantFn: protocolFailGrant as unknown as typeof client.authorizationCodeGrant },
    );

    const result = await adapter.exchangeCodeAndValidateIdToken({
      code: 'any-code',
      pkceVerifier: verifier,
      nonce: 'any-nonce',
      iss: issuer.issuerUrl,
    });

    expect(result).toEqual({ status: 'invalid' });
  });
});
