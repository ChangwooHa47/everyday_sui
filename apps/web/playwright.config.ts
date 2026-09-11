import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:13000',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: process.env.PLAYWRIGHT_CHROMIUM === '1' ? undefined : 'msedge',
  },
  webServer: {
    command: 'npm run start:baseline',
    url: 'http://127.0.0.1:13000',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
