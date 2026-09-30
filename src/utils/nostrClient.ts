import {relayHints} from "@/lib/nostr/relayPolicy"
import NostrClient, {
  ClientOptions,
  ExtensionSigner,
  SecretKeySigner,
  Relay,
  User,
  normalizeRelayUrl,
} from "@/lib/nostr"
import {WorkerTransport} from "@/lib/nostr-transport-worker"
import {useUserStore} from "@/stores/user"
import {DEFAULT_RELAYS} from "@/shared/constants/relays"
import {isTouchDevice} from "@/shared/utils/isTouchDevice"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {getInjectedHtreeRelayUrl} from "@/utils/nativeHtree"
import {resolveRelayRuntimeConfig, type RelayRuntimeConfig} from "@/utils/relayRuntime"
import {irisClientTagOptions} from "@/utils/clientTag"
const {log, error} = createDebugLogger(DEBUG_NAMESPACES.NDK_RELAY)

let clientInstance: NostrClient | null = null
let privateKeySigner: SecretKeySigner | undefined
let nip07Signer: ExtensionSigner | undefined
let initPromise: Promise<void> | null = null
let workerTransport: WorkerTransport | undefined

export {DEFAULT_RELAYS}

/**
 * Get worker transport instance (only available when worker transport enabled)
 */
export function getWorkerTransport(): WorkerTransport | undefined {
  return workerTransport
}

// Don't create placeholder - will be created in initNostr with proper transport
// Early calls to nostr() will trigger initNostr automatically

/**
 * Get a singleton "default" NostrClient instance to get started quickly. If you want to init NostrClient with e.g. your own relays, pass them on the first call.
 *
 * This needs to be called to make nip07 login features work.
 * Automatically triggers initialization if not already started.
 * @throws Error if NostrClient init options are passed after the first call
 */
export const nostr = (opts?: ClientOptions): NostrClient => {
  if (!clientInstance && !initPromise) {
    // Auto-initialize on first access
    initNostr()
  }
  if (opts) {
    throw new Error("NostrClient instance already initialized, cannot pass options")
  }
  // Return instance even if still initializing - transport will queue messages
  return clientInstance!
}

/**
 * Initialize NostrClient with worker transport and relay connections.
 * Can be called without awaiting - messages will queue until ready.
 */
export async function initNostr(opts?: ClientOptions): Promise<NostrClient> {
  if (initPromise) {
    await initPromise
    return clientInstance!
  }

  const store = useUserStore.getState()
  const enabledRelays =
    store.relayConfigs
      ?.filter((config) => !config.disabled)
      .map((config) => config.url) || []
  const relayRuntime = resolveRelayRuntimeConfig({
    enabledRelayUrls: enabledRelays,
    explicitRelayUrls: opts?.explicitRelayUrls,
    injectedHtreeRelayUrl: getInjectedHtreeRelayUrl(),
    forceLocalRelayEnv: import.meta.env.VITE_USE_LOCAL_RELAY,
    storeNdkOutboxModel: store.ndkOutboxModel,
    storeAutoConnectUserRelays: store.autoConnectUserRelays,
  })

  // Create instance immediately so nostr() returns it synchronously
  clientInstance = new NostrClient({
    ...irisClientTagOptions,
    ...opts,
    explicitRelayUrls: relayRuntime.explicitRelayUrls,
    enableOutboxModel: relayRuntime.enableOutboxModel,
    autoConnectUserRelays: relayRuntime.autoConnectUserRelays,
  })

  // Create worker transport - it owns relay connectivity and search indexing.
  const workerFactory = () =>
    new Worker(new URL("../workers/relay-worker.ts", import.meta.url), {
      type: "module",
    })
  workerTransport = new WorkerTransport(workerFactory)

  // Start configuration asynchronously (but don't block return)
  initPromise = performInit(relayRuntime)
  await initPromise
  return clientInstance!
}

async function performInit(relayRuntime: RelayRuntimeConfig) {
  const store = useUserStore.getState()
  const relays = relayRuntime.relayUrls

  log("Initializing NostrClient with enabled relays:", relays)
  if (relayRuntime.pinnedRelayUrls?.[0]) {
    log(
      "Routing NostrClient through injected htree daemon relay:",
      relayRuntime.pinnedRelayUrls[0]
    )
  }

  // Log when using test relay
  if (import.meta.env.VITE_USE_TEST_RELAY) {
    log("🧪 Using test relay only: wss://temp.iris.to/")
  }

  const enableOutbox = relayRuntime.enableOutboxModel
  const autoConnectUserRelays = relayRuntime.autoConnectUserRelays

  log(
    "Initializing NostrClient with outbox model:",
    enableOutbox,
    "autoConnectUserRelays:",
    autoConnectUserRelays
  )

  // Connect transport (registers as plugin and sends init).
  workerTransport!.connect(clientInstance!, relays, {
    disableExtraRelayUrls: relayRuntime.disableExtraRelayUrls,
  })

  const nostr = clientInstance!

  // Set up initial signer if we have a private key
  if (store.privateKey && typeof store.privateKey === "string") {
    try {
      privateKeySigner = new SecretKeySigner(store.privateKey)
      if (!store.nip07Login) {
        nostr.signer = privateKeySigner
      }
    } catch (e) {
      error("Error setting initial private key signer:", e)
    }
  }

  // Set up NIP-07 signer if enabled
  if (store.nip07Login) {
    nip07Signer = new ExtensionSigner()
    nostr.signer = nip07Signer
  }

  // Set initial activeUser from store (important for cache queries after refresh)
  if (store.publicKey) {
    nostr.activeUser = new User({hexpubkey: store.publicKey})
    log("Set initial activeUser:", store.publicKey.slice(0, 16) + "...")
  }

  void import("@/lib/peerRuntime")
    .then(async ({getPeerRuntime, setRetainedEventReader}) => {
      if (workerTransport) setRetainedEventReader(workerTransport.retainedEventReader)
      const peers = await getPeerRuntime()
      if (peers) workerTransport?.attachPeerSource(peers.source)
    })
    .catch((error) => console.warn("Peer startup failed", error))
  if (relayRuntime.autoConnectUserRelays) {
    let ownList: ReturnType<NostrClient["subscribe"]> | undefined
    let current = ""
    const followOwnRelays = () => {
      const pubkey = useUserStore.getState().publicKey
      if (pubkey === current) return
      current = pubkey
      ownList?.stop()
      if (!pubkey) return
      ownList = nostr.subscribe({kinds: [10002], authors: [pubkey]})
      ownList.on("event", (event) => {
        for (const url of relayHints([event], "read", 8))
          if (!nostr.pool.relays.has(url))
            nostr.pool.addRelay(new Relay(url, undefined, nostr))
      })
    }
    useUserStore.subscribe(followOwnRelays)
    followOwnRelays()
  }
  watchLocalSettings(nostr, relayRuntime)

  // Setup visibility reconnection (forwards to worker)
  setupVisibilityReconnection()

  log("NostrClient instance initialized")
}

