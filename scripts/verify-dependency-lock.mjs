import {readFile} from "node:fs/promises"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8")

const releases = {
  "nostr-pubsub": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-ts-v0.5.9/nostr-pubsub-0.5.9.tgz",
    integrity:
      "sha512-upQs1cQzd5NitTGhwLinmfR96wmBn5EU8+D71Y61hEp5rQpa0JiXq2KSBtKbsbAt/OZoM8VUV4jofvBJvyd/Xg==",
  },
  "@hashtree/worker": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.8/hashtree-worker-0.4.4.tgz",
    integrity:
      "sha512-QS/NfriLsQMacxbK0cpt5XBq1zRdAAp2rGtlYa2uhgvNX9u64LIkkWFqVDbs1UQmp3SQ8XGbly99aKKML4j8uQ==",
  },
  "@hashtree/fips-transport": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.8/hashtree-fips-transport-0.4.11.tgz",
    integrity:
      "sha512-cjCZ8kuoWpiLgnkfidOhbja4JoBpfo98x8zd0vwmvJrD5VWnNIvsYrKq+qlIyegw4mQ4PETiF3fNyb3lQ//nuw==",
  },
  "@hashtree/dexie": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.8/hashtree-dexie-0.1.11.tgz",
    integrity:
      "sha512-s3hxH4n9KsoyMELuFPJ81fXoOhx6js5PM/E6elR7LKLKX2fZxRkeBL+QHtYk9uQfbCitssEoU4jli8l+IR7DGw==",
  },
  "@hashtree/core": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.8/hashtree-core-0.3.2.tgz",
    integrity:
      "sha512-OLd2ARbYKt9s7wipMX58OhJwZQ6XwIdkuJ+Zfp+NNz3rjXDV8kYl67S9HlrXOj5eSsy5SbN/JuKS8QuwXzEiRQ==",
  },
  "@hashtree/index": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.8/hashtree-index-0.1.14.tgz",
    integrity:
      "sha512-HErzNAkVSZWRIIgLKhyPfhfkUbR7BZ4hn+D4xnrIC/z8hPVmH6O4HVZ90OJ4Y3KgcK9zM3ggrf60HOwmMLzatw==",
  },
  "@iris/release-tools": {
    url: "https://github.com/mmalmi/iris-kit/releases/download/runtime-v0.2.2/iris-release-tools-0.1.1.tgz",
    integrity:
      "sha512-bBFZ0hyyf+6uAmYE8IKpo5vV8BH2zLy9mQEq/LY9wmv6Aa7CvKn+4fHI21TyO2jTV2rjkV0/mF8vW0dtVs7HNA==",
  },
  "nostr-double-ratchet": {
    url: "https://github.com/irislib/nostr-double-ratchet/releases/download/nostr-double-ratchet-ts-v0.0.174/nostr-double-ratchet-0.0.174.tgz",
    integrity:
      "sha512-tSWSNsfqbjM9sq7N1A/Sltt9nTO4EYCHUAr7D+k9hWU3s5vNUCtvdcTCXNqzudPddtHwhby57pK9+gvwHKCPRA==",
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
