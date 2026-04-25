import fs from "node:fs"
import path from "node:path"
import {describe, expect, it} from "vitest"

type ReleaseSiteOptions = {
  dryRun: boolean
  skipCloudflare: boolean
  pagesOnly: boolean
  treeName: string
  branch?: string
  pagesProject?: string
  workerName?: string
  routes: string[]
  domains: string[]
  workerCompatibilityDate: string
}

type ReleaseSiteStep = {
  id: string
  label: string
  command: string[]
  cwd: string
  env?: Record<string, string>
}

type StepResult = {
  status: number
  stdout: string
  stderr: string
}

async function importReleaseSiteModule(): Promise<{
  defaultSiteTreeName: string
  releaseE2eTests: string[]
  parseArgs: (argv: string[]) => ReleaseSiteOptions
  createReleasePlan: (options: ReleaseSiteOptions) => {steps: ReleaseSiteStep[]}
  runRelease: (
    options: ReleaseSiteOptions,
    runner?: (step: ReleaseSiteStep) => StepResult | Promise<StepResult>
  ) => Promise<{
    publish: {nhash: string; publishedRef: string}
    pagesUrl: string | null
    pagesProject: string | null
    workerName: string | null
    routes: string[]
    domains: string[]
    treeName: string
  }>
}> {
  // @ts-expect-error local node script is imported dynamically for runtime config testing
  return (await import("../scripts/release-site.mjs")) as {
    defaultSiteTreeName: string
    releaseE2eTests: string[]
    parseArgs: (argv: string[]) => ReleaseSiteOptions
    createReleasePlan: (options: ReleaseSiteOptions) => {steps: ReleaseSiteStep[]}
    runRelease: (
      options: ReleaseSiteOptions,
      runner?: (step: ReleaseSiteStep) => StepResult | Promise<StepResult>
    ) => Promise<{
      publish: {nhash: string; publishedRef: string}
      pagesUrl: string | null
      pagesProject: string | null
      workerName: string | null
      routes: string[]
      domains: string[]
      treeName: string
    }>
  }
}

const distDir = path.resolve(__dirname, "../dist")

async function withDistFixture<T>(run: () => Promise<T>): Promise<T> {
  const distExisted = fs.existsSync(distDir)
  if (!distExisted) {
    fs.mkdirSync(distDir, {recursive: true})
  }
  try {
    return await run()
  } finally {
    if (!distExisted) {
      fs.rmSync(distDir, {recursive: true, force: true})
    }
  }
}

describe("release site config", () => {
  it("uses a site tree name that does not collide with the git remote name", async () => {
    const {defaultSiteTreeName, parseArgs} = await importReleaseSiteModule()
    const parsed = parseArgs([])

    expect(defaultSiteTreeName).toBe("iris-client-site")
    expect(parsed.treeName).toBe(defaultSiteTreeName)
    expect(parsed.treeName).not.toBe("iris-client")
  })

  it("publishes the dist build to the default site tree", async () => {
    const {createReleasePlan, parseArgs} = await importReleaseSiteModule()
    const plan = createReleasePlan(parseArgs([]))
    const publishStep = plan.steps.find((step) => step.id === "publish")

    expect(publishStep).toBeDefined()
    expect(publishStep?.cwd.endsWith("/dist")).toBe(true)
    expect(publishStep?.command[0]).toBe("htree")
    expect(publishStep?.command).not.toContain("--manifest-path")
    expect(publishStep?.command).toContain("iris-client-site")
  })

  it("runs Playwright e2e against the built dist artifact before publishing", async () => {
    const {createReleasePlan, parseArgs, releaseE2eTests} =
      await importReleaseSiteModule()
    const plan = createReleasePlan(parseArgs([]))
    const e2eStepIndex = plan.steps.findIndex((step) => step.id === "test-e2e")
    const publishStepIndex = plan.steps.findIndex((step) => step.id === "publish")
    const deployStepIndex = plan.steps.findIndex((step) => step.id === "deploy")
    const e2eStep = plan.steps[e2eStepIndex]

    expect(e2eStepIndex).toBeGreaterThan(-1)
    expect(e2eStepIndex).toBeLessThan(publishStepIndex)
    expect(e2eStepIndex).toBeLessThan(deployStepIndex)
    expect(e2eStep.command).toEqual([
      "pnpm",
      "exec",
      "playwright",
      "test",
      ...releaseE2eTests,
      "--reporter=list",
    ])
    expect(releaseE2eTests).toContain("tests/popular-feed.spec.ts")
    expect(releaseE2eTests).not.toContain("tests/message-requests-tab.spec.ts")
    expect(releaseE2eTests).not.toContain("tests/devices-current-npub.spec.ts")
    expect(e2eStep.env).toEqual({IRIS_E2E_BUILT_DIST: "true"})
  })

  it("supports tree overrides", async () => {
    const {parseArgs} = await importReleaseSiteModule()
    const parsed = parseArgs(["--tree", "custom-site-tree"])

    expect(parsed.treeName).toBe("custom-site-tree")
  })

  it("runs hashtree publish and Cloudflare deploy in parallel after tests", async () => {
    const {runRelease} = await importReleaseSiteModule()
    let activeReleaseSteps = 0
    let maxActiveReleaseSteps = 0
    const calls: string[] = []

    await withDistFixture(async () => {
      await runRelease(
        {
          dryRun: false,
          skipCloudflare: false,
          pagesOnly: false,
          treeName: "iris-client-site",
          branch: undefined,
          pagesProject: undefined,
          workerName: "iris-client",
          routes: [],
          domains: ["iris.to"],
          workerCompatibilityDate: "2026-03-26",
        },
        async (step) => {
          calls.push(step.id)
          if (step.id === "publish" || step.id === "deploy") {
            activeReleaseSteps += 1
            maxActiveReleaseSteps = Math.max(maxActiveReleaseSteps, activeReleaseSteps)
            await new Promise((resolve) => setTimeout(resolve, 10))
            activeReleaseSteps -= 1
            if (step.id === "publish") {
              return {
                status: 0,
                stdout: "published: npub1example/iris-client-site\nnhash1ace",
                stderr: "",
              }
            }
          }
          return {status: 0, stdout: "", stderr: ""}
        }
      )
    })

    expect(calls).toEqual([
      "build",
      "test-portable",
      "test-smoke",
      "test-e2e",
      "publish",
      "deploy",
    ])
    expect(maxActiveReleaseSteps).toBe(2)
  })
})
