import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'docs/evidence/playwright-report', open: 'never' }]],
  outputDir: 'docs/evidence/playwright-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    // Auth network traces can contain access tokens; use screenshots and reports.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
