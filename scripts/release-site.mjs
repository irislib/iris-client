import path from "node:path"
import {fileURLToPath} from "node:url"
import {spawn} from "node:child_process"
import {existsSync} from "node:fs"
import {resolveHtreeCommand} from "./hashtreePaths.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")
const distDir = path.join(appDir, "dist")
const defaultWorkerCompatibilityDate = "2026-03-26"
export const defaultSiteTreeName = "iris-client-site"

const profile = {
  appName: "Iris",
  distDir: "dist",
  // Keep the site tree separate from the htree git remote name.
  // Publishing both to the same mutable ref causes the next `git push origin master`
  // to replace the site with the raw repository contents.
  treeName: defaultSiteTreeName,
  defaultWorkerName: "iris-client",
  defaultDomains: ["iris.to"],
}

function wranglerPagesCommand(...args) {
  return ["npx", "wrangler@4", ...args]
}

function wranglerWorkerCommand(...args) {
  return ["npx", "wrangler@4", "deploy", ...args]
}

export function parseArgs(argv, env = process.env) {
  const args = [...argv].filter((arg, index) => !(arg === "--" && index === 0))

  let pagesProject
  let workerName = env.CF_WORKER_NAME ?? profile.defaultWorkerName
  let treeName = profile.treeName
  let branch
  let dryRun = false
  let skipCloudflare = false
  let pagesOnly = false
  const routes = []
  const domains = []
  let workerCompatibilityDate = env.CF_WORKER_COMPATIBILITY_DATE ?? defaultWorkerCompatibilityDate

  while (args.length > 0) {
    const arg = args.shift()
    if (arg === "--") {
      continue
    }
    if (arg === "--pages-project") {
      pagesProject = args.shift()
      continue
    }
    if (arg === "--worker-name") {
      workerName = args.shift()
      continue
    }
    if (arg === "--tree") {
      treeName = args.shift()
      continue
    }
    if (arg === "--route") {
      routes.push(args.shift())
      continue
    }
    if (arg === "--domain") {
      domains.push(args.shift())
      continue
    }
    if (arg === "--branch") {
      branch = args.shift()
      continue
    }
    if (arg === "--compatibility-date") {
      workerCompatibilityDate = args.shift()
      continue
    }
    if (arg === "--dry-run") {
      dryRun = true
      continue
    }
    if (arg === "--skip-cloudflare" || arg === "--skip-pages") {
      skipCloudflare = true
      continue
    }
    if (arg === "--pages-only") {
      pagesOnly = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    dryRun,
    skipCloudflare,
    pagesOnly,
    treeName,
    branch,
    pagesProject: pagesProject ?? env.CF_PAGES_PROJECT ?? undefined,
    workerName: pagesOnly ? undefined : workerName,
    routes,
    domains: pagesOnly ? [] : (domains.length > 0 ? domains : profile.defaultDomains),
    workerCompatibilityDate,
  }
}

export function createReleasePlan(options) {
  if (!options.skipCloudflare && !options.workerName && !options.pagesProject) {
    throw new Error("Missing Cloudflare target. Pass --worker-name, --pages-project, or set CF_WORKER_NAME / CF_PAGES_PROJECT.")
  }
  if (options.workerName && options.branch) {
    throw new Error("--branch is only supported for Pages deployments")
  }

  const steps = [
    {
      id: "build",
      label: `Build ${profile.appName}`,
      command: ["pnpm", "run", "build"],
      cwd: appDir,
    },
    {
      id: "test-portable",
      label: `Test ${profile.appName} portable config`,
      command: [
        "pnpm",
        "exec",
        "vitest",
        "run",
        "src/portableBuildConfig.test.ts",
        "src/wellKnownProxyWorker.test.ts",
      ],
      cwd: appDir,
    },
    {
      id: "test-smoke",
      label: `Smoke-test ${profile.appName} portable build`,
      command: ["pnpm", "run", "smoke:portable"],
      cwd: appDir,
    },
    {
      id: "publish",
      label: `Publish ${profile.appName} to hashtree`,
      command: resolveHtreeCommand("add", ".", "--publish", options.treeName),
      cwd: distDir,
    },
  ]

  if (!options.skipCloudflare) {
    const deployCommand = options.workerName
      ? wranglerWorkerCommand(
          "--keep-vars",
          "--name",
          options.workerName,
          "--compatibility-date",
          options.workerCompatibilityDate,
        )
      : wranglerPagesCommand(
          "pages",
          "deploy",
          profile.distDir,
          "--project-name",
          options.pagesProject,
        )

    if (options.workerName) {
      for (const route of options.routes) {
        deployCommand.push("--route", route)
      }
      for (const domain of options.domains) {
        deployCommand.push("--domain", domain)
      }
    }
    if (options.pagesProject && options.branch) {
      deployCommand.push("--branch", options.branch)
    }

    steps.push({
      id: "deploy",
      label: options.workerName
        ? `Deploy ${profile.appName} to Cloudflare Worker`
        : `Deploy ${profile.appName} to Cloudflare Pages`,
      command: deployCommand,
      cwd: appDir,
    })
  }

  return {steps}
}

function defaultRunner(step) {
  const [command, ...args] = step.command
  console.log(`\n==> ${step.label}`)
  console.log(`$ ${[command, ...args].join(" ")}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: step.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })

    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
      process.stderr.write(chunk)
    })

    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (signal) {
        const signalMessage = `Process exited with signal ${signal}\n`
        stderr += signalMessage
        process.stderr.write(signalMessage)
      }
      resolve({
        status: code ?? 1,
        stdout,
        stderr,
      })
    })
  })
}

function ensureDistExists(buildOutputExists = existsSync) {
  if (!buildOutputExists(distDir)) {
    throw new Error(`Build output directory not found: ${distDir}`)
  }
}

export function parsePublishOutput(output) {
  const nhashMatch = output.match(/nhash1[ac-hj-np-z02-9]+/i)
  if (!nhashMatch) {
    throw new Error("Publish succeeded but no nhash was found in htree output")
  }

  const publishedMatch = output.match(/^\s*published:\s+(\S+)\s*$/im)
  if (!publishedMatch) {
    throw new Error("Publish succeeded but no mutable ref was found in htree output")
  }

  return {
    nhash: nhashMatch[0],
    publishedRef: publishedMatch[1],
  }
}

function parsePagesOutput(output) {
  const pagesUrlMatch = output.match(/https:\/\/[^\s]+\.pages\.dev(?:\/[^\s]*)?/i)
  return pagesUrlMatch ? pagesUrlMatch[0] : null
}

function isReleaseStep(step) {
  return step.id === "publish" || step.id === "deploy"
}

function assertStepSucceeded(step, result) {
  if (result.status !== 0) {
    throw new Error(`${step.label} failed with exit code ${result.status}`)
  }
}

export async function runRelease(options, runner = defaultRunner, hooks = {}) {
  const plan = createReleasePlan(options)
  const buildOutputExists = hooks.buildOutputExists ?? existsSync

  if (options.dryRun) {
    return {dryRun: true, steps: plan.steps}
  }

  let publishOutput = ""
  let deployOutput = ""
  const prereleaseSteps = plan.steps.filter((step) => !isReleaseStep(step))
  const releaseSteps = plan.steps.filter(isReleaseStep)

  for (const step of prereleaseSteps) {
    const result = await runner(step)
    assertStepSucceeded(step, result)
    if (step.id === "build") {
      ensureDistExists(buildOutputExists)
    }
  }

  const releaseResults = await Promise.allSettled(
    releaseSteps.map((step) => Promise.resolve().then(() => runner(step))),
  )

  for (const [index, execution] of releaseResults.entries()) {
    const step = releaseSteps[index]
    if (execution.status === "rejected") {
      throw execution.reason
    }
    const result = execution.value
    assertStepSucceeded(step, result)
    if (step.id === "publish") {
      publishOutput = `${result.stdout}\n${result.stderr}`
    }
    if (step.id === "deploy") {
      deployOutput = `${result.stdout}\n${result.stderr}`
    }
  }

  return {
    publish: parsePublishOutput(publishOutput),
    pagesUrl: deployOutput ? parsePagesOutput(deployOutput) : null,
    pagesProject: options.skipCloudflare || options.workerName ? null : options.pagesProject ?? null,
    workerName: options.skipCloudflare ? null : options.workerName ?? null,
    routes: options.skipCloudflare || !options.workerName ? [] : options.routes,
    domains: options.skipCloudflare || !options.workerName ? [] : options.domains,
    treeName: options.treeName,
  }
}

export function usage() {
  return `Usage: node ./scripts/release-site.mjs [options]

Build once, test the built output, then publish to hashtree and deploy that same
directory to Cloudflare Workers Static Assets or Cloudflare Pages in parallel.

Options:
  --worker-name <name>    Cloudflare Worker service name for static assets
  --pages-project <name>  Cloudflare Pages project name
  --tree <name>           hashtree mutable tree name override
  --route <pattern>       Worker route, for example iris.to/*
  --domain <hostname>     Worker custom domain, for example iris.to
  --branch <name>         Pages branch/preview deployment target
  --pages-only            disable the built-in/default Worker target and use Pages
  --compatibility-date    Worker compatibility date override
  --skip-cloudflare       publish to hashtree only
  --skip-pages            alias for --skip-cloudflare
  --dry-run               print planned steps without running them
`
}

function printSummary(result) {
  console.log(`\n${profile.appName} release complete.`)
  console.log(`Hashtree immutable URL: htree://${result.publish.nhash}`)
  console.log(`Hashtree mutable URL: htree://${result.publish.publishedRef}`)
  console.log(`Hashtree owner URL: htree://${result.publish.publishedRef}`)
  if (result.workerName) {
    console.log(`Worker service: ${result.workerName}`)
  }
  for (const route of result.routes) {
    console.log(`Worker route: ${route}`)
  }
  for (const domain of result.domains) {
    console.log(`Worker custom domain: ${domain}`)
  }
  if (result.pagesProject) {
    console.log(`Pages project: ${result.pagesProject}`)
  }
  if (result.pagesUrl) {
    console.log(`Pages deployment: ${result.pagesUrl}`)
  }
  console.log(`Tree name: ${result.treeName}`)
}

function isMainModule() {
  if (!process.argv[1]) {
    return false
  }
  return path.resolve(process.argv[1]) === __filename
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  const result = await runRelease(parsed)
  if (result.dryRun) {
    console.log(usage())
    for (const step of result.steps) {
      console.log(`${step.label}: ${step.command.join(" ")} (cwd: ${step.cwd})`)
    }
  } else {
    printSummary(result)
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
