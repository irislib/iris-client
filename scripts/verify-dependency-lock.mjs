import {readFile} from "node:fs/promises"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8")

const releases = {
  "@hashtree/core": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.7/hashtree-core-0.3.2.tgz",
    integrity:
      "sha512-DAMUpGBcRk6JgecIU5T3AS18gAiXpiwYG2mULq+mec9noWmaVUFBnkMt+ur12IjKik9G146z1cQV5y/oZ7MgFA==",
  },
  "@hashtree/index": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.7/hashtree-index-0.1.14.tgz",
    integrity:
      "sha512-nEpHCj+l5aFs0oELah4DbeQwlNEAaAU3qtCZxiRTd2hLjFwbT/zlXaynatESzc5pUX2aVhYCO6aCUEjR9Cds1g==",
  },
  "@iris/release-tools": {
    url: "https://github.com/mmalmi/iris-kit/releases/download/runtime-v0.2.2/iris-release-tools-0.1.1.tgz",
    integrity:
      "sha512-bBFZ0hyyf+6uAmYE8IKpo5vV8BH2zLy9mQEq/LY9wmv6Aa7CvKn+4fHI21TyO2jTV2rjkV0/mF8vW0dtVs7HNA==",
  },
  "nostr-double-ratchet": {
    url: "https://github.com/irislib/nostr-double-ratchet/releases/download/nostr-double-ratchet-ts-v0.0.170/nostr-double-ratchet-0.0.170.tgz",
    integrity:
      "sha512-vVbKpj9zULelfZWdLJrlcDKUPCcS8j4cgdDArTvtgHXqJw++s36J5BI+y0Zf/OZLWDD/DM1uh1g0FnEiCUiulQ==",
  },
  "nostr-social-graph": {
    url: "https://github.com/mmalmi/nostr-social-graph/releases/download/v2.0.1/nostr-social-graph-2.0.1.tgz",
    integrity:
      "sha512-7bR840Fmz7wYaHi0P9fXxxKlQSphFARmj2VBMIQdFvrNT584bj6ci18GaeJ49OghutUot/FwHmPOTjYqmg6koA==",
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
