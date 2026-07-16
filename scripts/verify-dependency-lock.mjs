import {readFile} from "node:fs/promises"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8")

const releases = {
  "@hashtree/core": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.4.2/hashtree-core-0.2.1.tgz",
    integrity:
      "sha512-kkZKx/mNqImMy1DnWXRgv2LHaf5HbZg8sIpHV6/wLZKl3cQkmSY9xtjCZSTlUXeXIgOmxDzqDGa2GNf5Rg7b/A==",
  },
  "@hashtree/index": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.4.2/hashtree-index-0.1.11.tgz",
    integrity:
      "sha512-Zc6XHOYnJ0d8tOHvCp4ZXFJizh2MJj3PyYqGL2+sxti+HAFrkonGrz6cotXKUsr9A8Z4FE2XtnwfwTultdk6fw==",
  },
  "@iris/release-tools": {
    url: "https://github.com/mmalmi/iris-kit/releases/download/runtime-v0.2.2/iris-release-tools-0.1.1.tgz",
    integrity:
      "sha512-bBFZ0hyyf+6uAmYE8IKpo5vV8BH2zLy9mQEq/LY9wmv6Aa7CvKn+4fHI21TyO2jTV2rjkV0/mF8vW0dtVs7HNA==",
  },
  "nostr-double-ratchet": {
    url: "https://github.com/irislib/nostr-double-ratchet/releases/download/nostr-double-ratchet-ts-v0.0.165/nostr-double-ratchet-0.0.165.tgz",
    integrity: "sha256-5vwY+wdlWoPfnyViBgHEoc4UFUechvthHuJ6MoYRBXU=",
  },
  "nostr-social-graph": {
    url: "https://github.com/mmalmi/nostr-social-graph/releases/download/v2.0.0/nostr-social-graph-2.0.0.tgz",
    integrity:
      "sha512-DLe0wbmkfuXl9PoF67aJsyq9nsBX2TV/YXDKJSG8WHcAIgHWQiGcSmN/ogT5XhTejw8o8rcywfgtfSDcv6Cf8w==",
  },
}

const declared = {...manifest.dependencies, ...manifest.devDependencies}
for (const [name, specifier] of Object.entries(declared)) {
  if (specifier.startsWith("file:") || specifier.startsWith("link:")) {
    throw new Error(`${name} must not depend on a mutable sibling workspace`)
  }
}
if (/\b(?:file|link):\.\.\//.test(lockfile)) {
  throw new Error("Lockfile must not resolve mutable sibling workspaces")
}
for (const name of Object.keys(manifest.pnpm?.overrides ?? {})) {
  if (name.startsWith("@hashtree/")) {
    throw new Error(`Hashtree override ${name} bypasses the immutable release graph`)
  }
}

for (const [name, release] of Object.entries(releases)) {
  if (declared[name] !== release.url) {
    throw new Error(`${name} must use immutable release ${release.url}`)
  }

  const quotedKey = `  '${name}@${release.url}':`
  const plainKey = `  ${name}@${release.url}:`
  const start = Math.max(lockfile.indexOf(quotedKey), lockfile.indexOf(plainKey))
  const end = lockfile.indexOf("\n\n", start)
  const entry = start >= 0 ? lockfile.slice(start, end < 0 ? undefined : end) : ""
  if (
    !entry.includes(`tarball: ${release.url}`) ||
    !entry.includes(`integrity: ${release.integrity}`)
  ) {
    throw new Error(`${name} lock entry is missing its verified release integrity`)
  }
}

console.log("Verified immutable shared runtime release integrity")
