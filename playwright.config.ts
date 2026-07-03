import { defineConfig } from '@playwright/test';

// Slice 0: a single Electron boot smoke test. Playwright drives the real
// Electron app (via _electron), not a browser, so no browser download is needed.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  outputDir: 'test-results',
});
