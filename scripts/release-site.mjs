import path from "node:path"
import {fileURLToPath} from "node:url"
import {
  cloneValues,
  createDefaultRunner,
  createReleasePlan as createSharedReleasePlan,
  runReleasePlan,
  usesBuiltInWorker,
} from "@iris/release-tools"
import {resolveHtreeCommand} from "./hashtreePaths.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")
const defaultWorkerCompatibilityDate = "2026-03-26"
const wranglerVersion = "4"

export const defaultSiteTreeName = "iris-client-site"

export const releaseProfile = {
  appName: "Iris",
  distDir: "dist",
  treeName: defaultSiteTreeName,
  defaultWorkerName: "iris-client",
  defaultRoutes: [],
  defaultDomains: ["iris.to"],
  workerNameEnv: "CF_WORKER_NAME",
  pagesProjectEnv: "CF_PAGES_PROJECT",
  buildCommand: ["pnpm", "run", "build"],
  testCommands: [
    [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "src/portableBuildConfig.test.ts",
      "src/wellKnownProxyWorker.test.ts",
    ],
    ["pnpm", "run", "smoke:portable"],
    ["pnpm", "run", "test:release:e2e"],
  ],
}

export function parseArgs(argv, env = process.env) {
  const args = [...argv].filter((arg, index) => !(arg === "--" && index === 0))
  let pagesProject
  let workerName
  let treeName
  let branch
  let dryRun = false
  let skipCloudflare = false
  let pagesOnly = false
  const routes = []
  const domains = []
  let workerCompatibilityDate

  while (args.length > 0) {
    const arg = args.shift()
    if (arg === "-h" || arg === "--help") return {help: true}
    if (arg === "--") continue
    if (arg === "--pages-project") pagesProject = args.shift()
    else if (arg === "--worker-name") workerName = args.shift()
    else if (arg === "--tree") treeName = args.shift()
    else if (arg === "--route") routes.push(args.shift())
    else if (arg === "--domain") domains.push(args.shift())
    else if (arg === "--branch") branch = args.shift()
    else if (arg === "--compatibility-date") workerCompatibilityDate = args.shift()
    else if (arg === "--dry-run") dryRun = true
    else if (arg === "--skip-cloudflare" || arg === "--skip-pages") {
      skipCloudflare = true
    } else if (arg === "--pages-only") pagesOnly = true
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (pagesOnly && workerName) {
    throw new Error("--pages-only is not compatible with --worker-name")
  }
  if (pagesOnly && (routes.length > 0 || domains.length > 0)) {
    throw new Error("--pages-only is not compatible with --route/--domain")
  }

  const resolvedWorkerName = pagesOnly
    ? undefined
    : (workerName ??
      env[releaseProfile.workerNameEnv] ??
      releaseProfile.defaultWorkerName)
  const useDefaults = usesBuiltInWorker(releaseProfile, resolvedWorkerName)

  return {
    dryRun,
    skipCloudflare,
    pagesOnly,
    branch,
    treeName: treeName ?? releaseProfile.treeName,
    workerName: resolvedWorkerName,
    pagesProject: pagesProject ?? env[releaseProfile.pagesProjectEnv],
    routes:
      routes.length > 0
        ? routes
        : useDefaults
          ? cloneValues(releaseProfile.defaultRoutes)
          : [],
    domains:
      domains.length > 0
        ? domains
        : useDefaults
          ? cloneValues(releaseProfile.defaultDomains)
          : [],
    workerCompatibilityDate:
      workerCompatibilityDate ??
      env.CF_WORKER_COMPATIBILITY_DATE ??
      defaultWorkerCompatibilityDate,
  }
}

export function createReleasePlan(options) {
  return createSharedReleasePlan({
    appDir,
    options,
    profile: releaseProfile,
    resolveHtreeCommand,
    wranglerVersion,
  })
}

const defaultRunner = createDefaultRunner()

export async function runRelease(options, runner = defaultRunner, hooks = {}) {
  return runReleasePlan(options, createReleasePlan(options), runner, hooks)
}

export function usage() {
  return `Usage: node ./scripts/release-site.mjs [options]

Build once, test the built output, then publish that same directory to Hashtree
and Cloudflare in parallel.

Options:
  --worker-name <name>    Cloudflare Worker service name
  --pages-project <name>  Cloudflare Pages project name
  --tree <name>           Hashtree mutable tree name
  --route <pattern>       Worker route
  --domain <hostname>     Worker custom domain
  --branch <name>         Pages branch/preview target
  --pages-only            use Pages instead of the default Worker
  --compatibility-date    Worker compatibility date
  --skip-cloudflare       publish to Hashtree only
  --dry-run               print the release plan
`
}

function printSummary(result) {
  console.log(`\n${result.profile.appName} release complete.`)
  console.log(`Hashtree immutable URL: htree://${result.publish.nhash}`)
  console.log(`Hashtree mutable URL: htree://${result.publish.publishedRef}`)
  if (result.workerName) console.log(`Worker service: ${result.workerName}`)
  for (const route of result.routes ?? []) console.log(`Worker route: ${route}`)
  for (const domain of result.domains ?? []) console.log(`Worker domain: ${domain}`)
  if (result.pagesUrl) console.log(`Deployment URL: ${result.pagesUrl}`)
  console.log(`Tree name: ${result.treeName}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return console.log(usage())
  const result = await runRelease(options)
  if (result.dryRun) {
    console.log(usage())
    for (const step of result.steps) {
      console.log(`${step.label}: ${step.command.join(" ")} (cwd: ${step.cwd})`)
    }
  } else {
    printSummary(result)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
