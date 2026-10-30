import { defineConfig } from '@playwright/test';

const baseURL = process.env.HOMECOMPASS_E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './live-e2e',
  testMatch: '**/*.live.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.HOMECOMPASS_E2E_OUTPUT_DIR || '/private/tmp/homecompass-auth-live-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
