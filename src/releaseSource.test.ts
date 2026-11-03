import {execFileSync} from "node:child_process"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import path from "node:path"
import {afterEach, describe, expect, it} from "vitest"
// @ts-expect-error Node release script has no TypeScript declaration.
import {assertReleaseSource, sourceCommit} from "../scripts/check-release-source.mjs"

const directories: string[] = []
afterEach(() =>
  directories.splice(0).forEach((dir) => rmSync(dir, {recursive: true, force: true}))
)

function repository() {
  const dir = mkdtempSync(path.join(tmpdir(), "iris-release-source-"))
  directories.push(dir)
  const git = (...args: string[]) =>
    execFileSync("git", args, {cwd: dir, encoding: "utf8"}).trim()
  git("init", "-b", "master")
  git("config", "user.name", "Release Test")
  git("config", "user.email", "release@example.test")
  const commit = (text: string) => {
    writeFileSync(path.join(dir, "source.txt"), text)
    git("add", "source.txt")
    git("commit", "-m", text)
    return sourceCommit(dir)
  }
  return {dir, git, commit}
}

describe("release source guard", () => {
  it("rejects an isolated release checkout after master advances", () => {
    const {dir, git, commit} = repository()
    const old = commit("original layout")
    git("branch", "release")
    commit("fix wide search layout")
    git("checkout", "release")
    expect(() => assertReleaseSource(dir, old)).toThrow("does not include current master")
    git("merge", "--ff-only", "master")
    expect(assertReleaseSource(dir, sourceCommit(dir))).toBe(sourceCommit(dir))
  })

  it("rechecks master after a release has finished building and testing", () => {
    const {dir, git, commit} = repository()
    const built = commit("initial source")
    git("branch", "release")
    expect(assertReleaseSource(dir, built)).toBe(built)
    commit("new fix on master")
    git("checkout", "release")
    expect(() => assertReleaseSource(dir, built)).toThrow(
      "does not include current master"
    )
  })

  it("rejects source edits and commit changes after building", () => {
    const {dir, commit} = repository()
    const built = commit("initial source")
    writeFileSync(path.join(dir, "source.txt"), "uncommitted change")
    expect(() => assertReleaseSource(dir, built)).toThrow("clean checkout")
    commit("new source commit")
    expect(() => assertReleaseSource(dir, built)).toThrow("changed during validation")
  })
})
