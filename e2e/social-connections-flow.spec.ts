import { test, expect } from '@playwright/test';
import { MOCK_USER, MOCK_WORKSPACE } from './workforce-fixtures.js';

const OWNER_USER = {
  ...MOCK_USER,
  workspaceAccess: {
    items: [
      {
        id: MOCK_WORKSPACE.id,
        name: MOCK_WORKSPACE.name,
        slug: MOCK_WORKSPACE.slug,
        timezone: MOCK_WORKSPACE.timezone,
        role: 'owner' as const,
      },
    ],
    hasMore: false,
  },
};

const OWNER_WORKSPACE = {
  ...MOCK_WORKSPACE,
  role: 'owner' as const,
};

const VIEWER_USER = {
  ...MOCK_USER,
  workspaceAccess: {
    items: [
      {
        id: MOCK_WORKSPACE.id,
        name: MOCK_WORKSPACE.name,
        slug: MOCK_WORKSPACE.slug,
        timezone: MOCK_WORKSPACE.timezone,
        role: 'viewer' as const,
      },
    ],
    hasMore: false,
  },
};

const VIEWER_WORKSPACE = {
  ...MOCK_WORKSPACE,
  role: 'viewer' as const,
};

test.describe('Social Connections Flow (TASK-016 Remediation)', () => {
  test('Local fake flow: owner initiates connect, authorizes via fake provider, and sees local badge', async ({
    page,
  }) => {
    let accounts: unknown[] = [];

    // Mock session as owner
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({ status: 200, json: OWNER_USER });
    });

    await page.route(/.*\/api\/v1\/workspaces\/[^/]+$/, async (route) => {
      await route.fulfill({ status: 200, json: OWNER_WORKSPACE });
    });

    await page.route('**/api/v1/workspaces/*/social-accounts', async (route) => {
      await route.fulfill({ status: 200, json: { items: accounts } });
    });

    await page.route('**/api/v1/workspaces/*/ai-policy*', async (route) => {
      await route.fulfill({ status: 200, json: { aiEnabled: true } });
    });

    await page.route('**/api/v1/workspaces/*/products*', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], page: { nextCursor: null, hasMore: false } },
      });
    });

    // Mock authorize endpoint
    await page.route(
      '**/api/v1/workspaces/*/social-connections/threads/authorize',
      async (route) => {
        await route.fulfill({
          status: 200,
          json: {
            transactionId: 'tx-fake-threads-1',
            authorizationUrl:
              'http://localhost:3000/fake-social-auth?platform=threads&state=test_state_threads_12345678&redirect_uri=%2Fapi%2Fv1%2Fsocial-connections%2Fthreads%2Fcallback',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
          },
        });
      },
    );

    // Mock callback endpoint
    await page.route('**/api/v1/social-connections/threads/callback*', async (route) => {
      // Simulate redirect to returnTo with connection_result
      await route.fulfill({
        status: 302,
        headers: {
          Location: '/?connection_result=res_key_success_123',
        },
      });
    });

    // Mock callback result consumption
    await page.route(
      '**/api/v1/workspaces/*/social-connections/callback-results/res_key_success_123',
      async (route) => {
        // Once consumed, add account to accounts list
        accounts = [
          {
            id: 'acc-threads-e2e',
            workspaceId: OWNER_WORKSPACE.id,
            platform: 'threads',
            providerAccountId: 'threads_user_e2e',
            displayName: 'E2E Threads Creator',
            handle: '@threads_e2e',
            status: 'active',
            grantedScopes: ['threads_basic', 'threads_content_publish'],
            capabilities: { canPublishText: true, canPublishMedia: false },
            capabilitiesCheckedAt: new Date().toISOString(),
            tokenExpiresAt: null,
            environment: 'local',
            connectedByUserId: OWNER_USER.user.id,
            disconnectedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          },
        ];

        await route.fulfill({
          status: 200,
          json: {
            id: 'res-e2e-1',
            status: 'success',
            platform: 'threads',
            socialAccountId: 'acc-threads-e2e',
            errorCode: null,
            errorDescription: null,
          },
        });
      },
    );

    // 1. Visit main page
    await page.goto('/');

    // 2. Locate connections panel
    const connectThreadsBtn = page.locator('.btn-connect-threads');
    await expect(connectThreadsBtn).toBeVisible();

    // 3. Click connect Threads
    await connectThreadsBtn.click();

    // 4. Verify landing on fake provider page
    await expect(page).toHaveURL(/.*\/fake-social-auth\?platform=threads.*/);
    await expect(page.getByText('Xác thực thử nghiệm (Fake OAuth Provider)')).toBeVisible();
    await expect(page.getByText('LOCAL')).toBeVisible();

    // 5. Click Authorize
    const authorizeBtn = page.getByRole('button', { name: 'Chấp thuận kết nối (Authorize)' });
    await expect(authorizeBtn).toBeVisible();
    await authorizeBtn.click();

    // 6. Verify returning to main page with success banner
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Kết nối tài khoản THREADS thành công!')).toBeVisible();

    // 7. Verify account card is rendered with local badge and handle
    await expect(page.getByText('E2E Threads Creator')).toBeVisible();
    await expect(page.getByText('@threads_e2e')).toBeVisible();
    await expect(page.getByText('Local/Test')).toBeVisible();
  });

  test('Deny flow: owner clicks Deny on fake provider and sees failure alert', async ({ page }) => {
    // Mock session as owner
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({ status: 200, json: OWNER_USER });
    });

    await page.route(/.*\/api\/v1\/workspaces\/[^/]+$/, async (route) => {
      await route.fulfill({ status: 200, json: OWNER_WORKSPACE });
    });

    await page.route('**/api/v1/workspaces/*/social-accounts', async (route) => {
      await route.fulfill({ status: 200, json: { items: [] } });
    });

    await page.route('**/api/v1/workspaces/*/ai-policy*', async (route) => {
      await route.fulfill({ status: 200, json: { aiEnabled: true } });
    });

    await page.route('**/api/v1/workspaces/*/products*', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], page: { nextCursor: null, hasMore: false } },
      });
    });

    // Mock authorize endpoint for TikTok
    await page.route(
      '**/api/v1/workspaces/*/social-connections/tiktok/authorize',
      async (route) => {
        await route.fulfill({
          status: 200,
          json: {
            transactionId: 'tx-fake-tiktok-1',
            authorizationUrl:
              'http://localhost:3000/fake-social-auth?platform=tiktok&state=test_state_tiktok_12345678&redirect_uri=%2Fapi%2Fv1%2Fsocial-connections%2Ftiktok%2Fcallback',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
          },
        });
      },
    );

    // Mock callback endpoint for deny
    await page.route('**/api/v1/social-connections/tiktok/callback*', async (route) => {
      await route.fulfill({
        status: 302,
        headers: {
          Location: '/?connection_result=res_key_denied_456',
        },
      });
    });

    // Mock callback result consumption for denied
    await page.route(
      '**/api/v1/workspaces/*/social-connections/callback-results/res_key_denied_456',
      async (route) => {
        await route.fulfill({
          status: 200,
          json: {
            id: 'res-e2e-2',
            status: 'failed',
            platform: 'tiktok',
            socialAccountId: null,
            errorCode: 'access_denied',
            errorDescription: 'The authorization request was denied.',
          },
        });
      },
    );

    // 1. Visit main page
    await page.goto('/');

    // 2. Click connect TikTok
    const connectTikTokBtn = page.locator('.btn-connect-tiktok');
    await expect(connectTikTokBtn).toBeVisible();
    await connectTikTokBtn.click();

    // 3. Verify landing on fake provider page
    await expect(page).toHaveURL(/.*\/fake-social-auth\?platform=tiktok.*/);

    // 4. Click Deny
    const denyBtn = page.getByRole('button', { name: 'Từ chối (Deny)' });
    await expect(denyBtn).toBeVisible();
    await denyBtn.click();

    // 5. Verify returning to main page with failure alert
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText('Kết nối thất bại: The authorization request was denied.'),
    ).toBeVisible();
  });

  test('Role gating: viewer cannot initiate connect', async ({ page }) => {
    // Mock session as viewer
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({ status: 200, json: VIEWER_USER });
    });

    await page.route(/.*\/api\/v1\/workspaces\/[^/]+$/, async (route) => {
      await route.fulfill({ status: 200, json: VIEWER_WORKSPACE });
    });

    await page.route('**/api/v1/workspaces/*/social-accounts', async (route) => {
      await route.fulfill({ status: 200, json: { items: [] } });
    });

    await page.route('**/api/v1/workspaces/*/products*', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], page: { nextCursor: null, hasMore: false } },
      });
    });

    await page.goto('/');

    // Verify connect buttons are not present
    await expect(page.locator('.btn-connect-threads')).not.toBeVisible();
    await expect(page.locator('.btn-connect-tiktok')).not.toBeVisible();

    // Verify owner-only notice is displayed
    await expect(
      page.getByText('Chỉ Chủ sở hữu (Owner) mới có quyền kết nối tài khoản mới.'),
    ).toBeVisible();
  });

  test('Fake auth security: open redirect attempts are rejected', async ({ page }) => {
    await page.goto(
      '/fake-social-auth?platform=threads&state=12345678&redirect_uri=https://evil.com/callback',
    );

    await expect(
      page.getByText('Địa chỉ chuyển hướng không hợp lệ (Invalid Redirect Target)'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Chấp thuận kết nối (Authorize)' }),
    ).not.toBeVisible();
  });
});
