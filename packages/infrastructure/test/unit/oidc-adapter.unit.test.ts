import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OidcProviderUnavailableError } from '@affiliate-content-os/application';
import { discoverOidcAdapter } from '../../src/auth/oidc-adapter.js';
import { createTestOidcIssuer, type TestOidcIssuer } from '../helpers/test-oidc-issuer.js';

describe('packages/infrastructure - OIDC Protocol Adapter', () => {
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

  it('performs discovery against loopback issuer with allowInsecureRequests', async () => {
    const adapter = await discoverOidcAdapter({
      issuer: issuer.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    expect(adapter).toBeDefined();
    expect(issuer.counts.discovery).toBeGreaterThanOrEqual(1);
  });

  it('builds authorization URL with exact scopes, state, nonce, and PKCE challenge', async () => {
    const adapter = await discoverOidcAdapter({
      issuer: issuer.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    const url = adapter.buildAuthorizationUrl({
      state: 'state-123',
      nonce: 'nonce-456',
      codeChallenge: 'challenge-789',
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe(new URL(issuer.issuerUrl).origin);
    expect(parsed.pathname).toBe('/authorize');
    expect(parsed.searchParams.get('client_id')).toBe(clientId);
    expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(parsed.searchParams.get('scope')).toBe('openid profile email');
    expect(parsed.searchParams.get('state')).toBe('state-123');
    expect(parsed.searchParams.get('nonce')).toBe('nonce-456');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-789');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('exchanges code, validates ID token, and extracts verified claims', async () => {
    const code = issuer.issueCode({
      redirectUri,
      codeChallenge: challenge,
      nonce: 'test-nonce',
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
      nonce: 'test-nonce',
    });

    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.claims.issuer).toBe(issuer.issuerUrl);
      expect(result.claims.subject).toBe('test-subject-001');
      expect(result.claims.email).toBe('user@example.com');
      expect(result.claims.displayName).toBe('Test OIDC User');
    }
  });

  it('passes null email when email_verified is false', async () => {
    issuer.setTokenClaims({ email: 'unverified@example.com', email_verified: false });
    const code = issuer.issueCode({
      redirectUri,
      codeChallenge: challenge,
      nonce: 'test-nonce',
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
      nonce: 'test-nonce',
    });

    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.claims.email).toBeNull();
      expect(result.claims.subject).toBe('test-subject-001');
    }

    // Reset claims
    issuer.setTokenClaims({});
  });

  it('rejects sub with surrounding whitespace', async () => {
    issuer.setTokenClaims({ sub: ' padded-sub ' });
    const code = issuer.issueCode({
      redirectUri,
      codeChallenge: challenge,
      nonce: 'test-nonce',
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
      nonce: 'test-nonce',
    });

    expect(result).toEqual({ status: 'invalid' });

    // Reset claims
    issuer.setTokenClaims({});
  });

  it('translates upstream token endpoint 500 error to status: unavailable', async () => {
    issuer.setFailNextTokenRequest(true);

    const adapter = await discoverOidcAdapter({
      issuer: issuer.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    const result = await adapter.exchangeCodeAndValidateIdToken({
      code: 'any-code',
      pkceVerifier: 'any-verifier',
      nonce: 'any-nonce',
    });

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('fails discovery with OidcProviderUnavailableError when issuer is unreachable', async () => {
    await expect(
      discoverOidcAdapter({
        issuer: 'http://127.0.0.1:59999',
        clientId,
        clientSecret,
        redirectUri,
        allowInsecureRequests: true,
      }),
    ).rejects.toThrow(OidcProviderUnavailableError);
  });
});
