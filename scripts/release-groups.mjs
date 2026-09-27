import {spawnSync} from "node:child_process"
import path from "node:path"
import {fileURLToPath} from "node:url"

const filename = fileURLToPath(import.meta.url)
const appDir = path.resolve(path.dirname(filename), "..")

export const releaseSteps = [
  {command: ["pnpm", "run", "typecheck"]},
  {
    command: [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "src/groups",
      "src/groupsBuildConfig.test.ts",
      "src/portableBuildConfig.test.ts",
    ],
  },
  {command: ["pnpm", "run", "build:groups"]},
  {
    command: [
      "pnpm",
      "exec",
      "playwright",
      "test",
      "tests/groups.spec.ts",
      "--reporter=list",
    ],
    env: {
      NODE_CONFIG_ENV: "groups",
      IRIS_E2E_BUILT_DIST: "true",
      IRIS_E2E_LOCAL_RELAY: "true",
    },
  },
  {command: ["pnpm", "dlx", "wrangler@4", "deploy", "--config", "wrangler.groups.jsonc"]},
]

export function runRelease({dryRun = false} = {}, runner = spawnSync) {
  for (const step of releaseSteps) {
    if (dryRun) {
      console.log(
        [
          ...Object.entries(step.env ?? {}).map(([key, value]) => `${key}=${value}`),
          ...step.command,
        ].join(" ")
      )
      continue
    }
    const [command, ...args] = step.command
    const result = runner(command, args, {
      cwd: appDir,
      env: {...process.env, ...step.env},
      stdio: "inherit",
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${step.command.join(" ")} failed`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--")
    if (args.some((arg) => arg !== "--dry-run")) {
      throw new Error("Usage: pnpm release:groups [--dry-run]")
    }
    runRelease({dryRun: args.includes("--dry-run")})
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
