import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { MOCK_USER, MOCK_WORKSPACE } from './workforce-fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const infraRequire = createRequire(
  path.resolve(__dirname, '../packages/infrastructure/package.json'),
);
const pg = infraRequire('pg');
const { generateUuidV7 } = infraRequire('@affiliate-content-os/application');

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

const dbUrl =
  process.env.DATABASE_URL ?? 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev';

interface E2EPool {
  query: <R = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rowCount: number | null; rows: R[] }>;
  end: () => Promise<void>;
}

let poolInstance: E2EPool | null = null;
function getPool(): E2EPool {
  if (!poolInstance) {
    poolInstance = new pg.Pool({ connectionString: dbUrl }) as E2EPool;
  }
  return poolInstance;
}

async function seedE2EState(role: 'owner' | 'viewer' = 'owner') {
  const pool = getPool();
  const userId = generateUuidV7();
  const workspaceId = generateUuidV7();
  const membershipId = generateUuidV7();
  const sessionId = generateUuidV7();
  const sessionTokenBytes = crypto.randomBytes(32);
  const sessionToken = sessionTokenBytes.toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(sessionToken, 'utf8').digest();
  const slug = `e2e-${workspaceId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  await pool.query(
    `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at)
     VALUES ($1, 'google', $2, $3, 'E2E User', 'active', NOW(), NOW())`,
    [userId, `sub_${userId}`, `e2e_${userId}@example.com`],
  );

  await pool.query(
    `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at)
     VALUES ($1, 'E2E Workspace', $2, 'UTC', 'active', NOW(), NOW())`,
    [workspaceId, slug],
  );

  await pool.query(
    `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), NOW())`,
    [membershipId, workspaceId, userId, role],
  );

  await pool.query(
    `INSERT INTO application_sessions (
       id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
       created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
       revoked_at, revocation_reason, version
     ) VALUES ($1, $2, $3, NULL, NULL, NOW(), NOW(), NOW() + interval '1 day', NOW() + interval '7 days', NOW(), NULL, NULL, 1)`,
    [sessionId, userId, tokenHash],
  );

  await pool.query(
    `INSERT INTO workspace_ai_policies (workspace_id, ai_enabled)
     VALUES ($1, false)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId],
  );

  return { userId, workspaceId, sessionId, sessionToken };
}

async function cleanupE2EState(workspaceId: string, userId: string) {
  const pool = getPool();
  try {
    await pool.query(`DELETE FROM application_sessions WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM oauth_callback_results WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM oauth_transactions WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM social_credentials WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM social_accounts WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM audit_events WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_ai_policies WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  } catch {
    // Non-blocking cleanup
  }
}

test.describe('Social Connections Flow (TASK-016 Remediation 02)', () => {
  test.afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
      poolInstance = null;
    }
  });

  test('Real end-to-end fake flow: owner connects Threads account through real API, fake provider, callback, and verified local badge', async ({
    page,
    context,
  }) => {
    const { userId, workspaceId, sessionToken } = await seedE2EState('owner');
    try {
      await context.addCookies([
        {
          name: 'acos_session',
          value: sessionToken,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/');

      // Verify connection panel loads with empty state and connect button
      const connectThreadsBtn = page.locator('.btn-connect-threads');
      await expect(connectThreadsBtn).toBeVisible({ timeout: 10000 });

      // Click connect Threads -> real API authorize -> navigates to fake provider
      await connectThreadsBtn.click();

      // Verify fake provider page renders with local environment
      await expect(page).toHaveURL(/.*\/fake-social-auth\?platform=threads.*/);
      await expect(page.getByText('Xác thực thử nghiệm (Fake OAuth Provider)')).toBeVisible();
      await expect(page.getByText('LOCAL')).toBeVisible();

      // Click Authorize -> real API callback -> exchangeCode -> DB persist -> redirect to /?connection_result=...
      const authorizeBtn = page.getByRole('button', { name: 'Chấp thuận kết nối (Authorize)' });
      await expect(authorizeBtn).toBeVisible();
      await authorizeBtn.click();

      // Verify return to application shell with success banner
      await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
      await expect(page.getByText('Kết nối tài khoản THREADS thành công!')).toBeVisible({
        timeout: 15000,
      });

      // Verify account card is rendered with local/test badge and handle
      await expect(page.getByText('Fake Threads Creator')).toBeVisible();
      await expect(page.getByText('Local/Test')).toBeVisible();
      await expect(page.getByText('Đang hoạt động')).toBeVisible();

      // Verify persistence in PostgreSQL
      const accRes = await getPool().query(
        `SELECT id, status, environment, platform FROM social_accounts WHERE workspace_id = $1 AND platform = 'threads'`,
        [workspaceId],
      );
      expect(accRes.rowCount).toBe(1);
      expect(accRes.rows[0]?.status).toBe('active');
      expect(accRes.rows[0]?.environment).toBe('local');

      const credRes = await getPool().query(
        `SELECT access_token_ciphertext FROM social_credentials WHERE workspace_id = $1`,
        [workspaceId],
      );
      expect(credRes.rowCount).toBe(1);
      expect(credRes.rows[0]?.access_token_ciphertext).not.toBeNull();

      // Verify audit evidence in PostgreSQL
      const auditRes = await getPool().query(
        `SELECT action FROM audit_events WHERE workspace_id = $1 ORDER BY occurred_at ASC`,
        [workspaceId],
      );
      const actions = auditRes.rows.map((r) => r.action);
      expect(actions).toContain('social_connection.authorization_claimed');
      expect(actions).toContain('social_connection.completed');
    } finally {
      await cleanupE2EState(workspaceId, userId);
    }
  });

  test('Real end-to-end deny flow: owner clicks Deny on fake provider and observes safe failure banner', async ({
    page,
    context,
  }) => {
    const { userId, workspaceId, sessionToken } = await seedE2EState('owner');
    try {
      await context.addCookies([
        {
          name: 'acos_session',
          value: sessionToken,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/');

      const connectThreadsBtn = page.locator('.btn-connect-threads');
      await expect(connectThreadsBtn).toBeVisible({ timeout: 10000 });
      await connectThreadsBtn.click();

      await expect(page).toHaveURL(/.*\/fake-social-auth\?platform=threads.*/);

      // Click Deny button -> real API callback with access_denied
      const denyBtn = page.getByRole('button', { name: 'Từ chối (Deny)' });
      await expect(denyBtn).toBeVisible();
      await denyBtn.click();

      // Verify return to application shell with failure banner
      await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
      await expect(page.getByText(/Kết nối thất bại:/)).toBeVisible({ timeout: 15000 });

      // Verify audit failure in PostgreSQL
      const auditRes = await getPool().query(
        `SELECT action, reason_code FROM audit_events WHERE workspace_id = $1 AND action = 'social_connection.failed'`,
        [workspaceId],
      );
      expect(auditRes.rowCount).toBe(1);
      expect(auditRes.rows[0]?.reason_code).toBe('access_denied');
    } finally {
      await cleanupE2EState(workspaceId, userId);
    }
  });

  test('UI contract test: role gating: viewer cannot initiate connect', async ({ page }) => {
    // Mock session as viewer for UI role testing
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

  test('UI contract test: fake auth security: open redirect attempts are rejected', async ({
    page,
  }) => {
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
