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
}

type StepResult = {
  status: number
  stdout: string
  stderr: string
}

async function importReleaseSiteModule(): Promise<{
  defaultSiteTreeName: string
  parseArgs: (argv: string[]) => ReleaseSiteOptions
  createReleasePlan: (options: ReleaseSiteOptions) => {steps: ReleaseSiteStep[]}
  runRelease: (
    options: ReleaseSiteOptions,
    runner?: (step: ReleaseSiteStep) => StepResult | Promise<StepResult>,
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
    parseArgs: (argv: string[]) => ReleaseSiteOptions
    createReleasePlan: (options: ReleaseSiteOptions) => {steps: ReleaseSiteStep[]}
    runRelease: (
      options: ReleaseSiteOptions,
      runner?: (step: ReleaseSiteStep) => StepResult | Promise<StepResult>,
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
    expect(publishStep?.command).toContain("iris-client-site")
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
      },
    )

    expect(calls).toEqual(["build", "test-portable", "test-smoke", "publish", "deploy"])
    expect(maxActiveReleaseSteps).toBe(2)
  })
})
