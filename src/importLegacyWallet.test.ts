// @vitest-environment node
import {execFileSync} from "node:child_process"
import {cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {expect, test} from "vitest"

test("a worker-only change gets a new immutable wallet version", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "iris-wallet-import-"))
  try {
    const scripts = path.join(root, "scripts")
    const source = path.join(root, "wallet")
    await mkdir(scripts)
    await mkdir(path.join(source, "dist/spa/assets"), {recursive: true})
    for (const name of [
      "import-legacy-wallet.mjs",
      "legacy-wallet-offline.js",
      "legacy-wallet-worker.js",
    ]) {
      await cp(new URL(`../scripts/${name}`, import.meta.url), path.join(scripts, name))
    }
    await writeFile(
      path.join(source, "dist/spa/index.html"),
      '<head></head><script src="/cashu/assets/wallet.js"></script>'
    )
    await writeFile(path.join(source, "dist/spa/assets/wallet.js"), "// wallet fixture\n")
    const git = (...args: string[]) =>
      execFileSync("git", args, {cwd: source, stdio: "pipe"})
    git("init", "--quiet")
    git("add", ".")
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "Synthetic wallet"
    )
    const target = path.join(root, "public/cashu")
    const run = async () => {
      execFileSync(process.execPath, [
        path.join(scripts, "import-legacy-wallet.mjs"),
        source,
      ])
      return JSON.parse(
        await readFile(path.join(target, "offline-manifest.json"), "utf8")
      )
    }
    const first = await run()
    const index = await readFile(path.join(target, "index.html"), "utf8")
    expect(index.indexOf("/cashu/offline.js")).toBeLessThan(
      index.indexOf("/cashu/assets/wallet.js")
    )
    expect(await run()).toEqual(first)
    const template = path.join(scripts, "legacy-wallet-worker.js")
    await writeFile(
      template,
      (await readFile(template, "utf8")) + "\n// Serving logic revision\n"
    )
    const second = await run()
    expect(second.files).toEqual(first.files)
    expect(second.version).not.toBe(first.version)
    expect(second.worker).not.toBe(first.worker)
    expect(await readdir(target)).not.toContain(first.worker)
    expect(await readFile(path.join(target, second.worker), "utf8")).toContain(
      second.version
    )
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
