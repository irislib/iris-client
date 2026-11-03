import {createHash} from "node:crypto"
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
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.56/fips-core-0.0.52.tgz",
    integrity:
      "sha512-omsxRDNQ0iqEBipCD0sOhodDYm0p8cnjt/6BmcDBvtDgQx9F+wL0LXO8hN7MtqZ7KI40wc/gACAudP2+gscXew==",
  },
  "@fips/transport-webrtc": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.57/fips-transport-webrtc-0.0.56.tgz",
    integrity:
      "sha512-rxRtF4TLPuRicue+GeuG/jsIJXFUmOYRLQDlgULJYMPFcf1JO1dD1B7RgrjT+bF6ssGrNoNP+NUd77lKnTli2Q==",
  },
  "@fips/transport-websocket": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.54/fips-transport-websocket-0.0.9.tgz",
    integrity:
      "sha512-y9SkW2IbTt9ElXO89+184PuYCnMyODtojeKfzQg34iQIOpEpebvi/mPzvZjWNFk6e2gAfu3aG1/V+TiSU9XsFA==",
  },
  "nostr-pubsub": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-ts-v0.5.21/nostr-pubsub-0.5.21.tgz",
    integrity:
      "sha512-MF7gmvWg+hNj6prihnyyftlXAdbaV+qALJeoOfpUn5yjL5gPihkaODJ6zAS+7BYBAftWlclGO1t3dgIl4KPd5g==",
  },
  "@hashtree/nostr": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.9/hashtree-nostr-0.2.5.tgz",
    integrity:
      "sha512-SSFQtQOVxKPVoU4K9H/TunB7nRdyCqpjYaQV1KFV6goUAJRKFA4jqtI8PiNeSR/PmBL39jovw2bwWdPZbh/7Hg==",
  },
  "@hashtree/nostr-pubsub": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.11/hashtree-nostr-pubsub-0.1.7.tgz",
    integrity:
      "sha512-BmxKhtPatqoBCYojjz6+Z6/ghsfiJPuyy2mM0ePstpm2nJkP34QPYv+WiJStpUT5TUDdfwxeEYqGYJCzLex9Nw==",
  },
  "@hashtree/worker": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.19/hashtree-worker-0.4.11.tgz",
    integrity:
      "sha512-3lKJ/sic9u0Mc5RhdQNP9aG9SsfvHc7WIjCEBxqNps/JicROjjYKhuPuLKA0oY5LjwA7DhZJfXImcaguyBgM7w==",
  },
  "@hashtree/fips-transport": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.22/hashtree-fips-transport-0.4.23.tgz",
    integrity:
      "sha512-QoZ/HaIg3irXpAPR0K2p8IZc05ico0jrZxTYVth2yWPIj5ewCw4ZA8Xd2Cc0b5a5KJpxg5ktNsBfkdYt2Hho0Q==",
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
    url: "https://registry.npmjs.org/nostr-double-ratchet/-/nostr-double-ratchet-0.0.183.tgz",
    registryVersion: "0.0.183",
    integrity:
      "sha512-CPvJzniY+nItLVEQpH4jaRnmU7AMkD3kAN5yByXMgmm4MNChAk8X8HY8oJIw1riX/gW3/WKD8c+eUtSgu98DDA==",
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

// The on-device search model is shipped with the app and loaded on demand.
const searchAssets = {
  "search-tag-head.json": "7abebd58ec9bf8b94322a362236ee0a983cf0dae1cf590efcea60c98777a8442",
  "search-minilm-gpu.onnx": "92c024a385492196a88dd8043617176929952ece58f763683c3eeec7902856d4",
  "search-minilm-q8.onnx": "b190f50dd46296b9895ae8f274c3455762d08610f8788f4a9bd15019f4f7160c",
  "search-tokenizer.json": "2fc687b11de0bc1b3d8348f92e3b49ef1089a621506c7661fbf3248fcd54947e",
  "tokenizer_config.json": "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
  "search-keywords.bin": "445e2f19b506873911325f594bb620dd156ac0c7ced05e1dbfba34a7814ed866",
}
for (const [name, expected] of Object.entries(searchAssets)) {
  const bytes = await readFile(new URL(`src/lib/post-search/model/${name}`, root))
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`Search asset integrity mismatch: ${name}`)
  }
}

console.log("Verified immutable shared runtime releases and search assets")
