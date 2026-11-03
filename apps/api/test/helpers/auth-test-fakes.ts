import { vi } from 'vitest';
import type { AuthConfig } from '@affiliate-content-os/config';
import {
  DefaultIdGenerator,
  type AuthCryptoPort,
  type EncryptedSecretsDTO,
  type LoginSecretsPayloadDTO,
  type LoginTransactionStorePort,
  type OidcProtocolPort,
  type ResolveVerifiedIdentityDependencies,
  type SessionStorePort,
  type UserDirectoryPort,
  type WorkspaceSummaryPort,
} from '@affiliate-content-os/application';
import type { AuthDependencies } from '../../src/auth/types.js';

export function createTestAuthConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  return Object.freeze({
    enabled: true,
    issuer: 'https://auth.example.com',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://127.0.0.1:3001/auth/callback',
    transactionEncryptionKeyBase64Url: 'A'.repeat(43),
    transactionKeyVersion: 'v1',
    transactionTtlSeconds: 600,
    sessionIdleTtlSeconds: 1800,
    sessionAbsoluteTtlSeconds: 28800,
    sessionRotationSeconds: 900,
    sessionRotationGraceSeconds: 30,
    sessionTouchIntervalSeconds: 300,
    cookieSecure: false,
    ...overrides,
  });
}

type UserRecord = NonNullable<Awaited<ReturnType<UserDirectoryPort['findUserById']>>>;

export interface MockAuthDependencies extends AuthDependencies {
  readonly config: AuthConfig;
  readonly appBaseUrl: string;
  readonly now: () => Date;
  readonly generateId: () => string;
  readonly crypto: AuthCryptoPort;
  readonly loginTransactionStore: LoginTransactionStorePort;
  readonly sessionStore: SessionStorePort;
  readonly oidcProtocolPort: OidcProtocolPort;
  readonly userDirectory: UserDirectoryPort;
  readonly identityResolution: ResolveVerifiedIdentityDependencies;
  readonly workspaceSummary: WorkspaceSummaryPort;
}

export function createMockAuthDeps(overrides?: Partial<AuthDependencies>): MockAuthDependencies {
  const config = overrides?.config ?? createTestAuthConfig();
  const idGen = new DefaultIdGenerator();

  const dummyEncryptedSecrets: EncryptedSecretsDTO = {
    ciphertext: new Uint8Array(48).fill(4),
    iv: new Uint8Array(12).fill(5),
    authTag: new Uint8Array(16).fill(6),
    keyVersion: 'v1',
  };

  const dummySecretsPayload: LoginSecretsPayloadDTO = {
    pkceVerifier: 'pkce-verifier-string-43-chars-long-12345678901',
    nonce: 'nonce-raw-value-32-chars-long-123456789012',
  };

  const crypto: AuthCryptoPort = {
    generateRandomToken: vi.fn(() => 'test-random-session-token-43-chars-long-1234'),
    hashToken: vi.fn(() => new Uint8Array(32).fill(7)),
    generateState: vi.fn(() => ({
      raw: 'state-raw-value-32-chars-long-123456789012',
      hash: new Uint8Array(32).fill(1),
    })),
    generateBrowserBinding: vi.fn(() => ({
      raw: 'test-browser-binding-cookie-secret-32-chars!',
      hash: new Uint8Array(32).fill(2),
    })),
    generateNonce: vi.fn(() => 'nonce-raw-value-32-chars-long-123456789012'),
    generatePkce: vi.fn(() => ({
      verifier: 'pkce-verifier-string-43-chars-long-12345678901',
      challenge: 'pkce-challenge-string-43-chars-long-123456789',
    })),
    encryptSecrets: vi.fn(() => dummyEncryptedSecrets),
    decryptSecrets: vi.fn(() => dummySecretsPayload),
  };

  const loginTransactionStore: LoginTransactionStorePort = {
    createPendingTransaction: vi.fn(async () => {}),
    consumePendingTransaction: vi.fn(async () => ({
      id: '0192b012-3456-789a-8bcd-ef0123456789',
      keyVersion: 'v1',
      returnTo: '/',
      encryptedSecrets: dummyEncryptedSecrets,
      createdAt: '2026-11-02T12:00:00.000Z',
      expiresAt: '2026-11-02T12:10:00.000Z',
    })),
  };

  const sessionStore: SessionStorePort = {
    createSession: vi.fn(async () => {}),
    findCandidateSessions: vi.fn(async () => []),
    findUserById: vi.fn(async () => null),
    rotateSession: vi.fn(async () => {}),
    touchSession: vi.fn(async () => {}),
    revokeSession: vi.fn(async () => {}),
    revokeMatchingSessionsByTokenHash: vi.fn(async () => {}),
    withTransaction: vi.fn(async function (fn) {
      return fn(sessionStore);
    }),
  };

  const oidcProtocolPort: OidcProtocolPort = {
    buildAuthorizationUrl: vi.fn(() => 'https://auth.example.com/oauth/authorize?state=123'),
    exchangeCodeAndValidateIdToken: vi.fn(async () => ({
      issuer: 'https://auth.example.com',
      subject: 'sub-123',
      email: 'user@example.com',
      displayName: 'Test User',
    })),
  };

  const userDirectory: UserDirectoryPort = {
    findUserById: vi.fn(async () => null),
  };

  const identityResolution: ResolveVerifiedIdentityDependencies = {
    identityDirectory: {
      findUsersByIdentity: vi.fn(async () => [
        Object.freeze({
          id: idGen.generateUserId(),
          identityProvider: 'https://auth.example.com',
          identitySubject: 'sub-123',
          email: 'user@example.com',
          displayName: 'Test User',
          status: 'active',
          createdAt: '2026-11-02T12:00:00.000Z' as unknown as UserRecord['createdAt'],
          updatedAt: '2026-11-02T12:00:00.000Z' as unknown as UserRecord['updatedAt'],
          version: 1,
        }),
      ]),
      insertUserIfAbsent: vi.fn(async () => {
        throw new Error('Not called in test');
      }),
    },
    clock: { now: () => new Date('2026-11-02T12:00:00.000Z') },
    idGenerator: idGen,
  };

  const workspaceSummary: WorkspaceSummaryPort = {
    listActiveWorkspaceSummaries: vi.fn(async () => ({
      items: [],
      hasMore: false,
    })),
  };

  return {
    config,
    appBaseUrl: overrides?.appBaseUrl ?? 'http://127.0.0.1:3000',
    now: overrides?.now ?? (() => new Date('2026-11-02T12:00:00.000Z')),
    generateId:
      overrides && 'generateId' in overrides
        ? (overrides.generateId as () => string)
        : () => '0192b012-3456-789a-8bcd-ef0123456789',
    crypto: overrides?.crypto ?? crypto,
    loginTransactionStore: overrides?.loginTransactionStore ?? loginTransactionStore,
    sessionStore: overrides?.sessionStore ?? sessionStore,
    oidcProtocolPort: overrides?.oidcProtocolPort ?? oidcProtocolPort,
    userDirectory: overrides?.userDirectory ?? userDirectory,
    identityResolution: overrides?.identityResolution ?? identityResolution,
    workspaceSummary: overrides?.workspaceSummary ?? workspaceSummary,
  };
}
