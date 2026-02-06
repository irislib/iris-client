import {defineConfig, devices} from "@playwright/test"

const usingTestRelay =
  process.env.VITE_USE_TEST_RELAY === "true" || process.env.VITE_USE_TEST_RELAY === "1"

// Default to local relay for E2E runs unless explicitly told to use the test relay.
const usingLocalRelay = !usingTestRelay

const vitePort = (() => {
  const raw = process.env.IRIS_E2E_PORT
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  // Use a non-default port locally to avoid accidentally reusing a dev server.
  return process.env.CI ? 5173 : 5175
})()

const baseURL = `http://127.0.0.1:${vitePort}`

// Avoid noisy Node warnings when Playwright forces colored output (NO_COLOR vs FORCE_COLOR).
const webServerEnv = {...process.env, FORCE_COLOR: "0"}

const relaySeedCount = (() => {
  const raw = process.env.IRIS_RELAY_SEED_COUNT
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return n
  }
  // Default to no seed to keep E2E fast and deterministic.
  // Opt-in seeding: set IRIS_RELAY_SEED_COUNT=80000 (requires bzip2).
  return 0
})()

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: "100%",
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "on-first-retry",
    launchOptions: {
      args: ["--enable-precise-memory-info"],
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
  webServer: [
    ...(usingLocalRelay
      ? [
          {
            command: `pnpm relay:start -- --seed ${relaySeedCount} --port 7777`,
            url: "http://127.0.0.1:7777/health",
            reuseExistingServer: false,
            timeout: 5 * 60 * 1000,
            env: webServerEnv,
          },
        ]
      : []),
    {
      // Force a dedicated dev server for E2E (avoid reusing an unrelated local dev server).
      command: `pnpm exec vite --host 127.0.0.1 --port ${vitePort} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      env: {
        ...webServerEnv,
        // Used in the app for small test-only layout affordances.
        VITE_E2E: "true",
        ...(usingLocalRelay ? {VITE_USE_LOCAL_RELAY: "true"} : {}),
        ...(usingTestRelay ? {VITE_USE_TEST_RELAY: "true"} : {}),
      },
    },
  ],
})
