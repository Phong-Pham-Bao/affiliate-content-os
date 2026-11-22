import { describe, expect, it, vi } from 'vitest';
import { loadConfig, loadSocialConfig } from '@affiliate-content-os/config';
import { DefaultIdGenerator, SystemClock } from '@affiliate-content-os/application';
import { createRouteProviders } from '../src/route-providers.js';
import { createApp } from '../src/app.js';
import { createTestAuthConfig } from './helpers/auth-test-fakes.js';
import { createTestPublicationDeps, TEST_WORKSPACE_ID } from './helpers/publication-test-deps.js';

describe('Publication Composition and Architecture (TASK-018 Phase B)', () => {
  it('registers publicationProvider in createRouteProviders without any SocialPublicationAdapter in HTTP deps', async () => {
    const rawEnv = {
      NODE_ENV: 'test',
      AUTH_ENABLED: 'false',
      SOCIAL_AUTH_ENABLED: 'false',
    };
    const config = loadConfig(rawEnv);
    const socialConfig = loadSocialConfig(rawEnv, config.nodeEnv);

    const mockDatabase = {
      probe: vi.fn(),
      close: vi.fn(),
      query: vi.fn(),
      withTransaction: vi.fn(),
      isClosing: vi.fn(() => false),
    };
    const mockTenancyAdapter = {};
    const mockCatalogAdapter = {};
    const mockAnalysisAdapter = {};
    const mockWorkforceAdapter = {};
    const mockSocialPersistence = {};
    const mockPublicationPersistence = {};
    const clock = new SystemClock();
    const idGenerator = new DefaultIdGenerator();

    const providers = createRouteProviders({
      database: mockDatabase as never,
      tenancyAdapter: mockTenancyAdapter as never,
      catalogAdapter: mockCatalogAdapter as never,
      analysisAdapter: mockAnalysisAdapter as never,
      workforceAdapter: mockWorkforceAdapter as never,
      socialPersistence: mockSocialPersistence as never,
      publicationPersistence: mockPublicationPersistence as never,
      socialAdapters: new Map(),
      clock,
      idGenerator,
      config,
      authConfig: createTestAuthConfig({ enabled: false }),
      aiConfig: { enabled: false } as never,
      socialConfig,
    });

    expect(typeof providers.publicationProvider).toBe('function');

    const abortController = new AbortController();
    const pubDeps = await providers.publicationProvider(abortController.signal);

    expect(pubDeps).toBeDefined();
    expect(pubDeps.publicationPersistence).toBe(mockPublicationPersistence);
    expect(pubDeps.workspaceAuthorization).toBe(mockTenancyAdapter);
    expect(pubDeps.clock).toBe(clock);
    expect(pubDeps.socialConfig).toBe(socialConfig);

    // Architectural boundary assertion: HTTP dependencies must not carry any publication adapter or provider call
    expect(pubDeps).not.toHaveProperty('publicationAdapter');
    expect(pubDeps).not.toHaveProperty('socialPublicationAdapter');
    expect(pubDeps).not.toHaveProperty('adapter');
    expect('publicationAdapter' in (pubDeps as unknown as Record<string, unknown>)).toBe(false);
  });

  it('wires publication routes into createApp when options.publication is provided', async () => {
    const { deps } = createTestPublicationDeps();
    const appWithPub = createApp({ auth: deps.auth, publication: deps });

    // Ensure all 6 registered routes respond according to route definition (not 404)
    const resApproval = await appWithPub.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publication-approvals`,
    });
    expect(resApproval.statusCode).not.toBe(404);

    const resSchedule = await appWithPub.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications`,
    });
    expect(resSchedule.statusCode).not.toBe(404);

    const resList = await appWithPub.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications`,
    });
    expect(resList.statusCode).toBe(401);

    const resDetail = await appWithPub.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications/0192b012-3456-789a-8bcd-ef0123456713`,
    });
    expect(resDetail.statusCode).toBe(401);

    const resPatch = await appWithPub.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications/0192b012-3456-789a-8bcd-ef0123456713`,
    });
    expect(resPatch.statusCode).not.toBe(404);

    const resCancel = await appWithPub.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications/0192b012-3456-789a-8bcd-ef0123456713/cancel`,
    });
    expect(resCancel.statusCode).not.toBe(404);
  });

  it('omits publication routes when options.publication is omitted', async () => {
    const { deps } = createTestPublicationDeps();
    const appWithoutPub = createApp({ auth: deps.auth });

    const res = await appWithoutPub.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications`,
    });
    expect(res.statusCode).toBe(404);
  });
});
