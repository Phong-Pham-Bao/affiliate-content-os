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
  MOCK_SCRIPT_PACKAGE_ARTIFACT,
  MOCK_COMPLIANCE_EVALUATION,
  createMockWorkOrderDetail,
  createMockArtifacts,
  createMockActivities,
  type WorkforceE2EStage,
} from './workforce-fixtures.js';

test.describe('Sprint 3 Checkpoint E — Virtual Office & Board Experience', () => {
  let stageIndex = 0;
  const stages: WorkforceE2EStage[] = [
    'planning',
    'script_generation',
    'compliance',
    'review_required',
    'accepted_handoff',
  ];

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

    // Content Studio / Artifact detail mock routes
    await page.route(
      /.*\/api\/v1\/workspaces\/[^/]+\/artifacts\/art-4\/compliance(\?.*)?$/,
      async (route) => {
        await route.fulfill({ status: 200, json: MOCK_COMPLIANCE_EVALUATION });
      },
    );

    await page.route(
      /.*\/api\/v1\/workspaces\/[^/]+\/artifacts\/art-4\/decisions(\?.*)?$/,
      async (route) => {
        await route.fulfill({ status: 200, json: { items: [] } });
      },
    );

    await page.route(
      /.*\/api\/v1\/workspaces\/[^/]+\/artifacts\/art-4\/revisions(\?.*)?$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          json: { items: [MOCK_SCRIPT_PACKAGE_ARTIFACT.latestRevision], nextCursor: null },
        });
      },
    );

    await page.route(/.*\/api\/v1\/workspaces\/[^/]+\/artifacts\/art-4(\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, json: MOCK_SCRIPT_PACKAGE_ARTIFACT });
    });

    // Work order detail, artifacts, and activity mock routes
    await page.route(/.*\/api\/v1\/workspaces\/[^/]+\/work-orders(\/.*|\?.*)?$/, async (route) => {
      const url = route.request().url();
      const currentStage = stages[stageIndex]!;
      const detail = createMockWorkOrderDetail(currentStage);

      if (url.includes('/artifacts')) {
        const artifacts = createMockArtifacts(currentStage);
        await route.fulfill({ status: 200, json: { items: artifacts, nextCursor: null } });
        return;
      }

      if (url.includes('/activity')) {
        const activities = createMockActivities(currentStage);
        await route.fulfill({ status: 200, json: { items: activities, nextCursor: null } });
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

    // Stage 0: Planning — Scriptwriter initial state is waiting on dependency
    const scriptwriterStation = page.locator('#station-scriptwriter');
    await expect(scriptwriterStation).toBeVisible();
    await expect(scriptwriterStation).toContainText('Waiting on: Product Strategist');

    // Verify page does not advance without server response (wait-without-advance proof)
    await page.waitForTimeout(1000);
    await expect(scriptwriterStation).toContainText('Waiting on: Product Strategist');
    await expect(page.locator('.deliverables-section')).not.toBeVisible();

    // Switch to Board View
    await page.click('#view-toggle-board', { force: true });
    const boardScriptwriter = page.locator('#board-scriptwriter');
    await expect(boardScriptwriter).toBeVisible();
    await expect(boardScriptwriter).toContainText('Scriptwriter');

    // Verify background controls and containers are NOT inert prior to modal open
    expect(await page.locator('.workforce-header').evaluate((el) => el.inert)).toBe(false);
    expect(
      await page.locator('#view-toggle-office').evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(false);
    expect(
      await page.locator('#board-chief_of_staff').evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(false);

    // Inspect Scriptwriter from Board view
    await boardScriptwriter.click({ force: true });

    // Inspector panel should open
    const inspector = page.locator('.employee-inspector-panel');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('Scriptwriter');
    await expect(inspector).toContainText('Role Mandate');
    await expect(inspector).toContainText('Prerequisite Dependencies');

    // Behavioral DOM modal isolation assertions (TASK-015-REMEDIATION-02 Requirement 3):
    // Background containers receive inert=true, making descendant controls non-interactable
    expect(await page.locator('.workforce-header').evaluate((el) => el.inert)).toBe(true);
    expect(await page.locator('.operational-status-container').evaluate((el) => el.inert)).toBe(
      true,
    );
    expect(
      await page.locator('#view-toggle-office').evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(true);
    expect(
      await page.locator('#board-chief_of_staff').evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(true);

    // Inspector dialog and close button remain interactive (not inert)
    expect(await inspector.evaluate((el) => el.inert)).toBe(false);
    expect(await inspector.evaluate((el) => Boolean(el.closest('[inert]')))).toBe(false);
    const closeBtn = page.locator('button[aria-label="Close Scriptwriter inspector"]');
    expect(await closeBtn.evaluate((el) => el.inert)).toBe(false);
    expect(await closeBtn.evaluate((el) => Boolean(el.closest('[inert]')))).toBe(false);

    // Close inspector via close button
    await closeBtn.click({ force: true });
    await expect(inspector).not.toBeVisible();

    // Verify background containers and controls are restored to fully interactable (inert=false)
    expect(await page.locator('.workforce-header').evaluate((el) => el.inert)).toBe(false);
    expect(await page.locator('.operational-status-container').evaluate((el) => el.inert)).toBe(
      false,
    );
    expect(
      await page.locator('#view-toggle-office').evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(false);
    expect(
      await page.locator('#board-chief_of_staff').evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(false);

    // Focus restored to the invoking station
    await expect(boardScriptwriter).toBeFocused();

    // Advance server stage: Stage 1 (script_generation)
    stageIndex = 1;
    await page.click('button:has-text("Manual Refresh")', { force: true });

    // Scriptwriter transitions to Running from authoritative server state
    await expect(page.locator('#board-scriptwriter')).toContainText('Running');

    // Switch back to Office View
    await page.click('#view-toggle-office', { force: true });
    await expect(page.locator('#station-scriptwriter')).toHaveClass(/status-running/);

    // Advance to Stage 2: compliance
    stageIndex = 2;
    await page.click('button:has-text("Manual Refresh")', { force: true });
    await expect(page.locator('#station-compliance_reviewer')).toHaveClass(/status-running/);

    // Advance to Stage 3: review_required
    stageIndex = 3;
    await page.click('button:has-text("Manual Refresh")', { force: true });

    // Deliverables section renders real artifacts grouped by stages
    await expect(page.getByText('Campaign Deliverables & Verified Reports')).toBeVisible();
    await expect(page.getByText('Stage 1: Strategy & Planning Intelligence')).toBeVisible();
    await expect(page.getByText('Stage 2: Scriptwriting & Creative Direction')).toBeVisible();
    await expect(page.getByText('Script Package')).toBeVisible();

    // Verify human action banner appears
    await expect(page.getByText('Human Boss Action Needed:')).toBeVisible();

    // Open Script Package deliverable from Deliverables list
    const openDeliverableBtn = page.locator(
      'button[aria-label="Open deliverable: Script Package"]',
    );
    await expect(openDeliverableBtn).toBeVisible();
    await openDeliverableBtn.click({ force: true });

    // Verify Content Studio modal opens with Episode 1 script content and evidence reference
    const contentStudio = page.locator('.content-studio-container');
    await expect(contentStudio).toBeVisible();
    await expect(
      contentStudio.getByRole('heading', { name: /Episode 1: The Sound Test Challenge/ }),
    ).toBeVisible();
    await expect(
      page.getByText('Stop recording bad audio with your phone microphone.'),
    ).toBeVisible();
    await expect(page.getByText('Bằng chứng liên kết')).toBeVisible();

    // Close Content Studio viewer
    const closeStudioBtn = page.locator('button[aria-label="Đóng Content Studio"]');
    await expect(closeStudioBtn).toBeVisible();
    await closeStudioBtn.click({ force: true });
    await expect(contentStudio).not.toBeVisible();

    // Advance to Stage 4: accepted_handoff
    stageIndex = 4;
    await page.click('button:has-text("Manual Refresh")', { force: true });

    // State reflects completed campaign handoff: human action banner dismissed, scriptwriter completed, live summary updated
    await expect(page.getByText('Human Boss Action Needed:')).not.toBeVisible();
    await expect(page.locator('#station-scriptwriter')).toHaveClass(/status-completed/);
    await expect(page.locator('div.sr-only[aria-live="polite"]')).toContainText(
      'All deliverables accepted',
    );

    // Reload page: server state reconstructed cleanly
    await page.reload();
    await page.locator('.product-list-item').click({ force: true });
    await expect(page.getByText('Script Package')).toBeVisible();

    // Keyboard navigation: roving tabindex & Enter to inspect
    const cosStation = page.locator('#station-chief_of_staff');
    await cosStation.focus();
    await expect(cosStation).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('ArrowRight');
    const psStation = page.locator('#station-product_strategist');
    await expect(psStation).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Enter');
    await expect(page.locator('.employee-inspector-panel')).toBeVisible();

    // Verify background isolation active during keyboard-opened modal
    expect(await page.locator('.workforce-header').evaluate((el) => el.inert)).toBe(true);
    expect(
      await page
        .locator('#station-chief_of_staff')
        .evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(true);
    expect(
      await page
        .locator('.employee-inspector-panel')
        .evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(false);

    await page.keyboard.press('Escape');
    await expect(page.locator('.employee-inspector-panel')).not.toBeVisible();

    // Verify background isolation restored on Escape dismiss
    expect(await page.locator('.workforce-header').evaluate((el) => el.inert)).toBe(false);
    expect(
      await page
        .locator('#station-chief_of_staff')
        .evaluate((el) => Boolean(el.closest('[inert]'))),
    ).toBe(false);
    await expect(psStation).toBeFocused();

    // Verify mobile viewport renders without horizontal scroll overflow
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('verifies axe accessibility compliance on initial and populated states', async ({
    page,
  }) => {
    await page.goto('/');

    const productItem = page.locator('.product-list-item');
    await expect(productItem).toBeVisible({ timeout: 10000 });
    await productItem.click({ force: true });

    await expect(
      page.getByRole('heading', { name: 'AI Workforce Command Center', level: 3 }),
    ).toBeVisible();

    // 1. Initial stage Axe audit
    const initialScan = await new AxeBuilder({ page })
      .include('.workforce-command-center')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const initialViolations = initialScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(initialViolations).toHaveLength(0);

    // 2. Advance to populated review_required stage with deliverables and open inspector
    stageIndex = 3;
    await page.click('button:has-text("Manual Refresh")', { force: true });
    await expect(page.getByText('Script Package')).toBeVisible();

    // Open employee inspector
    await page.locator('#station-scriptwriter').click({ force: true });
    await expect(page.locator('.employee-inspector-panel')).toBeVisible();

    // Populated state Axe audit
    const populatedScan = await new AxeBuilder({ page })
      .include('.workforce-command-center')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const populatedViolations = populatedScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(populatedViolations).toHaveLength(0);
  });
});
