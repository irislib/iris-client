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
})
