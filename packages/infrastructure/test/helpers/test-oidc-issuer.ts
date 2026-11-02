import http from 'node:http';
import * as jose from 'jose';

export interface TestOidcIssuer {
  readonly issuerUrl: string;
  readonly close: () => Promise<void>;
  setTokenClaims(claims: Partial<jose.JWTPayload>): void;
  setFailNextTokenRequest(fail: boolean): void;
  readonly counts: {
    discovery: number;
    jwks: number;
    token: number;
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

  const counts = { discovery: 0, jwks: 0, token: 0 };
  let customClaims: Partial<jose.JWTPayload> = {};
  let failNextToken = false;

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

    if (req.method === 'POST' && url.pathname === '/token') {
      counts.token++;
      if (failNextToken) {
        failNextToken = false;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error' }));
        return;
      }

      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const [rawId, rawSecret] = decoded.split(':');
        const parsedId = decodeURIComponent((rawId ?? '').replace(/\+/g, ' '));
        const parsedSecret = decodeURIComponent((rawSecret ?? '').replace(/\+/g, ' '));
        if (parsedId !== clientId || parsedSecret !== clientSecret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_client' }));
          return;
        }
      }

      // Read body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(bodyStr);

      const origin = `http://${req.headers.host}`;
      const nonce = params.get('nonce') ?? 'test-nonce';

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
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
