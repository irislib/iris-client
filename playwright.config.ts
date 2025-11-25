import {defineConfig, devices} from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    video: "on-first-retry",
    headless: true,
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: [
        "--enable-precise-memory-info",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--ignore-certificate-errors",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: "VITE_USE_TEST_RELAY=true yarn dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_USE_TEST_RELAY: "true",
    },
  },
})
