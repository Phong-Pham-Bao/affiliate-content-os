import { defineConfig, devices } from '@playwright/test';
import { applyPlaywrightEnvironment, prepareEnvironment } from './scripts/run-with-env.mjs';

prepareEnvironment();
applyPlaywrightEnvironment();

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
      command: 'pnpm exec tsx --conditions=development apps/api/src/main.ts',
      url: 'http://127.0.0.1:3001/health/live',
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        APP_BASE_URL: 'http://localhost:3000',
        AUTH_ENABLED: 'true',
        OIDC_ISSUER: 'https://accounts.google.com',
        OIDC_CLIENT_ID: '465802003876-test.apps.googleusercontent.com',
        OIDC_CLIENT_SECRET: 'GOCSPX-test-client-secret-value-1234',
        OIDC_REDIRECT_URI: 'http://localhost:3001/auth/callback',
        AUTH_TRANSACTION_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        AUTH_TRANSACTION_KEY_VERSION: 'k-2026-v1',
        SOCIAL_AUTH_ENABLED: 'true',
        SOCIAL_FAKE_ADAPTER_ENABLED: 'true',
        SOCIAL_KEY_PROVIDER: 'local',
        SOCIAL_CREDENTIAL_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE',
        SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
        API_PORT: '3001',
        API_HOST: '127.0.0.1',
      },
    },
    {
      command:
        'pnpm --filter @affiliate-content-os/web build && pnpm --filter @affiliate-content-os/web start -p 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        WEB_API_BASE_URL: 'http://127.0.0.1:3001',
        APP_BASE_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
      },
    },
  ],
});
