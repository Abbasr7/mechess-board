import { defineConfig } from '@playwright/test';

// Uses the Chrome that is installed on the machine (no browser download needed).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: 'e2e/.results',
  use: {
    baseURL: 'http://localhost:5199',
    channel: 'chrome',
    viewport: { width: 760, height: 760 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite',
    url: 'http://localhost:5199/e2e.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
