import { defineConfig, devices } from '@playwright/test';
import { prepareEnvironment } from './scripts/run-with-env.mjs';

prepareEnvironment();

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        viewport: { width: 320, height: 568 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        contextOptions: {
          reducedMotion: 'reduce',
        },
      },
    },
  ],
  webServer: [
    {
      command: 'node scripts/run-with-env.mjs tsx apps/api/src/main.ts',
      url: 'http://127.0.0.1:3001/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        APP_BASE_URL: 'http://localhost:3000',
        SOCIAL_AUTH_ENABLED: 'true',
        SOCIAL_FAKE_ADAPTER_ENABLED: 'true',
        SOCIAL_KEY_PROVIDER: 'local',
        SOCIAL_CREDENTIAL_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE',
        SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
      },
    },
    {
      command:
        'node scripts/run-with-env.mjs pnpm --filter @affiliate-content-os/web start -p 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        WEB_API_BASE_URL: 'http://127.0.0.1:3001',
      },
    },
  ],
});
