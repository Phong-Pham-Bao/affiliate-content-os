import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  MOCK_USER,
  MOCK_WORKSPACE,
  MOCK_POLICY,
  MOCK_PRODUCT,
  MOCK_FACT_SET,
  MOCK_FACTS,
  MOCK_ANALYSIS,
  createMockWorkOrderDetail,
} from './workforce-fixtures.js';

test.describe('Sprint 3 Checkpoint E — Virtual Office & Board Experience', () => {
  let stageIndex = 0;
  const stages: ('planning' | 'scripts' | 'review')[] = ['planning', 'scripts', 'review'];

  test.beforeEach(async ({ page }) => {
    stageIndex = 0;

    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
    page.on('requestfailed', (req) => {
      process.stderr.write(
        `[REQUEST FAILED] ${req.method()} ${req.url()}: ${req.failure()?.errorText}\n`,
      );
    });

    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({ status: 200, json: MOCK_USER });
    });

    await page.route(`**/api/v1/workspaces/${MOCK_WORKSPACE.id}/ai-policy*`, async (route) => {
      await route.fulfill({ status: 200, json: MOCK_POLICY });
    });

    await page.route(
      `**/api/v1/workspaces/${MOCK_WORKSPACE.id}/products/${MOCK_PRODUCT.id}/fact-sets/${MOCK_FACT_SET.id}/facts*`,
      async (route) => {
        await route.fulfill({ status: 200, json: { items: MOCK_FACTS } });
      },
    );

    await page.route(
      `**/api/v1/workspaces/${MOCK_WORKSPACE.id}/products/${MOCK_PRODUCT.id}/fact-sets/${MOCK_FACT_SET.id}`,
      async (route) => {
        await route.fulfill({ status: 200, json: MOCK_FACT_SET });
      },
    );

    await page.route(
      `**/api/v1/workspaces/${MOCK_WORKSPACE.id}/products/${MOCK_PRODUCT.id}/fact-sets*`,
      async (route) => {
        await route.fulfill({
          status: 200,
          json: { items: [MOCK_FACT_SET], page: { nextCursor: null, hasMore: false } },
        });
      },
    );

    await page.route(
      `**/api/v1/workspaces/${MOCK_WORKSPACE.id}/products/${MOCK_PRODUCT.id}/analyses*`,
      async (route) => {
        await route.fulfill({
          status: 200,
          json: { items: [MOCK_ANALYSIS], page: { nextCursor: null, hasMore: false } },
        });
      },
    );

    await page.route(
      `**/api/v1/workspaces/${MOCK_WORKSPACE.id}/products/${MOCK_PRODUCT.id}/affiliate*`,
      async (route) => {
        await route.fulfill({
          status: 200,
          json: { items: [], page: { nextCursor: null, hasMore: false } },
        });
      },
    );

    await page.route(/.*\/api\/v1\/workspaces\/[^/]+\/products\/[^/?]+$/, async (route) => {
      await route.fulfill({ status: 200, json: MOCK_PRODUCT });
    });

    await page.route(/.*\/api\/v1\/workspaces\/[^/]+\/products(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [MOCK_PRODUCT], page: { nextCursor: null, hasMore: false } },
      });
    });

    await page.route(/.*\/api\/v1\/workspaces\/[^/]+\/work-orders(\/.*|\?.*)?$/, async (route) => {
      const url = route.request().url();
      const detail = createMockWorkOrderDetail(stages[stageIndex]!);

      if (url.includes('/artifacts')) {
        const artifacts = [
          {
            id: 'art-1',
            workspaceId: MOCK_WORKSPACE.id,
            productId: MOCK_PRODUCT.id,
            workOrderId: detail.workOrder.id,
            workItemId: 'wi-ps',
            assignmentId: 'as-ps',
            authorRoleKey: 'product_strategist',
            artifactType: 'product_campaign_plan',
            lifecycleStatus: stageIndex >= 1 ? 'accepted' : 'draft',
            currentRevisionNumber: 1,
            createdAt: '2026-11-18T00:01:00Z',
            updatedAt: '2026-11-18T00:01:00Z',
            version: 1,
          },
        ];
        if (stageIndex >= 2) {
          artifacts.push({
            id: 'art-2',
            workspaceId: MOCK_WORKSPACE.id,
            productId: MOCK_PRODUCT.id,
            workOrderId: detail.workOrder.id,
            workItemId: 'wi-sw',
            assignmentId: 'as-sw',
            authorRoleKey: 'scriptwriter',
            artifactType: 'script_package',
            lifecycleStatus: 'review_required',
            currentRevisionNumber: 1,
            createdAt: '2026-11-18T00:04:00Z',
            updatedAt: '2026-11-18T00:04:00Z',
            version: 1,
          });
        }
        await route.fulfill({ status: 200, json: { items: artifacts, nextCursor: null } });
        return;
      }

      if (url.includes('/activity')) {
        await route.fulfill({ status: 200, json: { items: [], nextCursor: null } });
        return;
      }

      if (
        url.includes('?productId=') ||
        url.endsWith('/work-orders') ||
        url.endsWith('/work-orders/')
      ) {
        await route.fulfill({ status: 200, json: { items: [detail.workOrder], nextCursor: null } });
        return;
      }

      await route.fulfill({ status: 200, json: detail });
    });

    await page.route(`**/api/v1/workspaces/${MOCK_WORKSPACE.id}`, async (route) => {
      await route.fulfill({ status: 200, json: MOCK_WORKSPACE });
    });
  });

  test('executes full office/board lifecycle, inspection, deliverables, and reload preservation', async ({
    page,
  }) => {
    await page.goto('/');

    // Select the mock product from the catalog list
    const productItem = page.locator('.product-list-item');
    await expect(productItem).toBeVisible({ timeout: 10000 });
    await productItem.click({ force: true });

    // Verify AI Workforce Command Center is visible in ProductDetailView
    await expect(
      page.getByRole('heading', { name: 'AI Workforce Command Center', level: 3 }),
    ).toBeVisible();

    // Verify Office view displays all 4 department zones and stations
    await expect(page.locator('#zone-strategy-title')).toHaveText('Strategy Room');
    await expect(page.locator('#zone-planning-title')).toHaveText('Planning & Insights Pod');
    await expect(page.locator('#zone-content-title')).toHaveText('Creative & Content Studio');
    await expect(page.locator('#zone-quality-title')).toHaveText('Quality & Compliance Lab');

    // Verify Scriptwriter initial state is waiting on dependency
    const scriptwriterStation = page.locator('#station-scriptwriter');
    await expect(scriptwriterStation).toBeVisible();
    await expect(scriptwriterStation).toContainText('Waiting on: Product Strategist');

    // Switch to Board View
    await page.click('#view-toggle-board', { force: true });
    const boardScriptwriter = page.locator('#board-scriptwriter');
    await expect(boardScriptwriter).toBeVisible();
    await expect(boardScriptwriter).toContainText('Scriptwriter');

    // Inspect Scriptwriter from Board view
    await boardScriptwriter.click({ force: true });

    // Inspector panel should open
    const inspector = page.locator('.employee-inspector-panel');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('Scriptwriter');
    await expect(inspector).toContainText('Role Mandate');
    await expect(inspector).toContainText('Prerequisite Dependencies');

    // Close inspector via close button
    await page.click('button[aria-label="Close Scriptwriter inspector"]', { force: true });
    await expect(inspector).not.toBeVisible();

    // Advance server stage: planning finishes -> scripts
    stageIndex = 1;
    await page.click('button:has-text("Manual Refresh")', { force: true });

    // Scriptwriter now transitions to Running from authoritative server state
    await expect(page.locator('#board-scriptwriter')).toContainText('Running');

    // Switch back to Office View
    await page.click('#view-toggle-office', { force: true });
    await expect(page.locator('#station-scriptwriter')).toHaveClass(/status-running/);

    // Advance to final review stage: script_package produced with review_required
    stageIndex = 2;
    await page.click('button:has-text("Manual Refresh")', { force: true });

    // Deliverables section renders real artifacts grouped by stages
    await expect(page.getByText('Campaign Deliverables & Verified Reports')).toBeVisible();
    await expect(page.getByText('Stage 1: Strategy & Planning Intelligence')).toBeVisible();
    await expect(page.getByText('Stage 2: Scriptwriting & Creative Direction')).toBeVisible();
    await expect(page.getByText('Script Package')).toBeVisible();

    // Verify human action banner appears
    await expect(page.getByText('Human Boss Action Needed:')).toBeVisible();

    // Reload page: server state reconstructed cleanly
    await page.reload();
    await page.locator('.product-list-item').click({ force: true });
    await expect(page.getByText('Script Package')).toBeVisible();
  });

  test('verifies axe accessibility compliance', async ({ page }) => {
    await page.goto('/');

    const productItem = page.locator('.product-list-item');
    await expect(productItem).toBeVisible({ timeout: 10000 });
    await productItem.click({ force: true });

    await expect(
      page.getByRole('heading', { name: 'AI Workforce Command Center', level: 3 }),
    ).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('.workforce-command-center')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const severeViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(severeViolations).toHaveLength(0);
  });
});
