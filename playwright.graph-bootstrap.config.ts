import {defineConfig, devices} from "@playwright/test"

const built = process.env.IRIS_E2E_BUILT_DIST === "true"
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "graph-bootstrap.spec.ts",
    "graph-cold-start.spec.ts",
    "social-graph-merge.spec.ts",
  ],
  workers: 1,
  timeout: 60000,
  reporter: "list",
  outputDir: "test-results/graph-bootstrap",
  use: {
    baseURL: "http://127.0.0.1:5191",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  webServer: {
    command: built
      ? `pnpm exec vite preview --host 127.0.0.1 --port 5191 --strictPort --outDir ${process.env.IRIS_GRAPH_DIST ?? "dist"}`
      : "pnpm exec vite --host 127.0.0.1 --port 5191 --strictPort",
    url: "http://127.0.0.1:5191",
    reuseExistingServer: false,
    env: {VITE_USE_LOCAL_RELAY: "true", VITE_E2E: "true"},
  },
})
