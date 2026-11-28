import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8")
const packages = lockfile.split("\npackages:\n")[1]?.split("\nsnapshots:\n")[0] ?? ""

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
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.67/fips-core-0.0.62.tgz",
    integrity:
      "sha512-nhmnwt0CULZUVB0gvILlP3QtLzV44jx0veQjyAtWt4CZsDg/u2ij1AsBbThxodgSkmeg7BaynpbHlzR7RoHEaQ==",
  },
  "@fips/transport-webrtc": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.67/fips-transport-webrtc-0.0.66.tgz",
    integrity:
      "sha512-1/36va6D8Ifcgs0pnd5RQ3wm8x9/vEjTW1p9Eu6e4tztoTtywqjXI9uTAWgpVbNY/88wQTD9kq2stO8iW0Octg==",
  },
  "@fips/transport-websocket": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.67/fips-transport-websocket-0.0.20.tgz",
    integrity:
      "sha512-uXpPKMjAXKteHWiPfSvHjBGGfwgZ5Y3IFTO52eYOjh4EqVeHWxNbV2RBYvAP+49paFw88D+JySYLrUWRHy56Hg==",
  },
  "nostr-pubsub": {
    url: "https://github.com/mmalmi/nostr-pubsub/releases/download/nostr-pubsub-ts-v0.5.42/nostr-pubsub-0.5.42.tgz",
    integrity:
      "sha512-kuEV8FVRU3zPtwTgG95JhztEkPBPV4wQ8Jv+pD6EHF/UfKS/3RpsB/q/+yd6ms9CM/obdbh6xNItOUrSvvBusw==",
  },
  "@hashtree/nostr": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.40/hashtree-nostr-0.2.7.tgz",
    integrity:
      "sha512-ah0pS1PDckTkz/QntsNn9D9aFPcJWb7BDjBvaVtY9gaWryiWMvXv0QaGbTU5aGIqRd32BLmnojNDXHPJ/IkIhQ==",
  },
  "@hashtree/nostr-pubsub": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.53/hashtree-nostr-pubsub-0.1.12.tgz",
    integrity:
      "sha512-nwn5lRLx9RqVLFmsDmLc/eXq43L46DcSBecrYqu4Lh2lMe6VLDaL8LkqPdfmAnSUMqyfmePYT/OVsNqBdYG7Nw==",
  },
  "@hashtree/worker": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.53/hashtree-worker-0.4.34.tgz",
    integrity:
      "sha512-ULYVXSmGJl2+1n+5JoYkdsZJQN7nq5JXNRGtkqPpkVoBjzSC1SGHQKVtgLi5qt2u5C6mRwVHdl6r3jfJQHIBAA==",
  },
  "@hashtree/fips-transport": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.54/hashtree-fips-transport-0.5.5.tgz",
    integrity:
      "sha512-2irLSCqOWgDVsxLUVSuS+qYvqvYXJC9644VMvNuOPR+cBAPiayItYCHOCMJHSdOInbveVK1hpWBuVYfitHSZ+Q==",
  },
  "@hashtree/dexie": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.46/hashtree-dexie-0.1.15.tgz",
    integrity:
      "sha512-YPn2gh0QQQRMcZY3zYmkycLqBjKJhA8GEmWq2/LPSbD0441YEQPCkWvTfAgRUsXA+gvjxB51tvqev1caXylp8A==",
  },
  "@hashtree/core": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.42/hashtree-core-0.4.2.tgz",
    integrity:
      "sha512-9gPIe39QJoCUtVo8VhbDOX5bHAtGlJ2EZlQJqKh3l9++2CY1Njg2LINXQWBgKRqB0P2LBKoDpyYz1XIBoJ/SMw==",
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
    url: "https://github.com/mmalmi/nostr-social-graph/releases/download/v4.2.6/nostr-social-graph-4.2.6.tgz",
    integrity:
      "sha512-JND4ImunW/tH8SotXjWqvgXH0sCEX2xYiRHwAWnBRN2zkDk0WPmMcrK3qBIztGML03uMv4Dfjl8M5K/ykBKz1A==",
  },
  "@hashtree/collection": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-collection-0.2.11.tgz",
    integrity:
      "sha512-FI6cVBneXSgOEAEeZH6Yv12eC+pZpG2kTCHc9Bt4+bW6Vu0nVNo5V3Gtt5Dk9p8l7G47sq/R9CBbo6A0D+dVwA==",
  },
  "@hashtree/mesh": {
    url: "https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.27/hashtree-mesh-0.3.3.tgz",
    integrity:
      "sha512-fiLvKjbEO1J/fuj6wcLGjI3RPsPrGgSuc2O+QqN/vX3OSHI7uPS+feH49vFduUMHYM79Yvsrq6MV2XDUiGq59A==",
  },
  "@fips/browser": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.67/fips-browser-0.0.27.tgz",
    integrity:
      "sha512-++9RRUijRnyiKy8QFTIGc/tUkqDrpWKis5M2Tw51WF9O9eMxPjYLRs1fApSlw6l51ZufFJ+H7UdbDNYaLmIKzA==",
  },
  "@fips/transport-ethernet": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.67/fips-transport-ethernet-0.0.44.tgz",
    integrity:
      "sha512-gTm5+p/StSjEYmW4tIx4MtLxjqFsefKbB2TtkMswiEcWehH8QNs9NOSKgeHmD84DELhMLSMVVcF+ZJ8u2m6Waw==",
  },
  "@fips/transport-memory": {
    url: "https://github.com/mmalmi/fips-ts/releases/download/runtime-v0.0.67/fips-transport-memory-0.0.22.tgz",
    integrity:
      "sha512-Px083zQ69ee0OMD1n6RvUntFezGg3H0pSRGHIw0L+V9VyU3NZKM9Caz5Yg+TSSgdanwhTyWdJArH6nmyHdScbw==",
  },
  "@fips/tcp": {
    url: "https://github.com/mmalmi/fips-tcp/releases/download/fips-tcp-ts-v0.2.6/fips-tcp-0.2.6.tgz",
    integrity:
      "sha512-lXQHNwTZEyXGYWqzRlNyKpb2UgNWJOon6HljbY1F1Ey49Q9IoE/kdF84gaTkrCpMPS8M/A6y5FTaFPOLl60+bw==",
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
// The corrected runtime cohort is shared by every direct and nested consumer.
// Runtime54 preserves original URLs for unchanged Hashtree packages.
const cohort = Object.keys(releases).filter(
  (name) =>
    name.startsWith("@hashtree/") ||
    name.startsWith("@fips/") ||
    name === "nostr-pubsub" ||
    name === "nostr-social-graph"
)
for (const name of cohort) {
  if (manifest.pnpm?.overrides?.[name] !== releases[name].url) {
    throw new Error(`${name} must override all consumers with its verified release`)
  }
}
for (const name of Object.keys(manifest.pnpm?.overrides ?? {})) {
  if (name.includes(">") && cohort.includes(name.split(">").at(-1))) {
    throw new Error(`Parent-specific override ${name} splits the verified runtime cohort`)
  }
}

for (const [name, release] of Object.entries(releases)) {
  if (name in declared && declared[name] !== release.url) {
    throw new Error(`${name} must use immutable release ${release.url}`)
  }

  // pnpm normalizes registry tarball URLs to an exact version and integrity.
  const resolution = release.registryVersion ?? release.url
  const quotedKey = `  '${name}@${resolution}':`
  const plainKey = `  ${name}@${resolution}:`
  const start = Math.max(packages.indexOf(quotedKey), packages.indexOf(plainKey))
  const end = packages.indexOf("\n\n", start)
  const entry = start >= 0 ? packages.slice(start, end < 0 ? undefined : end) : ""
  const entries = packages
    .split("\n")
    .filter((line) => line.startsWith(`  '${name}@`) || line.startsWith(`  ${name}@`))
  if (start < 0 && entries.length === 0 && !(name in declared)) continue
  if (entries.length !== 1) {
    throw new Error(`${name} must have exactly one verified runtime resolution`)
  }
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
    if (
      manifest.pnpm?.patchedDependencies?.[selector] !== transportPatch ||
      !hash ||
      !lockfile
        .split("\nsnapshots:\n")[1]
        .includes(`\n  '${name}@${release.url}(patch_hash=${hash})`)
    ) {
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
  "search-tag-head.json":
    "7abebd58ec9bf8b94322a362236ee0a983cf0dae1cf590efcea60c98777a8442",
  "search-minilm-gpu.onnx":
    "92c024a385492196a88dd8043617176929952ece58f763683c3eeec7902856d4",
  "search-minilm-q8.onnx":
    "b190f50dd46296b9895ae8f274c3455762d08610f8788f4a9bd15019f4f7160c",
  "search-tokenizer.json":
    "2fc687b11de0bc1b3d8348f92e3b49ef1089a621506c7661fbf3248fcd54947e",
  "tokenizer_config.json":
    "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
  "search-keywords.bin":
    "445e2f19b506873911325f594bb620dd156ac0c7ced05e1dbfba34a7814ed866",
}
for (const [name, expected] of Object.entries(searchAssets)) {
  const bytes = await readFile(new URL(`src/lib/post-search/model/${name}`, root))
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`Search asset integrity mismatch: ${name}`)
  }
}

console.log("Verified immutable shared runtime releases and search assets")
