import {readFile} from "node:fs/promises"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8")

const releases = {
  "nostr-pubsub-reconcile": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-reconcile-ts-v0.1.0/nostr-pubsub-reconcile-0.1.0.tgz",
    integrity:
      "sha512-F1UToi75yYrZpt5KFocPUlQH4MeU/J9A/aJBndWUuDvzx1WdQtF99tNxD3KnH2x81R4oaT721hf5OcTdSv8hRg==",
  },
  "@fips/core": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.53/fips-core-0.0.51.tgz",
    integrity:
      "sha512-rY3FBFwAbigsnKaLdjoAm9aFqAe7RVeMHt8+DZ8Xd7sc0RtBidBHBTVXOqD8DGLnJbGesKkvGo1dosbCSps9rA==",
  },
  "@fips/transport-webrtc": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.53/fips-transport-webrtc-0.0.54.tgz",
    integrity:
      "sha512-fEpQaXCscY0YZzAJoNaPPPZcGp/rZ1Ny6tj0OsVoBezfXDGV9X4+LynMkBVNK8vHllgconWC4u298+7WdciBNQ==",
  },
  "@fips/transport-websocket": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.54/fips-transport-websocket-0.0.9.tgz",
    integrity:
      "sha512-y9SkW2IbTt9ElXO89+184PuYCnMyODtojeKfzQg34iQIOpEpebvi/mPzvZjWNFk6e2gAfu3aG1/V+TiSU9XsFA==",
  },
  "nostr-pubsub": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-ts-v0.5.19/nostr-pubsub-0.5.19.tgz",
    integrity:
      "sha512-Usg0Ia7rsyRkH3LSN3g5k1oKoo1+PiBIA/hKiQp18GIzokmHY47WDw4Vf3YotOg2/WtzMqGzwqqSmaJcXVanmw==",
  },
  "@hashtree/worker": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.19/hashtree-worker-0.4.11.tgz",
    integrity:
      "sha512-3lKJ/sic9u0Mc5RhdQNP9aG9SsfvHc7WIjCEBxqNps/JicROjjYKhuPuLKA0oY5LjwA7DhZJfXImcaguyBgM7w==",
  },
  "@hashtree/fips-transport": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.20/hashtree-fips-transport-0.4.21.tgz",
    integrity:
      "sha512-VcVFj6GQeousx7w7WH7/sAETlvQSdh8KGBD1CBGGV2XKxvjz4lgtrBlXNdMnjlkd3eRUOxoBOMc+rQvtVYBF8w==",
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
    url: "https://registry.npmjs.org/nostr-double-ratchet/-/nostr-double-ratchet-0.0.182.tgz",
    registryVersion: "0.0.182",
    integrity:
      "sha512-HOlBZ0G+FcX2NkAnzXEiGb4FaFxIapsf9qRt7VPzme8p7NfJKHbQ1glJVFGzukhd6aWfIRumKXxdqNvypIGdAA==",
  },
  "nostr-social-graph": {
    url: "https://github.com/mmalmi/nostr-social-graph/releases/download/v2.0.4/nostr-social-graph-2.0.4.tgz",
    integrity:
      "sha512-o6LOpo6j1wmR7FIAT5hbuVoLut+OMd5QlOWJqBOr8EKLQaQHze42GEiKqXSQeb4v8Zm3nRZO4ogXq4QuNerApA==",
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

  // pnpm normalizes registry tarball URLs to an exact version and integrity.
  const resolution = release.registryVersion ?? release.url
  const quotedKey = `  '${name}@${resolution}':`
  const plainKey = `  ${name}@${resolution}:`
  const start = Math.max(lockfile.indexOf(quotedKey), lockfile.indexOf(plainKey))
  const end = lockfile.indexOf("\n\n", start)
  const entry = start >= 0 ? lockfile.slice(start, end < 0 ? undefined : end) : ""
  if (
    (!release.registryVersion && !entry.includes(`tarball: ${release.url}`)) ||
    !entry.includes(`integrity: ${release.integrity}`)
  ) {
    throw new Error(`${name} lock entry is missing its verified release integrity`)
  }
}

const corePackages = lockfile.split("\nsnapshots:")[0].match(/^  '@fips\/core@/gm) ?? []
if (corePackages.length !== 1) {
  throw new Error("All peer transports must share one FIPS core package")
}

console.log("Verified immutable shared runtime release integrity")
