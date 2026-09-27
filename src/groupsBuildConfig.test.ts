import {execFileSync} from "node:child_process"
import {describe, expect, it, vi} from "vitest"

function resolveVariant(environment: string) {
  const source = `
    import {resolveConfig} from "vite";
    const config = await resolveConfig({logLevel: "silent"}, "build", "production");
    const branding = config.plugins.find((plugin) => plugin.name === "app-branding");
    const pwa = config.plugins.find((plugin) => plugin.name === "vite-plugin-pwa");
    const html = branding.transformIndexHtml.handler('<title></title><link rel="manifest" href="./manifest.json" />');
    console.log(JSON.stringify({app: JSON.parse(config.define.CONFIG), outDir: config.build.outDir, html, manifest: pwa.api.webManifestData()?.href}));
  `
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: process.cwd(),
      env: {...process.env, NODE_CONFIG_ENV: environment},
      encoding: "utf8",
    })
  )
}

describe("Groups build", () => {
  it("selects Groups branding and an isolated output while preserving shared account settings", () => {
    const groups = resolveVariant("groups")
    expect(groups.app).toMatchObject({
      appVariant: "groups",
      appName: "Groups",
      hostname: "groups.iris.to",
      nip05Domain: "iris.to",
      defaultSettings: {irisApiUrl: "https://api.iris.to"},
    })
    expect(groups.app.navItems).toContain("groups")
    expect(groups.app.navItems).not.toContain("home")
    expect(groups.outDir).toBe("dist-groups")
    expect(groups.html).toBe("<title>Iris Groups</title>")
    expect(groups.manifest).toBe("./manifest.json")
  })

  it("keeps the ordinary Iris build and its existing manifest", () => {
    const iris = resolveVariant("production")
    expect(iris.app.appVariant).toBe("iris")
    expect(iris.outDir).toBe("dist")
    expect(iris.html).toContain('<link rel="manifest" href="./manifest.json" />')
    expect(iris.manifest).toBeUndefined()
  })

  it("stops a Groups release when a validation step fails", async () => {
    // @ts-expect-error The release entry point is a plain Node script.
    const {runRelease} = await import("../scripts/release-groups.mjs")
    const runner = vi.fn().mockReturnValueOnce({status: 0}).mockReturnValue({status: 1})
    expect(() => runRelease({}, runner)).toThrow("failed")
    expect(runner).toHaveBeenCalledTimes(2)
    expect(runner.mock.calls.some((call) => call[1].includes("deploy"))).toBe(false)
  })
})
