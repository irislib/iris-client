import {readFileSync} from "node:fs"
import path from "node:path"

import {describe, expect, it} from "vitest"

function readRootFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
}

function stripInlineScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
}

function getAttributeValues(html: string, attribute: "href" | "src"): string[] {
  return [...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map(
    (match) => match[1]
  )
}

describe("portable build config", () => {
  it("uses a relative base outside GitHub Pages builds", () => {
    const viteConfig = readRootFile("vite.config.ts")

    expect(viteConfig).toContain('base: "./"')
  })

  it("keeps worker-first routing limited to .well-known requests", () => {
    const wranglerConfig = readRootFile("wrangler.jsonc")

    expect(wranglerConfig).toContain('"run_worker_first": ["/.well-known/*"]')
    expect(wranglerConfig).not.toContain('"run_worker_first": ["/**"]')
  })

  it("keeps entry html free of root-absolute asset refs", () => {
    const indexHtml = stripInlineScripts(readRootFile("index.html"))
    const debugHtml = stripInlineScripts(readRootFile("debug.html"))

    for (const value of [
      ...getAttributeValues(indexHtml, "href"),
      ...getAttributeValues(indexHtml, "src"),
    ]) {
      expect(value).not.toMatch(/^\//)
    }
    for (const value of [
      ...getAttributeValues(debugHtml, "href"),
      ...getAttributeValues(debugHtml, "src"),
    ]) {
      expect(value).not.toMatch(/^\//)
    }
  })

  it("uses root base on production and local preview hostnames", () => {
    const indexHtml = readRootFile("index.html")
    const debugHtml = readRootFile("debug.html")

    for (const html of [indexHtml, debugHtml]) {
      expect(html).toContain('"iris.to"')
      expect(html).toContain('"iris-client.irisapp.workers.dev"')
      expect(html).toContain('"127.0.0.1"')
      expect(html).toContain('"localhost"')
      expect(html).toContain(`document.write('<base href="/">')`)
    }
  })
})
