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

async function importReleaseSiteModule(): Promise<{
  defaultSiteTreeName: string
  parseArgs: (argv: string[]) => ReleaseSiteOptions
  createReleasePlan: (options: ReleaseSiteOptions) => {steps: ReleaseSiteStep[]}
}> {
  // @ts-expect-error local node script is imported dynamically for runtime config testing
  return (await import("../scripts/release-site.mjs")) as {
    defaultSiteTreeName: string
    parseArgs: (argv: string[]) => ReleaseSiteOptions
    createReleasePlan: (options: ReleaseSiteOptions) => {steps: ReleaseSiteStep[]}
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
})
