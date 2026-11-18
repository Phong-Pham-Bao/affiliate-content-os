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
      status: 'pending' as const,
      createdAt: params.createdAt,
      expiresAt: params.expiresAt,
      consumedAt: null,
      version: 1,
    })),
    findPendingTransactionByStateHash: vi.fn(),
    completeOAuthCallbackAtomic: vi.fn(),
    recordFailedOAuthCallbackAtomic: vi.fn(),
    consumeCallbackResult: vi.fn(),
    listSocialAccounts: vi.fn(),
    findSocialAccountById: vi.fn(),
  });

  const createMockAdapter = (): SocialAuthAdapter => ({
    platform: 'threads',
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

      vi.mocked(persistence.findPendingTransactionByStateHash).mockResolvedValue({
        id: 'tx-123',
        workspaceId: wsId,
        platform: 'threads',
        initiatedByUserId: ownerUserId,
        stateHash: new Uint8Array(32),
        redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
        returnTo: '/connections',
        requestedScopes: ['threads_basic'],
        status: 'pending',
        createdAt: mockNow.toISOString(),
        expiresAt: new Date(mockNow.getTime() + 600000).toISOString(),
        consumedAt: null,
        version: 1,
      });

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
      expect(persistence.completeOAuthCallbackAtomic).toHaveBeenCalledOnce();
      expect(protector.encrypt).toHaveBeenCalledOnce();
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
      vi.mocked(persistence.findPendingTransactionByStateHash).mockResolvedValue(null);

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
      vi.mocked(persistence.findPendingTransactionByStateHash).mockResolvedValue({
        id: 'tx-123',
        workspaceId: wsId,
        platform: 'threads',
        initiatedByUserId: ownerUserId,
        stateHash: new Uint8Array(32),
        redirectUri: 'http://localhost:3001/callback',
        returnTo: '/',
        requestedScopes: [],
        status: 'pending',
        createdAt: new Date('2026-11-18T08:00:00Z').toISOString(),
        expiresAt: new Date('2026-11-18T08:10:00Z').toISOString(), // in the past relative to mockNow
        consumedAt: null,
        version: 1,
      });

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

    it('throws OAuthTransactionReplayedError if transaction is already consumed', async () => {
      const persistence = createMockPersistence();
      vi.mocked(persistence.findPendingTransactionByStateHash).mockResolvedValue({
        id: 'tx-123',
        workspaceId: wsId,
        platform: 'threads',
        initiatedByUserId: ownerUserId,
        stateHash: new Uint8Array(32),
        redirectUri: 'http://localhost:3001/callback',
        returnTo: '/',
        requestedScopes: [],
        status: 'consumed',
        createdAt: mockNow.toISOString(),
        expiresAt: new Date(mockNow.getTime() + 600000).toISOString(),
        consumedAt: mockNow.toISOString(),
        version: 2,
      });

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
      vi.mocked(persistence.findPendingTransactionByStateHash).mockResolvedValue({
        id: 'tx-123',
        workspaceId: wsId,
        platform: 'threads',
        initiatedByUserId: ownerUserId,
        stateHash: new Uint8Array(32),
        redirectUri: 'http://localhost:3001/callback',
        returnTo: '/connections',
        requestedScopes: [],
        status: 'pending',
        createdAt: mockNow.toISOString(),
        expiresAt: new Date(mockNow.getTime() + 600000).toISOString(),
        consumedAt: null,
        version: 1,
      });

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
      expect(persistence.recordFailedOAuthCallbackAtomic).toHaveBeenCalledOnce();
    });
  });

  describe('getSocialCallbackResult', () => {
    it('consumes callback result atomically for workspace member', async () => {
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
      });

      const result = await getSocialCallbackResult(
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
      );

      expect(result.status).toBe('success');
      expect(result.platform).toBe('threads');
      expect(result.socialAccountId).toBe('acc-123');
      expect(persistence.consumeCallbackResult).toHaveBeenCalledOnce();
    });

    it('throws CallbackResultGoneError if already consumed or expired', async () => {
      const persistence = createMockPersistence();
      const authPort = createMockAuthPort();
      vi.mocked(persistence.consumeCallbackResult).mockResolvedValue(null);

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
