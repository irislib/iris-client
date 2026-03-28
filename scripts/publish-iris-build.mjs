import path from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {parsePublishOutput} from "./release-site.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")
const workspaceDir = path.resolve(appDir, "..")
const manifestPath = path.join(workspaceDir, "hashtree", "rust", "Cargo.toml")
const distDir = path.join(appDir, "dist")

function main() {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--manifest-path",
      manifestPath,
      "-p",
      "hashtree-cli",
      "--bin",
      "htree",
      "--",
      "add",
      ".",
      "--publish",
      "iris-client",
    ],
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

  const publish = parsePublishOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
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
