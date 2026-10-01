import {readFile} from "node:fs/promises"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8")

const releases = {
  "@fips/core": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.48/fips-core-0.0.48.tgz",
    integrity:
      "sha512-9Ko3aX3QLgBy+1zFFySjMpLPP70PG61fOWUkguSmfIn5xFM4m7sZa7FfrY/qJnWhFvhFYdwpVVxfWv06woY5GA==",
  },
  "nostr-pubsub": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-ts-v0.5.13/nostr-pubsub-0.5.13.tgz",
    integrity:
      "sha512-iL94fAtLDh5agPo/4qOgfy5QUmQL2GY/LFL4zp/H9U6St1+hJpLAcrA4eQLZlwyvtIXQu1tOtpdHkuhu4wEZ9A==",
  },
  "@hashtree/worker": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.11/hashtree-worker-0.4.7.tgz",
    integrity:
      "sha512-ZIkcdIYY9XXKhi2w9HfsdrEFPSe0Qlm9+OSxVGGjBH/+YJf6lwQkrGR/00KqX4GAJVjI59B3rPwcqBAH6Mlo1Q==",
  },
  "@hashtree/fips-transport": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.14/hashtree-fips-transport-0.4.17.tgz",
    integrity:
      "sha512-hBhfa7AEB5D7KJY0whTMsybX1Q3cYuqBb9C/nLi10TAponqRqwObv6dkKHLpycJyNZq4FbplS/pizie2eIzTpg==",
  },
  "@hashtree/dexie": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.9/hashtree-dexie-0.1.11.tgz",
    integrity:
      "sha512-NGe+rKVuyBrhlWeIemO0Hzd/mAcuN+PqpXYeg508dlvwuRrl+0GNIwRwPVh7e7Zg5VlwiKaN6E5itp9W6EZEGg==",
  },
  "@hashtree/core": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.9/hashtree-core-0.3.2.tgz",
    integrity:
      "sha512-OLd2ARbYKt9s7wipMX58OhJwZQ6XwIdkuJ+Zfp+NNz3rjXDV8kYl67S9HlrXOj5eSsy5SbN/JuKS8QuwXzEiRQ==",
  },
  "@hashtree/index": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.9/hashtree-index-0.1.14.tgz",
    integrity:
      "sha512-5JAekyGQAb+6yhXramZhzaKZ8I8HpVrnDd6SZCF6y3sYOLge2zAPep0MpPJtYpNsD3HdXCIhUL1JK40YvKCgHA==",
  },
  "@iris/release-tools": {
    url: "https://github.com/mmalmi/iris-kit/releases/download/runtime-v0.2.6/iris-release-tools-0.1.1.tgz",
    integrity:
      "sha512-bBFZ0hyyf+6uAmYE8IKpo5vV8BH2zLy9mQEq/LY9wmv6Aa7CvKn+4fHI21TyO2jTV2rjkV0/mF8vW0dtVs7HNA==",
  },
  "nostr-double-ratchet": {
    url: "https://github.com/irislib/nostr-double-ratchet/releases/download/nostr-double-ratchet-ts-v0.0.175/nostr-double-ratchet-0.0.175.tgz",
    integrity:
      "sha512-q52P1BZrNUWoR0thEpBHuzj7EWdP0sSLKq2PC7oFJZVMEBKrq2/u1+eKZi/wijXa1J2ySS95QvYLNaurwI/B1A==",
  },
  "nostr-social-graph": {
    url: "https://github.com/mmalmi/nostr-social-graph/releases/download/v2.0.2/nostr-social-graph-2.0.2.tgz",
    integrity:
      "sha512-j3QNMC9XDg77Pc5L7biR1alfQmzKQh+I60Al9Ovu7ee4EatM3iKf02JgsTPVLaDyFu1/3l+KxqfiAqYRGOLvvw==",
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
