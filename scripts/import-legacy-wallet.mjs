import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {execFileSync} from "node:child_process"
import {cp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = path.resolve(process.argv[2] || "")
assert(
  process.argv[2],
  "Pass the clean legacy wallet source checkout containing dist/spa"
)
const git = (...args) => execFileSync("git", args, {cwd: source, encoding: "utf8"}).trim()
assert.equal(git("status", "--porcelain", "--untracked-files=no"), "")
const sourceCommit = git("rev-parse", "HEAD")
const bundle = path.join(source, "dist/spa")
const target = path.join(root, "public/cashu")
const index = await readFile(path.join(bundle, "index.html"), "utf8")
assert(index.includes("/cashu/assets/"), "Expected the legacy /cashu build")
await rm(target, {recursive: true, force: true})
await mkdir(target, {recursive: true})
await cp(bundle, target, {recursive: true})
await writeFile(
  path.join(target, "index.html"),
  index
    .replaceAll(/href=\/icons\/(\d+x\d+)\.png/g, "href=/cashu/icons/favicon-$1.png")
    .replace("<head>", '<head><script type="module" src="/cashu/offline.js"></script>')
)
await cp(
  path.join(root, "scripts/legacy-wallet-offline.js"),
  path.join(target, "offline.js")
)
await writeFile(
  path.join(target, "provenance.json"),
  JSON.stringify(
    {
      repository: "https://github.com/mmalmi/cashu.me",
      commit: sourceCommit,
      upstream: "5af04372de69ba0b117dc3c2cb87526c12a06200",
      integration:
        "Client adds offline registration, normalizes the direct entry URL and corrects icon paths; wallet source is built unchanged.",
    },
    null,
    2
  ) + "\n"
)
const files = {}
async function collect(directory) {
  for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(file)
    else if (entry.isFile())
      files[path.relative(target, file)] = createHash("sha256")
        .update(await readFile(file))
        .digest("hex")
  }
}
await collect(target)
const workerTemplate = await readFile(
  path.join(root, "scripts/legacy-wallet-worker.js"),
  "utf8"
)
assert(workerTemplate.includes("__LEGACY_WALLET_MANIFEST__"))
// Both the static responses and their serving logic define an immutable version.
const version = createHash("sha256")
  .update(JSON.stringify(files))
  .update(workerTemplate)
  .digest("hex")
const worker = `service-worker.${version}.js`
const manifest = {version, worker, files}
await writeFile(
  path.join(target, "offline-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
)
await writeFile(
  path.join(target, worker),
  workerTemplate.replace("__LEGACY_WALLET_MANIFEST__", JSON.stringify(manifest))
)
console.log(
  `Imported legacy wallet ${sourceCommit}: ${Object.keys(files).length} static files`
)
