import {createNativeReleaseCommand, parseNativeReleaseOutput} from "@iris/release-tools"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {resolveHtreeCommand} from "./hashtreePaths.mjs"
import {defaultSiteTreeName} from "./release-site.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, "..", "dist")

function main() {
  const [command, ...args] = createNativeReleaseCommand({
    distDir,
    treeName: defaultSiteTreeName,
    resolveHtreeCommand,
  })
  const result = spawnSync(
    command,
    args,
    {
      cwd: distDir,
      encoding: "utf8",
      stdio: "pipe",
    },
  )

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Publish Iris failed with exit code ${result.status ?? 1}`)
  }

  const publish = parseNativeReleaseOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, defaultSiteTreeName)
  console.log(`Portable Iris immutable URL: htree://${publish.nhash}`)
  console.log(`Portable Iris mutable URL: htree://${publish.publishedRef}`)
  console.log(`Portable Iris owner URL: htree://${publish.publishedRef}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
