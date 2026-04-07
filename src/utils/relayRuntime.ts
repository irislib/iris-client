export interface ResolveRelayRuntimeConfigOptions {
  enabledRelayUrls: string[]
  explicitRelayUrls?: string[]
  injectedHtreeRelayUrl?: string | null
  forceLocalRelayEnv: boolean
  storeNdkOutboxModel: boolean
  storeAutoConnectUserRelays: boolean
}

export interface RelayRuntimeConfig {
  relayUrls: string[]
  explicitRelayUrls: string[]
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

  return {
    relayUrls,
    explicitRelayUrls: relayUrls,
    pinnedRelayUrls: injectedRelayUrls,
    enableOutboxModel: localRelayOnlyMode ? false : options.storeNdkOutboxModel,
    autoConnectUserRelays: localRelayOnlyMode
      ? false
      : options.storeAutoConnectUserRelays,
    disableExtraRelayUrls: localRelayOnlyMode,
  }
}

export function buildWorkerRelayUrls(options: BuildWorkerRelayUrlsOptions): string[] {
  const relayUrls =
    options.relayUrls && options.relayUrls.length > 0
      ? options.relayUrls
      : options.defaultRelayUrls
  const extraRelayUrls = options.disableExtraRelayUrls ? [] : options.extraRelayUrls || []

  return uniqueRelayUrls([...relayUrls, ...extraRelayUrls])
}
