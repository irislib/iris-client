import NDK, {
  NDKConstructorParams,
  NDKNip07Signer,
  NDKPrivateKeySigner,
  NDKRelay,
  NDKRelayAuthPolicies,
  NDKUser,
} from "@/lib/ndk"
import {NDKWorkerTransport} from "@/lib/ndk-transport-worker"
import {NDKTauriTransport} from "@/lib/ndk-transport-tauri"
import {useUserStore} from "@/stores/user"
import {useSettingsStore} from "@/stores/settings"
import {DEFAULT_RELAYS} from "@/shared/constants/relays"
import {isTouchDevice} from "@/shared/utils/isTouchDevice"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {isTauri} from "@/utils/utils"
const {log, error} = createDebugLogger(DEBUG_NAMESPACES.NDK_RELAY)

let ndkInstance: NDK | null = null
let privateKeySigner: NDKPrivateKeySigner | undefined
let nip07Signer: NDKNip07Signer | undefined
let initPromise: Promise<void> | null = null
let workerTransport: NDKWorkerTransport | undefined
let tauriTransport: NDKTauriTransport | undefined

function normalizeRelayUrl(url: string): string {
  // Ensure URL ends with / to match NDK's internal normalization
  return url.endsWith("/") ? url : url + "/"
}

export {DEFAULT_RELAYS}

/**
 * Get worker transport instance (only available when worker transport enabled)
 */
export function getWorkerTransport(): NDKWorkerTransport | undefined {
  return workerTransport
}

/**
 * Get Tauri transport instance (only available in Tauri mode)
 */
export function getTauriTransport(): NDKTauriTransport | undefined {
  return tauriTransport
}

// Don't create placeholder - will be created in initNDK with proper transport
// Early calls to ndk() will trigger initNDK automatically

/**
 * Get a singleton "default" NDK instance to get started quickly. If you want to init NDK with e.g. your own relays, pass them on the first call.
 *
 * This needs to be called to make nip07 login features work.
 * Automatically triggers initialization if not already started.
 * @throws Error if NDK init options are passed after the first call
 */
export const ndk = (opts?: NDKConstructorParams): NDK => {
  if (!ndkInstance && !initPromise) {
    // Auto-initialize on first access
    initNDK()
  }
  if (opts) {
    throw new Error("NDK instance already initialized, cannot pass options")
  }
  // Return instance even if still initializing - transport will queue messages
  return ndkInstance!
}

/**
 * Initialize NDK with worker transport and relay connections.
 * Can be called without awaiting - messages will queue until ready.
 */
export async function initNDK(opts?: NDKConstructorParams): Promise<NDK> {
  if (initPromise) {
    await initPromise
    return ndkInstance!
  }

  // Create instance immediately so ndk() returns it synchronously
  ndkInstance = new NDK({explicitRelayUrls: []})

  // Create transport immediately (before any subscriptions)
  if (isTauri()) {
    tauriTransport = new NDKTauriTransport()
  } else {
    const worker = new Worker(new URL("../workers/relay-worker.ts", import.meta.url), {
      type: "module",
    })
    workerTransport = new NDKWorkerTransport(worker)
  }

  // Start configuration asynchronously (but don't block return)
  initPromise = performInit(opts)
  await initPromise
  return ndkInstance!
}

async function performInit(opts?: NDKConstructorParams) {
  const store = useUserStore.getState()

  // Only include enabled relays
  const enabledRelays =
    store.relayConfigs?.filter((c) => !c.disabled).map((c) => c.url) || []
  const relays = opts?.explicitRelayUrls || enabledRelays

  log("Initializing NDK with enabled relays:", relays)

  // Log when using test relay
  if (import.meta.env.VITE_USE_TEST_RELAY) {
    log("🧪 Using test relay only: wss://temp.iris.to/")
  }

  const enableOutbox = import.meta.env.VITE_USE_LOCAL_RELAY ? false : store.ndkOutboxModel

  const autoConnectUserRelays = import.meta.env.VITE_USE_LOCAL_RELAY
    ? false
    : store.autoConnectUserRelays

  log(
    "Initializing NDK with outbox model:",
    enableOutbox,
    "autoConnectUserRelays:",
    autoConnectUserRelays
  )

  // Transport already created in initNDK()
  // Connect it synchronously (registers itself and sends init)
  const transport = isTauri() ? tauriTransport : workerTransport
  transport!.connect(ndkInstance!, relays) // Don't await - queues messages

  const ndk = ndkInstance!

  // Set up initial signer if we have a private key
  if (store.privateKey && typeof store.privateKey === "string") {
    try {
      privateKeySigner = new NDKPrivateKeySigner(store.privateKey)
      if (!store.nip07Login) {
        ndk.signer = privateKeySigner
      }
    } catch (e) {
      error("Error setting initial private key signer:", e)
    }
  }

  // Set up NIP-07 signer if enabled
  if (store.nip07Login) {
    nip07Signer = new NDKNip07Signer()
    ndk.signer = nip07Signer
  }

  // Set initial activeUser from store (important for cache queries after refresh)
  if (store.publicKey) {
    ndk.activeUser = new NDKUser({hexpubkey: store.publicKey})
    log("Set initial activeUser:", store.publicKey.slice(0, 16) + "...")
  }

  watchLocalSettings(ndk)
  ndk.relayAuthDefaultPolicy = NDKRelayAuthPolicies.signIn({ndk})

  // Setup visibility reconnection (forwards to worker)
  setupVisibilityReconnection()

  log("NDK instance initialized", ndk)
}

/**
 * Setup listeners for visibility changes and network status to force immediate reconnection
 */
function setupVisibilityReconnection() {
  let wasHidden = false

  const reconnectDisconnectedRelays = (reason: string) => {
    // Forward to transport
    const transport = isTauri() ? tauriTransport : workerTransport
    transport?.reconnectDisconnected?.(reason)
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

function watchLocalSettings(instance: NDK) {
  useUserStore.subscribe((state, prevState) => {
    // Outbox model changes are handled by page reload in Network.tsx
    // No need to recreate NDK instance here
    if (state.privateKey !== prevState.privateKey) {
      const havePrivateKey = state.privateKey && typeof state.privateKey === "string"
      if (havePrivateKey) {
        try {
          privateKeySigner = new NDKPrivateKeySigner(state.privateKey)
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
        nip07Signer = new NDKNip07Signer()
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
            const relay = new NDKRelay(relayConfig.url, undefined, instance)
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
