import path from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {existsSync} from "node:fs"
import {parsePublishOutput} from "./release-site.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")
const workspaceDir = path.resolve(appDir, "..")
const manifestPath = path.join(workspaceDir, "hashtree", "rust", "Cargo.toml")
const distDir = path.join(appDir, "dist")
const defaultTreeName = "iris-client-dev"

export function parseArgs(argv) {
  const args = [...argv].filter((arg, index) => !(arg === "--" && index === 0))

  let treeName = defaultTreeName
  let skipBuild = false
  let dryRun = false

  while (args.length > 0) {
    const arg = args.shift()
    if (arg === "--") {
      continue
    }
    if (arg === "--tree") {
      treeName = args.shift()
      continue
    }
    if (arg === "--skip-build") {
      skipBuild = true
      continue
    }
    if (arg === "--dry-run") {
      dryRun = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!treeName || !treeName.trim()) {
    throw new Error("Tree name cannot be empty")
  }

  return {
    treeName: treeName.trim(),
    skipBuild,
    dryRun,
  }
}

export function createDevPublishPlan(options) {
  const steps = []

  if (!options.skipBuild) {
    steps.push({
      id: "build",
      label: "Build Iris dev publish",
      command: ["pnpm", "run", "build"],
      cwd: appDir,
    })
  }

  steps.push({
    id: "publish",
    label: `Publish Iris dev tree to hashtree (${options.treeName})`,
    command: [
      "cargo",
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
      options.treeName,
    ],
    cwd: distDir,
  })

  return {steps}
}

function defaultRunner(step) {
  const [command, ...args] = step.command
  console.log(`\n==> ${step.label}`)
  console.log(`$ ${[command, ...args].join(" ")}`)
  const result = spawnSync(command, args, {
    cwd: step.cwd,
    encoding: "utf8",
    stdio: "pipe",
  })

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function ensureDistExists() {
  if (!existsSync(distDir)) {
    throw new Error(`Build output directory not found: ${distDir}`)
  }
}

export function runDevPublish(options, runner = defaultRunner) {
  const plan = createDevPublishPlan(options)

  if (options.dryRun) {
    return {dryRun: true, steps: plan.steps}
  }

  let publishOutput = ""
  for (const step of plan.steps) {
    const result = runner(step)
    if (result.status !== 0) {
      throw new Error(`${step.label} failed with exit code ${result.status}`)
    }
    if (step.id === "build") {
      ensureDistExists()
    }
    if (step.id === "publish") {
      publishOutput = `${result.stdout}\n${result.stderr}`
    }
  }

  return {
    publish: parsePublishOutput(publishOutput),
    treeName: options.treeName,
  }
}

export function usage() {
  return `Usage: node ./scripts/devpublish-iris.mjs [options]

Build iris-client, publish the current dist directory to hashtree, and print
both mutable and immutable URLs for testing inside Iris.

Options:
  --tree <name>      hashtree mutable tree name override
  --skip-build       publish the existing dist directory as-is
  --dry-run          print planned steps without running them
`
}

function printSummary(result) {
  console.log("\nIris dev publish complete.")
  console.log(`Hashtree immutable URL: htree://${result.publish.nhash}`)
  console.log(`Hashtree mutable URL: htree://${result.publish.publishedRef}`)
  console.log(`Hashtree self URL: htree://self/${result.treeName}`)
  console.log(`Tree name: ${result.treeName}`)
}

function isMainModule() {
  if (!process.argv[1]) {
    return false
  }
  return path.resolve(process.argv[1]) === __filename
}

if (isMainModule()) {
  try {
    const parsed = parseArgs(process.argv.slice(2))
    const result = runDevPublish(parsed)
    if (result.dryRun) {
      console.log(usage())
      for (const step of result.steps) {
        console.log(`${step.label}: ${step.command.join(" ")} (cwd: ${step.cwd})`)
      }
    } else {
      printSummary(result)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
