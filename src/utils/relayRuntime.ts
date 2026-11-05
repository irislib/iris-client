export interface ResolveRelayRuntimeConfigOptions {
  enabledRelayUrls: string[]
  explicitRelayUrls?: string[]
  privateRelayUrls?: string[]
  injectedHtreeRelayUrl?: string | null
  forceLocalRelayEnv: boolean
  storeNdkOutboxModel: boolean
  storeAutoConnectUserRelays: boolean
}

export interface RelayRuntimeConfig {
  relayUrls: string[]
  explicitRelayUrls: string[]
  privateRelayUrls: string[]
  pinnedRelayUrls: string[] | null
  enableOutboxModel: boolean
  autoConnectUserRelays: boolean
  disableExtraRelayUrls: boolean
}

export interface BuildWorkerRelayUrlsOptions {
  relayUrls?: string[]
  defaultRelayUrls: string[]
  extraRelayUrls?: string[]
  disableExtraRelayUrls?: boolean
}

function uniqueRelayUrls(urls: string[]): string[] {
  return Array.from(
    new Set(urls.filter((url) => typeof url === "string" && url.length > 0))
  )
}

export function resolveRelayRuntimeConfig(
  options: ResolveRelayRuntimeConfigOptions
): RelayRuntimeConfig {
  const configuredRelayUrls = options.explicitRelayUrls || options.enabledRelayUrls
  const injectedRelayUrls = options.injectedHtreeRelayUrl
    ? [options.injectedHtreeRelayUrl]
    : null
  const localRelayOnlyMode = options.forceLocalRelayEnv || !!injectedRelayUrls
  const relayUrls = uniqueRelayUrls(injectedRelayUrls || configuredRelayUrls)
  const disableExtraRelayUrls = localRelayOnlyMode || relayUrls.length === 0

  return {
    relayUrls,
    explicitRelayUrls: relayUrls,
    privateRelayUrls: uniqueRelayUrls(
      injectedRelayUrls ||
        (localRelayOnlyMode
          ? relayUrls
          : (options.privateRelayUrls ?? configuredRelayUrls))
    ),
    pinnedRelayUrls: injectedRelayUrls,
    enableOutboxModel: disableExtraRelayUrls ? false : options.storeNdkOutboxModel,
    autoConnectUserRelays: disableExtraRelayUrls
      ? false
      : options.storeAutoConnectUserRelays,
    disableExtraRelayUrls,
  }
}

export function buildWorkerRelayUrls(options: BuildWorkerRelayUrlsOptions): string[] {
  if (options.relayUrls?.length === 0) return []
  const relayUrls = options.relayUrls ?? options.defaultRelayUrls
  const extraRelayUrls = options.disableExtraRelayUrls ? [] : options.extraRelayUrls || []

  return uniqueRelayUrls([...relayUrls, ...extraRelayUrls])
}
