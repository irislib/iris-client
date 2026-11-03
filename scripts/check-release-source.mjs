import {execFileSync, spawnSync} from "node:child_process"
import path from "node:path"
import {fileURLToPath} from "node:url"

function git(cwd, args) {
  return execFileSync("git", args, {cwd, encoding: "utf8"}).trim()
}

export function sourceCommit(cwd) {
  return git(cwd, ["rev-parse", "HEAD"])
}

export function assertReleaseSource(cwd, expectedCommit) {
  const current = sourceCommit(cwd)
  if (current !== expectedCommit) {
    throw new Error(
      "Release source changed during validation. Rebuild and test the current commit."
    )
  }
  if (git(cwd, ["status", "--porcelain"])) {
    throw new Error(
      "Release requires a clean checkout. Commit the source changes before building."
    )
  }
  const master = git(cwd, ["rev-parse", "refs/heads/master"])
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", master, current], {
    cwd,
  })
  if (ancestry.status !== 0) {
    throw new Error(
      `Release checkout does not include current master (${master.slice(0, 12)}). Merge master, rebuild and retest before publishing.`
    )
  }
  return current
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const commit = assertReleaseSource(process.cwd(), process.argv[2])
    console.log(`Verified release source ${commit}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
