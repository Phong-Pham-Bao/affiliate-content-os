import { describe, expect, it, vi } from 'vitest';
import * as client from 'openid-client';
import {
  classifyGrantError,
  classifyClientError,
  classifyResponseBodyError,
  mapDiagnosticOutcome,
  defaultDiagnosticLogger,
  type SafeDiagnosticEntry,
} from '../../src/auth/oidc-grant-diagnostic.js';
import { OidcProtocolAdapter } from '../../src/auth/oidc-adapter.js';

describe('packages/infrastructure - OIDC Grant Diagnostic & Sanitization', () => {
  const SECRET_SENTINELS = [
    'top_secret_client_secret_xyz',
    'secret_pkce_verifier_abc123',
    'secret_nonce_999888',
    'hostile_bearer_token_leak_456',
    'secret_user_id_token_claims_payload',
    'http://internal-leak.example/secret',
    'hostile stack trace line at /secrets/keys.pem:42',
  ] as const;

  function makeClientError(message: string, code: string, cause?: unknown): client.ClientError {
    const err = new client.ClientError(message, cause !== undefined ? { cause } : undefined);
    err.code = code;
    return err;
  }

  describe('classifyResponseBodyError', () => {
    it('classifies invalid_grant as oauth_invalid_grant with allowlisted error and status', () => {
      const err = new client.ResponseBodyError('server error response', {
        cause: { error: 'invalid_grant' },
        response: new Response(null, { status: 400 }),
      });

      const entry = classifyResponseBodyError(err);
      expect(entry).toEqual({
        category: 'oauth_invalid_grant',
        status: 400,
        error: 'invalid_grant',
      });
      expect(mapDiagnosticOutcome(entry.category)).toBe('invalid');
    });

    it('classifies invalid_client as oauth_invalid_client with allowlisted error and status', () => {
      const err = new client.ResponseBodyError('server error response', {
        cause: { error: 'invalid_client' },
        response: new Response(null, { status: 401 }),
      });

      const entry = classifyResponseBodyError(err);
      expect(entry).toEqual({
        category: 'oauth_invalid_client',
        status: 401,
        error: 'invalid_client',
      });
      expect(mapDiagnosticOutcome(entry.category)).toBe('configuration_unavailable');
    });

    it('classifies temporarily_unavailable and 500+ status as oauth_temporarily_unavailable', () => {
      const err503 = new client.ResponseBodyError('server error response', {
        cause: { error: 'temporarily_unavailable' },
        response: new Response(null, { status: 503 }),
      });

      const entry503 = classifyResponseBodyError(err503);
      expect(entry503).toEqual({
        category: 'oauth_temporarily_unavailable',
        status: 503,
        error: 'temporarily_unavailable',
      });
      expect(mapDiagnosticOutcome(entry503.category)).toBe('unavailable');

      const err500 = new client.ResponseBodyError('internal server error', {
        cause: { error: 'server_error' },
        response: new Response(null, { status: 500 }),
      });

      const entry500 = classifyResponseBodyError(err500);
      expect(entry500.category).toBe('oauth_temporarily_unavailable');
      expect(mapDiagnosticOutcome(entry500.category)).toBe('unavailable');
    });

    it('strictly prevents hostile provider error fields, secrets, response bodies, headers, and stacks from leaking', () => {
      const hostileErr = new client.ResponseBodyError(`Error with secret: ${SECRET_SENTINELS[0]}`, {
        cause: {
          error: SECRET_SENTINELS[3],
          error_description: `Detailed hostile secret: ${SECRET_SENTINELS[1]}`,
          verifier: SECRET_SENTINELS[1],
          nonce: SECRET_SENTINELS[2],
          client_secret: SECRET_SENTINELS[0],
          token: SECRET_SENTINELS[3],
          claims: { sub: SECRET_SENTINELS[4] },
        },
        response: new Response(JSON.stringify({ leak: SECRET_SENTINELS[0] }), {
          status: 400,
          headers: { authorization: `Bearer ${SECRET_SENTINELS[3]}` },
        }),
      });
      (hostileErr as unknown as { stack: string }).stack = SECRET_SENTINELS[6];

      const entry = classifyResponseBodyError(hostileErr);

      // Category should safely fall back to unknown_safe because error string is not in allowlist
      expect(entry.category).toBe('unknown_safe');
      expect(entry.status).toBe(400);
      // Non-allowlisted hostile error string MUST NOT be logged
      expect(entry.error).toBeUndefined();

      // Check serialized entry and logger output
      const serialized = JSON.stringify(entry);
      for (const sentinel of SECRET_SENTINELS) {
        expect(serialized).not.toContain(sentinel);
      }

      // Verify defaultDiagnosticLogger output contains no secrets
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        defaultDiagnosticLogger(entry);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const logged = warnSpy.mock.calls[0]![0];
        for (const sentinel of SECRET_SENTINELS) {
          expect(logged).not.toContain(sentinel);
        }
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('classifyClientError', () => {
    it('maps closed known client error codes correctly', () => {
      const timeoutErr = makeClientError('operation timed out', 'OAUTH_TIMEOUT');
      expect(classifyClientError(timeoutErr)).toEqual({ category: 'timeout' });

      const abortErr = makeClientError('operation aborted', 'OAUTH_ABORT');
      expect(classifyClientError(abortErr)).toEqual({ category: 'timeout' });

      const timestampErr = makeClientError('timestamp failed', 'OAUTH_JWT_TIMESTAMP_CHECK_FAILED');
      expect(classifyClientError(timestampErr)).toEqual({ category: 'protocol_timestamp_invalid' });

      const issClaimErr = makeClientError('issuer mismatch', 'OAUTH_JWT_CLAIM_COMPARISON_FAILED', {
        cause: { claim: 'iss' },
      });
      expect(classifyClientError(issClaimErr)).toEqual({ category: 'protocol_issuer_invalid' });

      const nonceClaimErr = makeClientError('nonce mismatch', 'OAUTH_JWT_CLAIM_COMPARISON_FAILED', {
        cause: { claim: 'nonce' },
      });
      expect(classifyClientError(nonceClaimErr)).toEqual({ category: 'protocol_nonce_invalid' });

      const audClaimErr = makeClientError(
        'audience mismatch',
        'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
        { cause: { claim: 'aud' } },
      );
      expect(classifyClientError(audClaimErr)).toEqual({
        category: 'protocol_token_claim_invalid',
      });

      const conformErr = makeClientError('non-conform response', 'OAUTH_RESPONSE_IS_NOT_CONFORM');
      expect(classifyClientError(conformErr)).toEqual({
        category: 'oauth_temporarily_unavailable',
      });
    });

    it('strictly prevents secrets in message or cause from leaking in ClientError', () => {
      const hostileClientErr = makeClientError(
        `Unexpected claim value containing secret: ${SECRET_SENTINELS[4]}`,
        'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
        {
          claim: 'aud',
          claims: { id_token: SECRET_SENTINELS[3], sub: SECRET_SENTINELS[4] },
          expected: SECRET_SENTINELS[0],
        },
      );

      const entry = classifyClientError(hostileClientErr);
      expect(entry).toEqual({ category: 'protocol_token_claim_invalid' });

      const serialized = JSON.stringify(entry);
      for (const sentinel of SECRET_SENTINELS) {
        expect(serialized).not.toContain(sentinel);
      }
    });
  });

  describe('classifyGrantError & generic errors', () => {
    it('classifies TypeError as network_failure', () => {
      const err = new TypeError('fetch failed');
      const entry = classifyGrantError(err);
      expect(entry).toEqual({ category: 'network_failure' });
      expect(mapDiagnosticOutcome(entry.category)).toBe('unavailable');
    });

    it('classifies AbortError/TimeoutError as timeout', () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      expect(classifyGrantError(abortErr)).toEqual({ category: 'timeout' });

      const timeoutErr = new Error('Request timed out');
      timeoutErr.name = 'TimeoutError';
      expect(classifyGrantError(timeoutErr)).toEqual({ category: 'timeout' });
    });

    it('classifies unknown errors as unknown_safe', () => {
      expect(classifyGrantError('string error')).toEqual({ category: 'unknown_safe' });
      expect(classifyGrantError({ random: 'object' })).toEqual({ category: 'unknown_safe' });
      expect(classifyGrantError(null)).toEqual({ category: 'unknown_safe' });
      expect(mapDiagnosticOutcome('unknown_safe')).toBe('unavailable');
    });
  });

  describe('OidcProtocolAdapter end-to-end secret-safe logging', () => {
    const mockConfig = {} as client.Configuration;
    const adapterConfig = {
      issuer: 'https://accounts.google.com',
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
      redirectUri: 'http://localhost:3001/auth/callback',
    };

    it('logs allowlisted category and prevents hostile provider fields from leaking during grant failure', async () => {
      const loggedEntries: SafeDiagnosticEntry[] = [];
      const mockLogger = (entry: SafeDiagnosticEntry) => {
        loggedEntries.push(entry);
      };

      const hostileGrantFn = vi.fn(async () => {
        const err = new client.ResponseBodyError('OAuth failure', {
          cause: {
            error: 'invalid_grant',
            error_description: `Token expired with code verifier ${SECRET_SENTINELS[1]}`,
            headers: { secret: SECRET_SENTINELS[0] },
          },
          response: new Response(null, { status: 400 }),
        });
        throw err;
      });

      const adapter = new OidcProtocolAdapter(mockConfig, adapterConfig, {
        grantFn: hostileGrantFn as unknown as typeof client.authorizationCodeGrant,
        diagnosticLogger: mockLogger,
      });

      const result = await adapter.exchangeCodeAndValidateIdToken({
        code: 'test-code',
        pkceVerifier: 'test-verifier',
        nonce: 'test-nonce',
      });

      expect(result).toEqual({ status: 'invalid' });
      expect(loggedEntries).toHaveLength(1);
      expect(loggedEntries[0]).toEqual({
        category: 'oauth_invalid_grant',
        status: 400,
        error: 'invalid_grant',
      });

      const serializedLog = JSON.stringify(loggedEntries);
      for (const sentinel of SECRET_SENTINELS) {
        expect(serializedLog).not.toContain(sentinel);
      }
    });

    it('logs protocol_issuer_invalid and returns status invalid when token claim iss does not match configured issuer', async () => {
      const loggedEntries: SafeDiagnosticEntry[] = [];
      const mockGrantFn = vi.fn(async () => ({
        claims: () => ({
          iss: 'https://wrong-issuer.example',
          sub: 'user-123',
        }),
      }));

      const adapter = new OidcProtocolAdapter(mockConfig, adapterConfig, {
        grantFn: mockGrantFn as unknown as typeof client.authorizationCodeGrant,
        diagnosticLogger: (entry) => loggedEntries.push(entry),
      });

      const result = await adapter.exchangeCodeAndValidateIdToken({
        code: 'test-code',
        pkceVerifier: 'test-verifier',
        nonce: 'test-nonce',
      });

      expect(result).toEqual({ status: 'invalid' });
      expect(loggedEntries).toEqual([{ category: 'protocol_issuer_invalid' }]);
    });

    it('accepts accounts.google.com as equivalent to https://accounts.google.com and canonicalizes issuer', async () => {
      const googleAdapterConfig = {
        issuer: 'https://accounts.google.com',
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
        redirectUri: 'http://localhost:3001/auth/callback',
      };

      const mockGrantFn = vi.fn(async () => ({
        claims: () => ({
          iss: 'accounts.google.com',
          sub: 'google-user-123',
          email: 'user@example.com',
          email_verified: true,
          name: 'Google User',
        }),
      }));

      const adapter = new OidcProtocolAdapter(mockConfig, googleAdapterConfig, {
        grantFn: mockGrantFn as unknown as typeof client.authorizationCodeGrant,
      });

      const result = await adapter.exchangeCodeAndValidateIdToken({
        code: 'google-auth-code',
        pkceVerifier: 'google-pkce-verifier',
        nonce: 'google-nonce',
      });

      expect(result.status).toBe('verified');
      if (result.status === 'verified') {
        expect(result.claims.issuer).toBe('https://accounts.google.com');
        expect(result.claims.subject).toBe('google-user-123');
        expect(result.claims.email).toBe('user@example.com');
        expect(result.claims.displayName).toBe('Google User');
      }
    });
  });
});
