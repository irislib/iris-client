import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8")

const releases = {
  "@iris/profile-events": {
    url: "https://github.com/mmalmi/iris-kit/releases/download/runtime-v0.2.15/iris-profile-events-0.2.0.tgz",
    integrity:
      "sha512-B6groCtJFzoSCQ66ovQhDkAHcSWtN/JBNyojYmxUOGm6wgi3p1oLZ5btbGby/qzMsBFLOh9uIJ4kJBVVuxHKeQ==",
  },
  "nostr-pubsub-reconcile": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-reconcile-ts-v0.1.2/nostr-pubsub-reconcile-0.1.2.tgz",
    integrity:
      "sha512-w2N8AE2bL5h7H0tOuTONOTprHS4/SVCP93lyipA/mekk+RogF3fZFh+s2lxLEDvW5tSjIJcBdX1lguX7wD5+2g==",
  },
  "@fips/core": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.63/fips-core-0.0.58.tgz",
    integrity:
      "sha512-UW0PHboZgifo806XxYYjNGgPsKYDMA59YQSvFD0j1k5lhAofX1Yfx+kH38mTYWeTNJQKSr7cMaWqM1Ue2pSV8g==",
  },
  "@fips/transport-webrtc": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.63/fips-transport-webrtc-0.0.62.tgz",
    integrity:
      "sha512-X4fGxJvosbK62DqW9Zp8mkzMmmH8grVMxKSbtsqgWRCHNIP1nBKQdvmjeYjVG3/KTTVTZXETRQFLSM9ZS2WW7A==",
  },
  "@fips/transport-websocket": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.63/fips-transport-websocket-0.0.16.tgz",
    integrity:
      "sha512-2KUDBS9/UQ+g+vguCf5hSZBShFGZW9ffXCYXx8jQI9yL9Q8rj8mxd+bnOrv5qAVG8ymbqErI2oVCkyLkpT9cvw==",
  },
  "nostr-pubsub": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-ts-v0.5.40/nostr-pubsub-0.5.40.tgz",
    integrity:
      "sha512-nDvUCBEXacZRzM9lAEbK9Ofu03NQGAzuM4+IklXrUsvxJy8qv7vIwEDac9PbXxSjxwFuaXXwWJWYe6r4ltpO2g==",
  },
  "@hashtree/nostr": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.40/hashtree-nostr-0.2.7.tgz",
    integrity:
      "sha512-ah0pS1PDckTkz/QntsNn9D9aFPcJWb7BDjBvaVtY9gaWryiWMvXv0QaGbTU5aGIqRd32BLmnojNDXHPJ/IkIhQ==",
  },
  "@hashtree/nostr-pubsub": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-nostr-pubsub-0.1.9.tgz",
    integrity:
      "sha512-7QfJ1LwAYb8ThdA/ECXJQYxh7BjQk/gTQS+XAfnZvzjxx5YSDRjGj+7bqLtbDdIAPDuIA9dUNYCfH8oj9RLdPQ==",
  },
  "@hashtree/worker": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.41/hashtree-worker-0.4.25.tgz",
    integrity:
      "sha512-viUPl2JUtrfJENEWZPvaTtT5x73Pvj5EmHn7qjsTP5T01uOg0tDm7xJww3cf6x23LILi6drOh97ss0WWYq/KVA==",
  },
  "@hashtree/fips-transport": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.52/hashtree-fips-transport-0.5.3.tgz",
    integrity:
      "sha512-aCyAsJwA6uIePNYa7JJtkv/75xcFG/M11LB2llNAiS1qLOz1v3c681XkfHBRmeUqGWoBwyJMBHXmjvQB+vq/Mw==",
  },
  "@hashtree/dexie": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-dexie-0.1.13.tgz",
    integrity:
      "sha512-i34YCDwA+d4puwtC2f+4NreOLRC/RRTOe3PDHXctJvaqg2Ig+xpGcb2I1cbjjCY0cVJ8/BTemNYrH0LfXckPwQ==",
  },
  "@hashtree/core": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-core-0.4.0.tgz",
    integrity:
      "sha512-hdqjU1MoGjc55BL5WM93jgVxW7cYOWCWHcYUl5glUT8boEinFfmlmnhyjGp7TNwWgxZKQ7Rgag9XiyDnRUGBUA==",
  },
  "@hashtree/index": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-index-0.1.15.tgz",
    integrity:
      "sha512-EnXs4hE0fxCzQfruEsjO9YVBTpzb3Rr1k1vF6p7gLgpZ2oIEg4DEv/pZji9uj7/qJYqOa+EsZTjA0lT0SZozdA==",
  },
  "@iris/release-tools": {
    url: "https://github.com/mmalmi/iris-kit/releases/download/runtime-v0.2.12/iris-release-tools-0.1.2.tgz",
    integrity:
      "sha512-ZytyQLbDUYz/IcQ2rvUZZeFvT7FqwhRB3brZtuMwH7ILP/Jvui+ldDnKR8dNxxmIr02+PPyuv+VWKlRyaXCMbg==",
  },
  "nostr-double-ratchet": {
    url: "https://registry.npmjs.org/nostr-double-ratchet/-/nostr-double-ratchet-0.0.183.tgz",
    registryVersion: "0.0.183",
    integrity:
      "sha512-CPvJzniY+nItLVEQpH4jaRnmU7AMkD3kAN5yByXMgmm4MNChAk8X8HY8oJIw1riX/gW3/WKD8c+eUtSgu98DDA==",
  },
  "nostr-social-graph": {
    url: "https://github.com/mmalmi/nostr-social-graph/releases/download/v4.2.5/nostr-social-graph-4.2.5.tgz",
    integrity:
      "sha512-SbIf1758zSgdkOWWuxNrHmphzfEn5Y4kbD2LPkBI/sl4CrEifpzfXjNt621YD9FRElk+HTt7+HBk7Ht2HU1iyA==",
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
const verifiedHashtreeReleaseOverrides = {
  "@hashtree/fips-transport>nostr-pubsub": releases["nostr-pubsub"].url,
  "@hashtree/worker>@hashtree/core": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-core-0.4.0.tgz",
  "@hashtree/worker>@hashtree/dexie": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-dexie-0.1.13.tgz",
  "@hashtree/worker>@hashtree/mesh": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-mesh-0.3.3.tgz",
  "@hashtree/worker>@hashtree/nostr": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.40/hashtree-nostr-0.2.7.tgz",
  "@hashtree/worker>@hashtree/nostr-pubsub": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-nostr-pubsub-0.1.9.tgz",
  "@hashtree/nostr>@hashtree/collection": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-collection-0.2.11.tgz",
  "@hashtree/nostr>@hashtree/core": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-core-0.4.0.tgz",
  "@hashtree/nostr>@hashtree/index": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-index-0.1.15.tgz",
  "@hashtree/nostr-pubsub>@hashtree/nostr": "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.40/hashtree-nostr-0.2.7.tgz"
}
for (const [name, specifier] of Object.entries(manifest.pnpm?.overrides ?? {})) {
  if (name.startsWith("@hashtree/") && verifiedHashtreeReleaseOverrides[name] !== specifier) {
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
  const transportPatch = {
    "@fips/transport-webrtc": "patches/fips-transport-webrtc.patch",
    "@hashtree/fips-transport": "patches/hashtree-fips-transport.patch",
  }[name]
  if (transportPatch) {
    const version = entry.match(/^    version: (\S+)$/m)?.[1]
    const selector = `${name}@${version}`
    const hash = lockfile.split(`\n  '${selector}':\n    hash: `)[1]?.split("\n")[0]
    if (manifest.pnpm?.patchedDependencies?.[selector] !== transportPatch ||
        !hash || !lockfile.split("\nsnapshots:\n")[1].includes(`\n  '${name}@${release.url}(patch_hash=${hash})`)) {
      throw new Error(`${name} must use its consumer patch for the installed version`)
    }
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
