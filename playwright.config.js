import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: {
    timeout: 7000,
  },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    viewport: { width: 1400, height: 860 },
  },
  webServer: {
    command: "npm run dev:test -- --port 3100 --strictPort",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Shared exports must also boot in WebKit, which refuses module scripts
    // served from data: URLs.
    {
      name: "webkit-export",
      testMatch: /export-portability\.spec\.js/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
