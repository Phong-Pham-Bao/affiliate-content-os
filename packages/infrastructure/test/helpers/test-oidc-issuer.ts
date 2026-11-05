import crypto from 'node:crypto';
import http from 'node:http';
import * as jose from 'jose';

export interface IssuedCodeRecord {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly nonce: string;
  used: boolean;
}

export interface TestOidcIssuer {
  readonly issuerUrl: string;
  readonly close: () => Promise<void>;
  setTokenClaims(claims: Partial<jose.JWTPayload>): void;
  setFailNextTokenRequest(fail: boolean): void;
  setIssParameterSupported(supported: boolean): void;
  issueCode(params: {
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly nonce: string;
  }): string;
  readonly counts: {
    discovery: number;
    jwks: number;
    token: number;
    authorize: number;
  };
}

export async function createTestOidcIssuer(
  clientId: string,
  clientSecret: string,
): Promise<TestOidcIssuer> {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = 'test-key-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const counts = { discovery: 0, jwks: 0, token: 0, authorize: 0 };
  let customClaims: Partial<jose.JWTPayload> = {};
  let failNextToken = false;
  let issParameterSupported = false;
  const issuedCodes = new Map<string, IssuedCodeRecord>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      counts.discovery++;
      const origin = `http://${req.headers.host}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          jwks_uri: `${origin}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          ...(issParameterSupported
            ? { authorization_response_iss_parameter_supported: true }
            : {}),
        }),
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/jwks') {
      counts.jwks++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/authorize') {
      counts.authorize++;
      const reqClientId = url.searchParams.get('client_id');
      const redirectUri = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      const codeChallenge = url.searchParams.get('code_challenge');
      const nonce = url.searchParams.get('nonce') ?? 'default-nonce';

      if (!reqClientId || reqClientId !== clientId || !redirectUri || !state || !codeChallenge) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request' }));
        return;
      }

      const code = 'auth-code-' + crypto.randomBytes(16).toString('hex');
      issuedCodes.set(code, {
        clientId,
        redirectUri,
        codeChallenge,
        nonce,
        used: false,
      });

      const redirectTarget = new URL(redirectUri);
      redirectTarget.searchParams.set('code', code);
      redirectTarget.searchParams.set('state', state);

      res.writeHead(302, { Location: redirectTarget.toString() });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      counts.token++;
      if (failNextToken) {
        failNextToken = false;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error' }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(bodyStr);

      // 1. Strict confidential-client authentication check.
      const authHeader = req.headers['authorization'];
      let authenticated: boolean;
      if (authHeader?.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const [rawId, rawSecret] = decoded.split(':');
        const parsedId = decodeURIComponent((rawId ?? '').replace(/\+/g, ' '));
        const parsedSecret = decodeURIComponent((rawSecret ?? '').replace(/\+/g, ' '));
        authenticated = parsedId === clientId && parsedSecret === clientSecret;
      } else {
        authenticated =
          params.get('client_id') === clientId && params.get('client_secret') === clientSecret;
      }

      if (!authenticated) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_client' }));
        return;
      }

      // 2. Validate grant_type
      const grantType = params.get('grant_type');
      if (grantType !== 'authorization_code') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
        return;
      }

      // 3. Validate code and replay
      const code = params.get('code');
      if (!code || !issuedCodes.has(code)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      const codeRecord = issuedCodes.get(code)!;
      if (codeRecord.used) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }

      // 4. Validate redirect_uri matches
      const reqRedirectUri = params.get('redirect_uri');
      if (!reqRedirectUri || reqRedirectUri !== codeRecord.redirectUri) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }

      // 5. Validate code_verifier (PKCE S256)
      const codeVerifier = params.get('code_verifier');
      if (!codeVerifier) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      const computedChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
      if (computedChallenge !== codeRecord.codeChallenge) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }

      // Mark code as used (prevents replay)
      codeRecord.used = true;

      const origin = `http://${req.headers.host}`;
      const nonce = codeRecord.nonce;

      const payload: jose.JWTPayload = {
        sub: 'test-subject-001',
        email: 'user@example.com',
        email_verified: true,
        name: 'Test OIDC User',
        nonce,
        ...customClaims,
      };

      const jwt = await new jose.SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
        .setIssuer(origin)
        .setAudience(clientId)
        .setExpirationTime('1h')
        .setIssuedAt()
        .sign(privateKey);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: jwt,
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as { port: number };
  const issuerUrl = `http://127.0.0.1:${addr.port}`;

  return {
    issuerUrl,
    counts,
    setTokenClaims(claims: Partial<jose.JWTPayload>): void {
      customClaims = claims;
    },
    setFailNextTokenRequest(fail: boolean): void {
      failNextToken = fail;
    },
    setIssParameterSupported(supported: boolean): void {
      issParameterSupported = supported;
    },
    issueCode(params: {
      readonly redirectUri: string;
      readonly codeChallenge: string;
      readonly nonce: string;
    }): string {
      const code = 'seeded-code-' + crypto.randomBytes(16).toString('hex');
      issuedCodes.set(code, {
        clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        nonce: params.nonce,
        used: false,
      });
      return code;
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
