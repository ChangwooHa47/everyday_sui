import { defineConfig } from '@playwright/test';

// Browser regression tests with deterministic API fixtures; no wallet, chain or paid providers.
export default defineConfig({
  testDir: './tests/product', workers: 1, timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:13200', viewport: { width: 375, height: 844 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 13200', url: 'http://127.0.0.1:13200/community',
    reuseExistingServer: false, timeout: 90_000,
    // Reuse the existing legacy session seam, only in this test process. Never test login UI here.
    env: { NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:13201', NEXT_PUBLIC_LEGACY_BASELINE: '1' },
  },
});