/**
 * Setup listeners for visibility changes and network status to force immediate reconnection
 */
function setupVisibilityReconnection() {
  let wasHidden = false

  const reconnectDisconnectedRelays = (reason: string) => {
    workerTransport?.reconnectDisconnected?.(reason)
  }

  // Handle visibility changes (PWA/mobile only - desktop keeps WS open)
  // Network events handled in worker directly
  if (isTouchDevice) {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        wasHidden = true
        return
      }

      // App returned to foreground
      if (wasHidden) {
        wasHidden = false
        reconnectDisconnectedRelays("App returned to foreground")
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Handle page show event for iOS PWAs
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        reconnectDisconnectedRelays("Page shown from cache")
      }
    })

    // Handle focus event as fallback
    window.addEventListener("focus", () => {
      if (wasHidden) {
        wasHidden = false
        reconnectDisconnectedRelays("App focused")
      }
    })
  }
}

function watchLocalSettings(instance: NostrClient, relayRuntime: RelayRuntimeConfig) {
  useUserStore.subscribe((state, prevState) => {
    // Outbox model changes are handled by page reload in Network.tsx
    // No need to recreate NostrClient instance here
    if (state.privateKey !== prevState.privateKey) {
      const havePrivateKey = state.privateKey && typeof state.privateKey === "string"
      if (havePrivateKey) {
        try {
          privateKeySigner = new SecretKeySigner(state.privateKey)
          if (!state.nip07Login) {
            instance.signer = privateKeySigner
          }
        } catch (e) {
          error("Error setting private key signer:", e)
        }
      } else {
        privateKeySigner = undefined
        if (!state.nip07Login) {
          instance.signer = undefined
        }
      }
    }

    if (state.nip07Login) {
      if (!nip07Signer) {
        nip07Signer = new ExtensionSigner()
        instance.signer = nip07Signer
        nip07Signer
          .user()
          .then((user) => {
            useUserStore.getState().setPublicKey(user.pubkey)
          })
          .catch((e) => {
            error("Error getting NIP-07 user:", e)
            useUserStore.getState().setNip07Login(false)
          })
      }
    } else {
      nip07Signer = undefined
      instance.signer = privateKeySigner
    }

    // Handle both legacy relays array and new relayConfigs
    const shouldUpdateRelays =
      state.relays !== prevState.relays || state.relayConfigs !== prevState.relayConfigs

    if (shouldUpdateRelays) {
      if (relayRuntime.pinnedRelayUrls) {
        return
      }

      // Use relayConfigs if available, otherwise fall back to relays array
      const relayList =
        state.relayConfigs && state.relayConfigs.length > 0
          ? state.relayConfigs
          : state.relays.map((url) => ({url})) // No disabled flag means enabled

      if (Array.isArray(relayList)) {
        const normalizedPoolUrls = Array.from(instance.pool.relays.keys()).map(
          normalizeRelayUrl
        )

        // Process each relay config
        relayList.forEach((config) => {
          const relayConfig = typeof config === "string" ? {url: config} : config // No disabled flag means enabled

          const isEnabled = !("disabled" in relayConfig) || !relayConfig.disabled // If no disabled flag, it's enabled
          const normalizedUrl = normalizeRelayUrl(relayConfig.url)
          const existsInPool = normalizedPoolUrls.includes(normalizedUrl)

          if (isEnabled && !existsInPool) {
            // Add and connect to new relay
            const relay = new Relay(relayConfig.url, undefined, instance)
            instance.pool.addRelay(relay)
            relay.connect()
          } else if (!isEnabled && existsInPool) {
            // Remove disabled relay from pool entirely
            // removeRelay handles disconnect internally
            const removed =
              instance.pool.removeRelay(relayConfig.url) ||
              instance.pool.removeRelay(normalizedUrl)
            if (removed) {
              log("Removed disabled relay from pool:", relayConfig.url)
            }
          } else if (isEnabled && existsInPool) {
            // Ensure enabled relay is connected
            const relay =
              instance.pool.relays.get(relayConfig.url) ||
              instance.pool.relays.get(normalizedUrl)
            if (relay && relay.status !== 1) {
              // 1 = connected
              relay.connect()
            }
          }
        })
      }
    }
  })
}
