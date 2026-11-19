import { describe, expect, it, vi } from 'vitest';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type SocialPlatform,
} from '@affiliate-content-os/domain';
import {
  beginSocialAuthorization,
  completeSocialCallback,
  getSocialCallbackResult,
  listSocialAccounts,
  CallbackResultForbiddenError,
  CallbackResultGoneError,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  SocialAuthNotConfiguredError,
  SocialPlatformUnsupportedError,
  WorkspaceAccessDeniedError,
  type SocialAuthAdapter,
  type SocialCredentialProtectorPort,
  type SocialPersistencePort,
  type WorkspaceAuthorizationPort,
} from '../../src/index.js';

describe('Social Application Use Cases', () => {
  const wsId = '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f';
  const ownerUserId = '018f3a2c-4e5b-7c8d-9e0f-2b3c4d5e6f7a';
  const viewerUserId = '018f3a2c-4e5b-7c8d-9e0f-3c4d5e6f7a8b';
  const mockNow = new Date('2026-11-18T10:00:00.000Z');
  const mockIso = parseIsoTimestamp(mockNow.toISOString());

  const createMockAuthPort = (): WorkspaceAuthorizationPort => ({
    findMembership: vi.fn(async ({ workspaceId, userId }) => {
      if (userId === ownerUserId) {
        return {
          id: parseMembershipId('018f3a2c-4e5b-7c8d-9e0f-4d5e6f7a8b9c'),
          workspaceId,
          userId,
          role: 'owner' as const,
          status: 'active' as const,
          invitedByUserId: null,
          joinedAt: mockIso,
          createdAt: mockIso,
          updatedAt: mockIso,
          version: 1,
        };
      }
      if (userId === viewerUserId) {
        return {
          id: parseMembershipId('018f3a2c-4e5b-7c8d-9e0f-5e6f7a8b9c0d'),
          workspaceId,
          userId,
          role: 'viewer' as const,
          status: 'active' as const,
          invitedByUserId: null,
          joinedAt: mockIso,
          createdAt: mockIso,
          updatedAt: mockIso,
          version: 1,
        };
      }
      return null;
    }),
  });

  const createMockPersistence = (): SocialPersistencePort => ({
    saveOAuthTransaction: vi.fn(async (params) => ({
      id: params.id,
      workspaceId: params.workspaceId,
      platform: params.platform,
      initiatedByUserId: params.initiatedByUserId,
      stateHash: params.stateHash,
      redirectUri: params.redirectUri,
      returnTo: params.returnTo,
      requestedScopes: params.requestedScopes,
      codeVerifierCiphertext: null,
      codeVerifierIv: null,
      codeVerifierAuthTag: null,
      codeVerifierKeyVersion: null,
      status: 'pending' as const,
      createdAt: params.createdAt,
      expiresAt: params.expiresAt,
      claimedAt: null,
      claimedExpiresAt: null,
      consumedAt: null,
      version: 1,
    })),
    saveOAuthTransactionWithIdempotency: vi.fn(async (params) => ({
      replayed: false,
      response: params.responseData,
    })),
    claimOAuthTransaction: vi.fn(async () => ({
      id: 'tx-123',
      workspaceId: wsId,
      platform: 'threads' as const,
      initiatedByUserId: ownerUserId,
      redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic'],
      createdAt: mockNow.toISOString(),
      expiresAt: new Date(mockNow.getTime() + 600000).toISOString(),
      claimedAt: mockNow.toISOString(),
      version: 2,
    })),
    findPendingTransactionByStateHash: vi.fn(),
    completeOAuthCallbackAtomic: vi.fn(),
    recordFailedOAuthCallbackAtomic: vi.fn(),
    consumeCallbackResult: vi.fn(),
    listSocialAccounts: vi.fn(),
    findSocialAccountById: vi.fn(),
    findSocialAccountForUpdate: vi.fn(),
    findEncryptedCredentials: vi.fn(),
    claimSocialAccountForRefresh: vi.fn(),
    claimNextDueSocialAccountForRefresh: vi.fn(),
    completeSocialAccountRefreshAtomic: vi.fn(),
    recordFailedSocialAccountRefreshAtomic: vi.fn(),
    releaseSocialAccountRefreshLeaseAtomic: vi.fn(),
    disconnectSocialAccountAtomic: vi.fn(),
  });

  const createMockAdapter = (): SocialAuthAdapter => ({
    platform: 'threads',
    supportsRefresh: true,
    supportsRevocation: false,
    createAuthorizationUrl: vi.fn(async () => ({
      authorizationUrl: 'https://threads.net/oauth/authorize?test=1',
    })),
    exchangeCode: vi.fn(async () => ({
      providerAccountId: 'threads_user_123',
      displayName: 'Test Creator',
      handle: '@testcreator',
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      tokenExpiresInSeconds: 3600,
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilities: { canPublishText: true, canPublishMedia: false },
      environment: 'local' as const,
    })),
  });

  const createMockAdapters = (
    adapter = createMockAdapter(),
  ): ReadonlyMap<SocialPlatform, SocialAuthAdapter> =>
    new Map<SocialPlatform, SocialAuthAdapter>([['threads', adapter]]);

  const createMockProtector = (): SocialCredentialProtectorPort => ({
    encrypt: vi.fn(() => ({
      accessTokenCiphertext: new Uint8Array([1, 2, 3]),
      accessTokenIv: new Uint8Array(12),
      accessTokenAuthTag: new Uint8Array(16),
      refreshTokenCiphertext: new Uint8Array([4, 5, 6]),
      refreshTokenIv: new Uint8Array(12),
      refreshTokenAuthTag: new Uint8Array(16),
      keyVersion: 'v1',
    })),
    decrypt: vi.fn(() => ({
      accessToken: 'decrypted_access_token',
      refreshToken: 'decrypted_refresh_token',
    })),
    encryptOAuthVerifier: vi.fn(() => ({
      ciphertext: new Uint8Array([7, 8, 9]),
      iv: new Uint8Array(12),
      authTag: new Uint8Array(16),
      keyVersion: 'v1',
    })),
    decryptOAuthVerifier: vi.fn(() => 'decrypted_pkce_verifier'),
  });

  describe('beginSocialAuthorization', () => {
    it('allows owner to start authorization and saves pending transaction with state hash', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();
      const adapter = createMockAdapter();
      const adapters = createMockAdapters(adapter);

      const result = await beginSocialAuthorization(
        {
          workspaceId: wsId,
          actorUserId: ownerUserId,
          platform: 'threads',
          redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
          returnTo: '/settings/connections',
        },
        {
          persistence,
          workspaceAuthorization: authPort,
          adapters,
          enabled: true,
          transactionTtlSeconds: 600,
          idGenerator: { generate: () => '018f3a2c-4e5b-7c8d-9e0f-9a0b1c2d3e4f' },
          clock: { now: () => mockNow },
        },
      );

      expect(result.authorizationUrl).toBe('https://threads.net/oauth/authorize?test=1');
      expect(result.transactionId).toBe('018f3a2c-4e5b-7c8d-9e0f-9a0b1c2d3e4f');

      expect(persistence.saveOAuthTransaction).toHaveBeenCalledOnce();
      const saved = vi.mocked(persistence.saveOAuthTransaction).mock.calls[0]![0];
      expect(saved.stateHash).toHaveLength(32);
      expect(saved.workspaceId).toBe(wsId);
      expect(saved.returnTo).toBe('/settings/connections');
      expect(saved.pkceVerifierCiphertext).toBeNull();
    });

    it('encrypts PKCE verifier before persistence when adapter generates one', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();
      const protector = createMockProtector();
      const adapter: SocialAuthAdapter = {
        platform: 'threads',
        supportsRefresh: true,
        supportsRevocation: false,
        createAuthorizationUrl: vi.fn(async () => ({
          authorizationUrl: 'https://threads.net/oauth/authorize?test=pkce',
          codeVerifier: 'plain_code_verifier_12345',
          scopes: ['threads_basic'],
        })),
        exchangeCode: vi.fn(),
      };
      const adapters = createMockAdapters(adapter);

      const result = await beginSocialAuthorization(
        {
          workspaceId: wsId,
          actorUserId: ownerUserId,
          platform: 'threads',
          redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
        },
        {
          persistence,
          workspaceAuthorization: authPort,
          adapters,
          protector,
          enabled: true,
          transactionTtlSeconds: 600,
          idGenerator: { generate: () => '018f3a2c-4e5b-7c8d-9e0f-9a0b1c2d3e4f' },
          clock: { now: () => mockNow },
        },
      );

      expect(result.authorizationUrl).toBe('https://threads.net/oauth/authorize?test=pkce');
      expect(protector.encryptOAuthVerifier).toHaveBeenCalledWith({
        codeVerifier: 'plain_code_verifier_12345',
        platform: 'threads',
        workspaceId: wsId,
        transactionId: '018f3a2c-4e5b-7c8d-9e0f-9a0b1c2d3e4f',
      });

      const saved = vi.mocked(persistence.saveOAuthTransaction).mock.calls[0]![0];
      expect(saved.pkceVerifierCiphertext).toEqual(new Uint8Array([7, 8, 9]));
      expect(saved.encryptionKeyVersion).toBe('v1');
    });

    it('replays cached response when idempotency key is recognized', async () => {
      const persistence = createMockPersistence();
      vi.mocked(persistence.saveOAuthTransactionWithIdempotency).mockResolvedValue({
        replayed: true,
        response: {
          authorizationUrl: 'https://threads.net/oauth/authorize?cached=1',
          transactionId: 'cached-tx-123',
          expiresAt: new Date(mockNow.getTime() + 600000).toISOString(),
        },
      });
      const authPort = createMockAuthPort();
      const adapters = createMockAdapters();

      const result = await beginSocialAuthorization(
        {
          workspaceId: wsId,
          actorUserId: ownerUserId,
          platform: 'threads',
          redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
          idempotencyKey: 'idem-key-1',
          keyHash: new Uint8Array(32),
          requestHash: new Uint8Array(32),
        },
        {
          persistence,
          workspaceAuthorization: authPort,
          adapters,
          enabled: true,
          transactionTtlSeconds: 600,
          idGenerator: { generate: () => 'new-tx' },
          clock: { now: () => mockNow },
        },
      );

      expect(result.authorizationUrl).toBe('https://threads.net/oauth/authorize?cached=1');
      expect(result.transactionId).toBe('cached-tx-123');
      expect(persistence.saveOAuthTransactionWithIdempotency).toHaveBeenCalledOnce();
    });

    it('denies viewer with WorkspaceAccessDeniedError', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();
      const adapters = createMockAdapters();

      await expect(
        beginSocialAuthorization(
          {
            workspaceId: wsId,
            actorUserId: viewerUserId,
            platform: 'threads',
            redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
          },
          {
            persistence,
            workspaceAuthorization: authPort,
            adapters,
            enabled: true,
            transactionTtlSeconds: 600,
            idGenerator: { generate: () => 'test-id' },
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);
    });

    it('rejects when social auth is disabled', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();
      const adapters = createMockAdapters();

      await expect(
        beginSocialAuthorization(
          {
            workspaceId: wsId,
            actorUserId: ownerUserId,
            platform: 'threads',
            redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
          },
          {
            persistence,
            workspaceAuthorization: authPort,
            adapters,
            enabled: false,
            transactionTtlSeconds: 600,
            idGenerator: { generate: () => 'test-id' },
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(SocialAuthNotConfiguredError);
    });

    it('rejects unsupported platform', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();
      const adapters = new Map();

      await expect(
        beginSocialAuthorization(
          {
            workspaceId: wsId,
            actorUserId: ownerUserId,
            platform: 'unsupported',
            redirectUri: 'http://localhost:3001/api/v1/callback',
          },
          {
            persistence,
            workspaceAuthorization: authPort,
            adapters,
            enabled: true,
            transactionTtlSeconds: 600,
            idGenerator: { generate: () => 'test-id' },
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(SocialPlatformUnsupportedError);
    });
  });

  describe('completeSocialCallback', () => {
    it('completes callback successfully when code is valid and transaction is pending', async () => {
      const persistence = createMockPersistence();
      const protector = createMockProtector();
      const adapter = createMockAdapter();
      const adapters = createMockAdapters(adapter);

      const result = await completeSocialCallback(
        {
          platform: 'threads',
          state: 'valid-base64url-state-string-12345678',
          code: 'valid-code-123',
        },
        {
          persistence,
          protector,
          adapters,
          enabled: true,
          callbackResultTtlSeconds: 300,
          clock: { now: () => mockNow },
        },
      );

      expect(result.isSuccess).toBe(true);
      expect(result.redirectUrl).toContain('/connections?connection_result=');
      expect(persistence.claimOAuthTransaction).toHaveBeenCalledOnce();
      expect(persistence.completeOAuthCallbackAtomic).toHaveBeenCalledOnce();
      const completeAtomicArgs = vi.mocked(persistence.completeOAuthCallbackAtomic).mock
        .calls[0]![0];
      expect(typeof completeAtomicArgs.encryptCredentials).toBe('function');
      const encrypted = completeAtomicArgs.encryptCredentials('target-acc-id-123');
      expect(encrypted.keyVersion).toBe('v1');
      expect(protector.encrypt).toHaveBeenCalledWith({
        accessToken: 'test_access_token',
        refreshToken: 'test_refresh_token',
        workspaceId: wsId,
        socialAccountId: 'target-acc-id-123',
        platform: 'threads',
      });
    });

    it('decrypts PKCE verifier and passes it to exchangeCode when present', async () => {
      const persistence = createMockPersistence();
      const protector = createMockProtector();
      const adapter = createMockAdapter();
      const adapters = createMockAdapters(adapter);

      vi.mocked(persistence.claimOAuthTransaction).mockResolvedValue({
        id: 'tx-pkce',
        workspaceId: wsId,
        platform: 'threads' as const,
        initiatedByUserId: ownerUserId,
        redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
        returnTo: '/connections',
        requestedScopes: ['threads_basic'],
        encryptedVerifier: {
          ciphertext: new Uint8Array([7, 8, 9]),
          iv: new Uint8Array(12),
          authTag: new Uint8Array(16),
          keyVersion: 'v1',
        },
        createdAt: mockNow.toISOString(),
        expiresAt: new Date(mockNow.getTime() + 600000).toISOString(),
        claimedAt: mockNow.toISOString(),
        version: 2,
      });

      await completeSocialCallback(
        {
          platform: 'threads',
          state: 'valid-base64url-state-string-12345678',
          code: 'valid-code-pkce',
        },
        {
          persistence,
          protector,
          adapters,
          enabled: true,
          callbackResultTtlSeconds: 300,
          clock: { now: () => mockNow },
        },
      );

      expect(protector.decryptOAuthVerifier).toHaveBeenCalledWith({
        encryptedVerifier: {
          ciphertext: new Uint8Array([7, 8, 9]),
          iv: new Uint8Array(12),
          authTag: new Uint8Array(16),
          keyVersion: 'v1',
        },
        platform: 'threads',
        workspaceId: wsId,
        transactionId: 'tx-pkce',
      });

      expect(adapter.exchangeCode).toHaveBeenCalledWith({
        code: 'valid-code-pkce',
        platform: 'threads',
        redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
        codeVerifier: 'decrypted_pkce_verifier',
      });
    });

    it('enforces single provider exchange under concurrent callback attempts', async () => {
      const persistence = createMockPersistence();
      const protector = createMockProtector();
      const adapter = createMockAdapter();
      const adapters = createMockAdapters(adapter);

      let claimCalls = 0;
      vi.mocked(persistence.claimOAuthTransaction).mockImplementation(async () => {
        claimCalls++;
        if (claimCalls === 1) {
          return {
            id: 'tx-123',
            workspaceId: wsId,
            platform: 'threads' as const,
            initiatedByUserId: ownerUserId,
            redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
            returnTo: '/connections',
            requestedScopes: ['threads_basic'],
            createdAt: mockNow.toISOString(),
            expiresAt: new Date(mockNow.getTime() + 600000).toISOString(),
            claimedAt: mockNow.toISOString(),
            version: 2,
          };
        }
        throw new OAuthTransactionReplayedError(
          'OAuth transaction has already been claimed or consumed.',
        );
      });

      const params = {
        platform: 'threads' as const,
        state: 'valid-base64url-state-string-12345678',
        code: 'valid-code-concurrent',
      };
      const context = {
        persistence,
        protector,
        adapters,
        enabled: true,
        callbackResultTtlSeconds: 300,
        clock: { now: () => mockNow },
      };

      const [res1, res2] = await Promise.allSettled([
        completeSocialCallback(params, context),
        completeSocialCallback(params, context),
      ]);

      expect(res1.status).toBe('fulfilled');
      expect(res2.status).toBe('rejected');
      if (res2.status === 'rejected') {
        expect(res2.reason).toBeInstanceOf(OAuthTransactionReplayedError);
      }
      expect(adapter.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it('rejects callback if query contains both code and error', async () => {
      const persistence = createMockPersistence();
      const protector = createMockProtector();
      const adapters = createMockAdapters();

      await expect(
        completeSocialCallback(
          {
            platform: 'threads',
            state: 'valid-base64url-state-string-12345678',
            code: 'valid-code',
            error: 'access_denied',
          },
          {
            persistence,
            protector,
            adapters,
            enabled: true,
            callbackResultTtlSeconds: 300,
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(OAuthCallbackInvalidError);
    });

    it('throws OAuthTransactionNotFoundError if state hash is not found', async () => {
      const persistence = createMockPersistence();
      vi.mocked(persistence.claimOAuthTransaction).mockRejectedValue(
        new OAuthTransactionNotFoundError(),
      );

      await expect(
        completeSocialCallback(
          {
            platform: 'threads',
            state: 'valid-base64url-state-string-12345678',
            code: 'valid-code',
          },
          {
            persistence,
            protector: createMockProtector(),
            adapters: createMockAdapters(),
            enabled: true,
            callbackResultTtlSeconds: 300,
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(OAuthTransactionNotFoundError);
    });

    it('throws OAuthTransactionExpiredError if transaction is expired', async () => {
      const persistence = createMockPersistence();
      vi.mocked(persistence.claimOAuthTransaction).mockRejectedValue(
        new OAuthTransactionExpiredError('OAuth transaction has expired.'),
      );

      await expect(
        completeSocialCallback(
          {
            platform: 'threads',
            state: 'valid-base64url-state-string-12345678',
            code: 'valid-code',
          },
          {
            persistence,
            protector: createMockProtector(),
            adapters: createMockAdapters(),
            enabled: true,
            callbackResultTtlSeconds: 300,
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(OAuthTransactionExpiredError);
    });

    it('throws OAuthTransactionReplayedError if transaction is already claimed or consumed', async () => {
      const persistence = createMockPersistence();
      vi.mocked(persistence.claimOAuthTransaction).mockRejectedValue(
        new OAuthTransactionReplayedError(
          'OAuth transaction has already been claimed or consumed.',
        ),
      );

      await expect(
        completeSocialCallback(
          {
            platform: 'threads',
            state: 'valid-base64url-state-string-12345678',
            code: 'valid-code',
          },
          {
            persistence,
            protector: createMockProtector(),
            adapters: createMockAdapters(),
            enabled: true,
            callbackResultTtlSeconds: 300,
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(OAuthTransactionReplayedError);
    });

    it('records failed callback result atomically when provider returns error', async () => {
      const persistence = createMockPersistence();

      const result = await completeSocialCallback(
        {
          platform: 'threads',
          state: 'valid-base64url-state-string-12345678',
          error: 'access_denied',
          errorDescription: 'The user denied request',
        },
        {
          persistence,
          protector: createMockProtector(),
          adapters: createMockAdapters(),
          enabled: true,
          callbackResultTtlSeconds: 300,
          clock: { now: () => mockNow },
        },
      );

      expect(result.isSuccess).toBe(false);
      expect(result.redirectUrl).toContain('/connections?connection_result=');
      expect(persistence.claimOAuthTransaction).toHaveBeenCalledOnce();
      expect(persistence.recordFailedOAuthCallbackAtomic).toHaveBeenCalledOnce();
      const failedArgs = vi.mocked(persistence.recordFailedOAuthCallbackAtomic).mock.calls[0]![0];
      expect(failedArgs.errorCode).toBe('access_denied');
      expect(failedArgs.errorDescription).toBe('The authorization request was denied.');
      expect(failedArgs.actorUserId).toBe(ownerUserId);
    });
  });

  describe('getSocialCallbackResult', () => {
    it('consumes callback result atomically for the initiating user', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();

      vi.mocked(persistence.consumeCallbackResult).mockResolvedValue({
        id: 'res-123',
        workspaceId: wsId,
        transactionId: 'tx-123',
        resultKeyHash: new Uint8Array(32),
        status: 'success',
        platform: 'threads',
        socialAccountId: 'acc-123',
        errorCode: null,
        errorDescription: null,
        createdAt: mockNow.toISOString(),
        expiresAt: new Date(mockNow.getTime() + 300000).toISOString(),
        consumedAt: mockNow.toISOString(),
        version: 2,
        initiatedByUserId: ownerUserId,
      });

      const result = await getSocialCallbackResult(
        {
          workspaceId: wsId,
          actorUserId: ownerUserId,
          resultKey: 'valid-result-key-12345678901234',
        },
        {
          persistence,
          workspaceAuthorization: authPort,
          enabled: true,
          clock: { now: () => mockNow },
        },
      );

      expect(result.status).toBe('success');
      expect(result.platform).toBe('threads');
      expect(result.socialAccountId).toBe('acc-123');
      expect(persistence.consumeCallbackResult).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: wsId,
          actorUserId: ownerUserId,
        }),
      );
    });

    it('rejects cross-actor callback consumption with CallbackResultForbiddenError', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();

      vi.mocked(persistence.consumeCallbackResult).mockRejectedValue(
        new CallbackResultForbiddenError(),
      );

      await expect(
        getSocialCallbackResult(
          {
            workspaceId: wsId,
            actorUserId: viewerUserId,
            resultKey: 'valid-result-key-12345678901234',
          },
          {
            persistence,
            workspaceAuthorization: authPort,
            enabled: true,
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(CallbackResultForbiddenError);
    });

    it('throws CallbackResultGoneError if already consumed or expired', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();
      vi.mocked(persistence.consumeCallbackResult).mockResolvedValue(null);

      await expect(
        getSocialCallbackResult(
          {
            workspaceId: wsId,
            actorUserId: ownerUserId,
            resultKey: 'valid-result-key-12345678901234',
          },
          {
            persistence,
            workspaceAuthorization: authPort,
            enabled: true,
            clock: { now: () => mockNow },
          },
        ),
      ).rejects.toThrow(CallbackResultGoneError);
    });
  });

  describe('listSocialAccounts', () => {
    it('allows viewer to list social accounts without credentials', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();

      vi.mocked(persistence.listSocialAccounts).mockResolvedValue([
        {
          id: 'acc-1',
          workspaceId: wsId,
          platform: 'threads',
          providerAccountId: 'prov-1',
          displayName: 'Creator One',
          handle: '@creatorone',
          status: 'active',
          grantedScopes: ['threads_basic'],
          capabilities: { canPublishText: true },
          capabilitiesCheckedAt: mockNow.toISOString(),
          tokenExpiresAt: null,
          connectedByUserId: ownerUserId,
          disconnectedAt: null,
          environment: 'local',
          createdAt: mockNow.toISOString(),
          updatedAt: mockNow.toISOString(),
          version: 1,
        },
      ]);

      const list = await listSocialAccounts(
        {
          workspaceId: wsId,
          actorUserId: viewerUserId,
        },
        {
          persistence,
          workspaceAuthorization: authPort,
        },
      );

      expect(list).toHaveLength(1);
      expect(list[0]?.displayName).toBe('Creator One');
      expect(list[0]?.handle).toBe('@creatorone');
      expect(
        (list[0] as unknown as Record<string, unknown>)['accessTokenCiphertext'],
      ).toBeUndefined();
    });
  });
});
