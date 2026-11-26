import { defineConfig } from '@playwright/test';

const adminBaseURL = process.env.ADMIN_BASE_URL || process.env.E2E_ADMIN_URL || 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e/admin',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: adminBaseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
});
