import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CreateWorkspaceWithOwnerParams,
  CreateWorkspaceResult,
  WorkspaceAuthorizationPort,
  WorkspacePersistencePort,
} from '@affiliate-content-os/application';
import {
  DefaultIdGenerator,
  IdempotencyKeyReusedError,
  SlugConflictError,
  SystemClock,
} from '@affiliate-content-os/application';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type AuditEventSnapshot,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import type { WorkspaceRouteDependencies } from '../src/workspaces/types.js';
import { createMockAuthDeps } from './helpers/auth-test-fakes.js';

describe('Workspace HTTP Routes', { timeout: 15000 }, () => {
  const validSessionCookie = 'A'.repeat(43);
  const testUserId = '0192b012-3456-789a-8bcd-ef0123456701' as UserId;
  const testWorkspaceId = '0192b012-3456-789a-8bcd-ef0123456702' as WorkspaceId;
  const validOrigin = 'http://127.0.0.1:3000';

  function createTestWorkspaceDeps(overrides?: {
    readonly workspacePersistence?: Partial<WorkspacePersistencePort>;
    readonly workspaceAuthorization?: Partial<WorkspaceAuthorizationPort>;
  }): {
    deps: WorkspaceRouteDependencies;
    getLastAuditEvent: () => AuditEventSnapshot | null;
    getCreateCallCount: () => number;
  } {
    const auth = createMockAuthDeps();
    auth.sessionStore.findCandidateSessions = async () => [
      {
        id: '0192b012-3456-789a-8bcd-ef0123456720',
        userId: testUserId,
        currentTokenHash: new Uint8Array(32).fill(7),
        previousTokenHash: null,
        previousTokenValidUntil: null,
        createdAt: '2026-11-02T12:00:00.000Z',
        lastSeenAt: '2026-11-02T12:00:00.000Z',
        idleExpiresAt: '2026-11-02T12:30:00.000Z',
        absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
        rotatedAt: '2026-11-02T12:00:00.000Z',
        revokedAt: null,
        revocationReason: null,
        version: 1,
      },
    ];
    const testUser = Object.freeze({
      id: testUserId,
      identityProvider: 'https://auth.example.com',
      identitySubject: 'sub-123',
      email: 'user@example.com',
      displayName: 'Test User',
      status: 'active' as const,
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      version: 1,
    });
    auth.sessionStore.findUserById = async () => testUser;
    auth.userDirectory.findUserById = async () => testUser;
    const clock = new SystemClock();
    const idGenerator = new DefaultIdGenerator();

    const storedByPrincipalAndKey: Map<
      string,
      {
        workspace: WorkspaceSnapshot;
        membership: WorkspaceMembershipSnapshot;
        requestHash: Uint8Array;
      }
    > = new Map();

    let createCallCount = 0;
    let lastAuditEvent: AuditEventSnapshot | null = null;

    const workspacePersistence: WorkspacePersistencePort = {
      async createWorkspaceWithOwner(
        params: CreateWorkspaceWithOwnerParams,
      ): Promise<CreateWorkspaceResult> {
        createCallCount++;

        if (params.workspace.slug === 'conflict-slug') {
          throw new SlugConflictError('conflict-slug');
        }

        const idemp = params.idempotencyRecord;
        if (idemp) {
          const mapKey = `${idemp.principalId}:${Buffer.from(idemp.keyHash).toString('hex')}`;
          const existing = storedByPrincipalAndKey.get(mapKey);

          if (existing) {
            if (
              crypto.timingSafeEqual(
                Buffer.from(existing.requestHash),
                Buffer.from(idemp.requestHash),
              )
            ) {
              return {
                workspace: existing.workspace,
                membership: existing.membership,
                idempotencyRecord: idemp,
                auditEvent: null,
                cached: true,
              };
            }
            throw new IdempotencyKeyReusedError();
          }

          storedByPrincipalAndKey.set(mapKey, {
            workspace: params.workspace,
            membership: params.membership,
            requestHash: new Uint8Array(idemp.requestHash),
          });
        }

        lastAuditEvent = params.auditEvent ?? null;
        return {
          workspace: params.workspace,
          membership: params.membership,
          idempotencyRecord: params.idempotencyRecord,
          auditEvent: params.auditEvent,
          cached: false,
        };
      },
      async findWorkspaceByIdForUser(params) {
        if (params.workspaceId === testWorkspaceId) {
          return {
            id: testWorkspaceId,
            name: 'Existing Workspace',
            slug: 'existing-workspace',
            timezone: 'UTC',
            brandVoice: 'Professional',
            defaultDisclosure: 'Affiliate links disclosure',
            aiEnabled: true,
            status: 'active',
            createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            updatedAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            version: 1,
          };
        }
        return null;
      },
      async findMembership(params) {
        if (params.workspaceId === testWorkspaceId) {
          return {
            id: parseMembershipId('0192b012-3456-789a-8bcd-ef0123456703'),
            workspaceId: testWorkspaceId,
            userId: testUserId,
            role: 'owner',
            status: 'active',
            invitedByUserId: null,
            joinedAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            updatedAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
            version: 1,
          };
        }
        return null;
      },
      ...overrides?.workspacePersistence,
    };

    const workspaceAuthorization: WorkspaceAuthorizationPort = {
      async findMembership(params) {
        return workspacePersistence.findMembership(params);
      },
      ...overrides?.workspaceAuthorization,
    };

    return {
      deps: {
        auth,
        workspacePersistence,
        workspaceAuthorization,
        userDirectory: auth.userDirectory,
        clock,
        idGenerator,
      },
      getLastAuditEvent: () => lastAuditEvent,
      getCreateCallCount: () => createCallCount,
    };
  }

  describe('POST /api/v1/workspaces', () => {
    it('returns 401 AUTHENTICATION_REQUIRED when session cookie is missing', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456701',
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('returns 400 when Idempotency-Key header is missing', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when Idempotency-Key header is malformed', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': 'key with spaces',
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects missing Origin header with 400 VALIDATION_ERROR (schema required)', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456702',
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects empty Origin header with 400 VALIDATION_ERROR (schema minLength)', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: '',
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456702',
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects Origin: "null" with 403 AUTH_ORIGIN_INVALID (policy rejection)', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: 'null',
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456703',
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('AUTH_ORIGIN_INVALID');
    });

    it('rejects mismatched Origin with 403 AUTH_ORIGIN_INVALID (policy rejection)', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: 'https://attacker.example.com',
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456704',
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('AUTH_ORIGIN_INVALID');
    });

    it('returns 400 when required fields are missing or unknown fields are passed', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const missingName = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456705',
        },
        payload: { slug: 'my-workspace', timezone: 'UTC' },
      });
      expect(missingName.statusCode).toBe(400);

      const unknownProp = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456706',
        },
        payload: {
          name: 'My Workspace',
          slug: 'my-workspace',
          timezone: 'UTC',
          unknownField: 'malicious',
        },
      });
      expect(unknownProp.statusCode).toBe(400);
    });

    it('creates workspace and returns 201 with Location header and resource body', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456707',
        },
        payload: {
          name: 'Acme Content',
          slug: 'acme-content',
          timezone: 'America/New_York',
          brandVoice: 'Energetic',
          defaultDisclosure: 'Sponsored content',
          aiEnabled: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.name).toBe('Acme Content');
      expect(data.slug).toBe('acme-content');
      expect(data.timezone).toBe('America/New_York');
      expect(data.role).toBe('owner');
      expect(data.status).toBe('active');
      expect(data.aiEnabled).toBe(true);
      expect(response.headers.location).toBe(`/api/v1/workspaces/${data.id}`);
    });

    it('enforces rate limit of 10 requests per 60 seconds on workspace creation', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/workspaces',
          cookies: { [COOKIE_SESSION]: validSessionCookie },
          headers: {
            origin: validOrigin,
            'idempotency-key': `rate-limit-key-${i}`,
          },
          payload: {
            name: `Rate Limit WS ${i}`,
            slug: `rate-limit-ws-${i}`,
            timezone: 'UTC',
          },
        });
        expect(res.statusCode).toBe(201);
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': 'rate-limit-key-blocked',
        },
        payload: {
          name: 'Blocked WS',
          slug: 'blocked-ws',
          timezone: 'UTC',
        },
      });

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blocked.json().title).toBe('Too Many Requests');
      expect(blocked.json().type).toBe(
        'https://affiliate-content-os.example/problems/rate-limit-exceeded',
      );
    });

    it('returns 409 SLUG_CONFLICT when slug is already taken', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456708',
        },
        payload: {
          name: 'Conflict Workspace',
          slug: 'conflict-slug',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('SLUG_CONFLICT');
    });

    it('replays cached 201 on same semantic body with different property order and normalizable whitespace via persistence', async () => {
      const { deps, getCreateCallCount } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });
      const idempKey = 'canonical-replay-key-01';

      expect(getCreateCallCount()).toBe(0);

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': idempKey,
        },
        payload: {
          name: '  Canonical Workspace  ',
          slug: 'CANONICAL-WS',
          timezone: ' UTC ',
          brandVoice: '   ',
          aiEnabled: false,
        },
      });
      expect(res1.statusCode).toBe(201);
      const data1 = res1.json();
      expect(getCreateCallCount()).toBe(1);

      // Replay must always invoke persistence (proving no HTTP-layer preflight shortcut)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': idempKey,
        },
        payload: {
          timezone: 'UTC',
          slug: 'canonical-ws',
          name: 'Canonical Workspace',
        },
      });
      expect(res2.statusCode).toBe(201);
      const data2 = res2.json();

      // Persistence was invoked a second time for authoritative reconstruction
      expect(getCreateCallCount()).toBe(2);

      // Typed original workspace properties are returned identically
      expect(data2.id).toBe(data1.id);
      expect(data2.slug).toBe(data1.slug);
      expect(data2.name).toBe('Canonical Workspace');
      expect(data2.timezone).toBe('UTC');
      expect(data2.brandVoice).toBeNull();
      expect(data2.defaultDisclosure).toBeNull();
      expect(data2.aiEnabled).toBe(false);
      expect(data2.role).toBe('owner');
      expect(data2.status).toBe('active');
    });

    it('returns 409 IDEMPOTENCY_KEY_REUSED on repeated Idempotency-Key with different payload', async () => {
      const { deps, getCreateCallCount } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });
      const idempKey = 'conflict-key-01';

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': idempKey,
        },
        payload: { name: 'Idemp WS 1', slug: 'idemp-ws-1', timezone: 'UTC' },
      });
      expect(res1.statusCode).toBe(201);
      expect(getCreateCallCount()).toBe(1);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': idempKey,
        },
        payload: { name: 'Idemp WS 2 Differing', slug: 'idemp-ws-2', timezone: 'UTC' },
      });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(getCreateCallCount()).toBe(2);
    });

    it('accepts hostile user-agent and sanitizes it without failing workspace creation', async () => {
      const { deps, getLastAuditEvent } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': 'hostile-ua-key-01',
          'user-agent': 'Mozilla/5.0\0\r\n\x1b[31mHostile\x1b[0m\tAgent\u200B',
        },
        payload: {
          name: 'Hostile UA WS',
          slug: 'hostile-ua-ws',
          timezone: 'UTC',
        },
      });

      expect(response.statusCode).toBe(201);
      const auditEvent = getLastAuditEvent();
      expect(auditEvent).not.toBeNull();
      expect(auditEvent?.ipHash).toBeNull();
      expect(auditEvent?.userAgentSummary).toBe('Mozilla/5.0[31mHostile[0mAgent');
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId', () => {
    it('returns 401 AUTHENTICATION_REQUIRED when session cookie is missing', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${testWorkspaceId}`,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('returns 400 when workspaceId parameter is malformed', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/workspaces/not-a-uuid',
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 WORKSPACE_NOT_FOUND when caller is not a member (non-disclosure)', async () => {
      const { deps } = createTestWorkspaceDeps();
      const foreignWorkspaceId = '0192b012-3456-789a-8bcd-ef0123456999';
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${foreignWorkspaceId}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns 200 with workspace settings, role, and ETag header when caller is active member', async () => {
      const { deps } = createTestWorkspaceDeps();
      const app = createApp({ auth: deps.auth, workspaces: deps });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${testWorkspaceId}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers.etag).toBe('"1"');

      const data = response.json();
      expect(data.id).toBe(testWorkspaceId);
      expect(data.name).toBe('Existing Workspace');
      expect(data.slug).toBe('existing-workspace');
      expect(data.role).toBe('owner');
      expect(data.status).toBe('active');
    });
  });
});
