import path from "node:path"
import {fileURLToPath} from "node:url"
import {runPortableSmoke} from "./portable-smoke-lib.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")
const distDir = path.join(appDir, "dist")
const screenshotPath = path.join(appDir, "test-results", "iris-client-portable-smoke.png")

async function main() {
  await runPortableSmoke({
    distDir,
    screenshotPath,
    async validatePage(page) {
      await page.waitForFunction(() => {
        const root = document.querySelector("#root")
        return Boolean(root && (root.childElementCount > 0 || root.textContent?.trim()))
      })
    },
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
