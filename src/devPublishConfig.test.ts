import {describe, expect, it} from "vitest"

type DevPublishOptions = {
  treeName: string
  skipBuild: boolean
  dryRun: boolean
}

type DevPublishStep = {
  id: string
  label: string
  command: string[]
  cwd: string
}

async function importDevPublishModule(): Promise<{
  parseArgs: (argv: string[]) => DevPublishOptions
  createDevPublishPlan: (options: DevPublishOptions) => {steps: DevPublishStep[]}
}> {
  // @ts-expect-error local node script is imported dynamically for runtime config testing
  return (await import("../scripts/devpublish-iris.mjs")) as {
    parseArgs: (argv: string[]) => DevPublishOptions
    createDevPublishPlan: (options: DevPublishOptions) => {steps: DevPublishStep[]}
  }
}

describe("dev publish config", () => {
  it("uses iris-client-dev by default", async () => {
    const {parseArgs} = await importDevPublishModule()
    const parsed = parseArgs([])

    expect(parsed.treeName).toBe("iris-client-dev")
    expect(parsed.skipBuild).toBe(false)
    expect(parsed.dryRun).toBe(false)
  })

  it("supports tree override and skip-build", async () => {
    const {parseArgs} = await importDevPublishModule()
    const parsed = parseArgs(["--tree", "custom-dev-tree", "--skip-build", "--dry-run"])

    expect(parsed.treeName).toBe("custom-dev-tree")
    expect(parsed.skipBuild).toBe(true)
    expect(parsed.dryRun).toBe(true)
  })

  it("plans build and publish steps by default", async () => {
    const {createDevPublishPlan, parseArgs} = await importDevPublishModule()
    const plan = createDevPublishPlan(parseArgs([]))

    expect(plan.steps.map((step) => step.id)).toEqual(["build", "publish"])
    expect(plan.steps[0].command).toEqual(["pnpm", "run", "build"])
    expect(plan.steps[1].command).toContain("iris-client-dev")
  })

  it("can skip the build step", async () => {
    const {createDevPublishPlan, parseArgs} = await importDevPublishModule()
    const plan = createDevPublishPlan(parseArgs(["--skip-build"]))

    expect(plan.steps.map((step) => step.id)).toEqual(["publish"])
  })
})
