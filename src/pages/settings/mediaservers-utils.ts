export const LEGACY_IRIS_BLOSSOM_URL = "https://blossom.iris.to"

export const MEDIASERVERS = {
  iris: {
    url: "https://upload.iris.to",
    protocol: "blossom" as const,
  },
  blossom_band: {
    url: "https://blossom.band",
    protocol: "blossom" as const,
  },
  primal: {
    url: "https://blossom.primal.net",
    protocol: "blossom" as const,
  },
  nostr_build: {
    url: "https://blossom.nostr.build",
    protocol: "blossom" as const,
  },
  nostr_check: {
    url: "https://cdn.nostrcheck.me",
    protocol: "nip96" as const,
  },
}

export function getDefaultServers(isSubscriber: boolean) {
  return isSubscriber
    ? [
        MEDIASERVERS.iris,
        MEDIASERVERS.blossom_band,
        MEDIASERVERS.primal,
        MEDIASERVERS.nostr_build,
        MEDIASERVERS.nostr_check,
      ]
    : [
        MEDIASERVERS.blossom_band,
        MEDIASERVERS.primal,
        MEDIASERVERS.nostr_build,
        MEDIASERVERS.nostr_check,
      ]
}

export function stripHttps(url: string) {
  return url.replace(/^https?:\/\//, "")
}
