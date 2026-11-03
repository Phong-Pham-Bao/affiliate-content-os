import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runNodeChild(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--conditions=development', '--import', 'tsx', '-e', script],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

describe('Child-process non-disclosure: hostile OIDC rejection and malformed DTO/dates', () => {
  it('proves hostile OIDC rejection sentinel never leaks to child process stdout or stderr', async () => {
    const script = `
      import { completeOidcLogin } from './packages/application/src/auth/complete-oidc-login.ts';
      import { OidcCallbackInvalidError } from './packages/application/src/auth/errors.ts';

      const hostileRejection = new Proxy({}, {
        getPrototypeOf() { throw new Error('SENTINEL_HOSTILE_OIDC_TRAP_ERROR'); }
      });

      const fakes = {
        crypto: {
          generateRandomToken: () => 'token',
          hashToken: () => new Uint8Array(32),
          generateState: () => 'state',
          generateBrowserBinding: () => 'binding',
          generateNonce: () => 'nonce',
          generatePkce: () => ({ verifier: 'v', challenge: 'c' }),
          encryptSecrets: () => ({ ciphertext: new Uint8Array(1), iv: new Uint8Array(12), authTag: new Uint8Array(16), keyVersion: 'v1' }),
          decryptSecrets: () => ({ pkceVerifier: 'v', nonce: 'n' }),
        },
        transactionStore: {
          createPendingTransaction: async () => {},
          consumePendingTransaction: async () => ({
            id: '0192b012-3456-789a-8bcd-ef0123456789',
            keyVersion: 'v1',
            returnTo: '/dashboard',
            encryptedSecrets: {
              ciphertext: new Uint8Array(1),
              iv: new Uint8Array(12),
              authTag: new Uint8Array(16),
              keyVersion: 'v1'
            },
            createdAt: '2026-11-02T12:00:00.000Z',
            expiresAt: '2026-11-02T12:10:00.000Z',
          }),
        },
        sessionStore: {
          createSession: async () => {},
          findCandidateSessions: async () => [],
          findUserById: async () => null,
          rotateSession: async () => {},
          touchSession: async () => {},
          revokeSession: async () => {},
          revokeMatchingSessionsByTokenHash: async () => {},
          withTransaction: async (fn) => fn(),
        },
        oidc: {
          buildAuthorizationUrl: async () => 'https://auth.example.com',
          exchangeCodeAndValidateIdToken: async () => { throw hostileRejection; },
        },
        identityResolution: {
          identityDirectory: { findUsersByIdentity: async () => [], insertUserIfAbsent: async () => {} },
          clock: { now: () => new Date('2026-11-02T12:00:00.000Z') },
          idGenerator: {
            generateUserId: () => '0192b012-3456-789a-8bcd-ef0123456710',
            generateMembershipId: () => '0192b012-3456-789a-8bcd-ef0123456721',
            generateWorkspaceId: () => '0192b012-3456-789a-8bcd-ef0123456722',
          },
        },
      };

      try {
        await completeOidcLogin(
          { query: { code: 'c', state: 's' }, transactionCookie: 'valid-cookie-32-chars-length-12345' },
          { ...fakes, generateId: () => '0192b012-3456-789a-8bcd-ef0123456720', now: () => new Date('2026-11-02T12:00:00.000Z'), sessionIdleTtlSeconds: 1800, sessionAbsoluteTtlSeconds: 28800 }
        );
        process.exit(1);
      } catch (e) {
        if (e instanceof OidcCallbackInvalidError) {
          console.log('SAFE_OIDC_INVALID_CAUGHT');
          process.exit(0);
        }
        process.exit(2);
      }
    `;

    const { stdout, stderr, code } = await runNodeChild(script);
    expect(code).toBe(0);
    expect(stdout).toContain('SAFE_OIDC_INVALID_CAUGHT');
    expect(stdout).not.toContain('SENTINEL_HOSTILE_OIDC_TRAP_ERROR');
    expect(stderr).not.toContain('SENTINEL_HOSTILE_OIDC_TRAP_ERROR');
  }, 15000);

  it('proves malformed DTO and hostile date sentinels never leak to child process stdout or stderr', async () => {
    const script = `
      import { authenticateApplicationSession } from './packages/application/src/auth/authenticate-session.ts';
      import { AuthenticationRequiredError } from './packages/application/src/auth/errors.ts';

      const hostileCandidate = {
        id: '0192b012-3456-789a-8bcd-ef0123456720',
        userId: '0192b012-3456-789a-8bcd-ef0123456710',
        currentTokenHash: new Uint8Array(32).fill(1),
        previousTokenHash: null,
        previousTokenValidUntil: null,
        createdAt: '2026-11-02T11:00:00.000Z',
        lastSeenAt: '2026-11-02T11:58:00.000Z',
        idleExpiresAt: 'MALFORMED_DATE_SENTINEL_VAL_123',
        absoluteExpiresAt: '2026-11-02T19:00:00.000Z',
        rotatedAt: '2026-11-02T11:50:00.000Z',
        revokedAt: null,
        revocationReason: null,
        version: 1,
      };

      const deps = {
        crypto: {
          generateRandomToken: () => 't',
          hashToken: () => new Uint8Array(32).fill(1),
          generateState: () => '',
          generateBrowserBinding: () => '',
          generateNonce: () => '',
          generatePkce: () => ({ verifier: '', challenge: '' }),
          encryptSecrets: () => ({ ciphertext: new Uint8Array(1), iv: new Uint8Array(12), authTag: new Uint8Array(16), keyVersion: 'v1' }),
          decryptSecrets: () => ({ pkceVerifier: '', nonce: '' }),
        },
        sessionStore: {
          createSession: async () => {},
          findCandidateSessions: async () => [hostileCandidate],
          findUserById: async () => null,
          rotateSession: async () => {},
          touchSession: async () => {},
          revokeSession: async () => {},
          revokeMatchingSessionsByTokenHash: async () => {},
          withTransaction: async (fn) => fn(deps.sessionStore),
        },
        now: () => new Date('2026-11-02T12:00:00.000Z'),
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      };

      try {
        await authenticateApplicationSession({ sessionCookie: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, deps);
        process.exit(1);
      } catch (e) {
        if (e instanceof AuthenticationRequiredError) {
          console.log('SAFE_AUTH_REQUIRED_CAUGHT');
          process.exit(0);
        }
        process.exit(2);
      }
    `;

    const { stdout, stderr, code } = await runNodeChild(script);
    expect(code).toBe(0);
    expect(stdout).toContain('SAFE_AUTH_REQUIRED_CAUGHT');
    expect(stdout).not.toContain('MALFORMED_DATE_SENTINEL_VAL_123');
    expect(stderr).not.toContain('MALFORMED_DATE_SENTINEL_VAL_123');
  }, 15000);
});
