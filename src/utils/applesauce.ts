import {EventStore} from "applesauce-core"
import {RelayGroup, RelayPool, PublishResponse} from "applesauce-relay"
import {SimpleSigner, ExtensionSigner} from "applesauce-signers"
import {normalizeToSecretKey} from "applesauce-core/helpers"
import {
  EventTemplate,
  generateSecretKey,
  getPublicKey,
  nip19,
  NostrEvent,
  Filter,
} from "nostr-tools"
import {bytesToHex, hexToBytes} from "@noble/hashes/utils"
import {useUserStore} from "@/stores/user"

type ISigner = {
  getPublicKey: () => Promise<string>
  signEvent: (template: EventTemplate) => Promise<NostrEvent>
}

let poolInstance: RelayPool | null = null
let eventStoreInstance: EventStore | null = null
let simpleSigner: SimpleSigner | undefined
let extensionSigner: ExtensionSigner | undefined
let isInitialized = false

/**
 * Default relays to use when initializing the pool
 */
export const DEFAULT_RELAYS = [
  "wss://temp.iris.to",
  "wss://vault.iris.to",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
]

/**
 * Get a singleton relay pool instance
 */
export const getPool = (): RelayPool => {
  if (!poolInstance) {
    poolInstance = new RelayPool()
  }
  return poolInstance
}

/**
 * Get a relay group with default relays
 */
export const getGroup = (): RelayGroup => {
  const pool = getPool()
  return pool.group(DEFAULT_RELAYS)
}

/**
 * Get a singleton event store instance
 */
export const getEventStore = (): EventStore => {
  if (!eventStoreInstance) {
    eventStoreInstance = new EventStore()
  }
  return eventStoreInstance
}

/**
 * Get the current signer based on user preferences
 */
export const getCurrentSigner = (): ISigner | undefined => {
  const store = useUserStore.getState()

  if (store.nip07Login && extensionSigner) {
    return extensionSigner as ISigner
  }

  if (store.privateKey && simpleSigner) {
    return simpleSigner
  }

  return undefined
}

/**
 * Initialize the applesauce system similar to how NDK was initialized
 */
export const initApplesauce = () => {
  if (isInitialized) {
    return
  }

  const store = useUserStore.getState()

  // Initialize pool and event store
  getPool()
  getEventStore()

  // Set up initial signer if we have a private key
  if (store.privateKey && typeof store.privateKey === "string") {
    try {
      simpleSigner = new SimpleSigner(normalizeToSecretKey(store.privateKey))
    } catch (e) {
      console.error("Error setting initial private key signer:", e)
    }
  }

  // Set up extension signer if enabled
  if (store.nip07Login) {
    extensionSigner = new ExtensionSigner()
  }

  // Watch for changes in user settings
  watchUserSettings()

  isInitialized = true
  console.log("Applesauce initialized")
}

function watchUserSettings() {
  useUserStore.subscribe((state, prevState) => {
    if (state.privateKey !== prevState.privateKey) {
      const havePrivateKey = state.privateKey && typeof state.privateKey === "string"
      if (havePrivateKey) {
        try {
          simpleSigner = new SimpleSigner(normalizeToSecretKey(state.privateKey))
        } catch (e) {
          console.error("Error setting private key signer:", e)
        }
      } else {
        simpleSigner = undefined
      }
    }

    if (state.nip07Login && !prevState.nip07Login) {
      extensionSigner = new ExtensionSigner()
      Promise.resolve(extensionSigner.getPublicKey())
        .then((pubkey: string) => {
          useUserStore.getState().setPublicKey(pubkey)
        })
        .catch((e: unknown) => {
          console.error("Error getting extension public key:", e)
          useUserStore.getState().setNip07Login(false)
        })
    } else if (!state.nip07Login && prevState.nip07Login) {
      extensionSigner = undefined
    }
  })
}

/**
 * Create a new account (keypair), login with it and publish a profile event with the given name
 * @param name
 */
export async function newUserLogin(name: string) {
  const sk = generateSecretKey() // `sk` is a Uint8Array
  const pk = getPublicKey(sk) // `pk` is a hex string
  const privateKeyHex = bytesToHex(sk)

  const store = useUserStore.getState()
  store.setPrivateKey(privateKeyHex)
  store.setPublicKey(pk)

  simpleSigner = new SimpleSigner(normalizeToSecretKey(privateKeyHex))

  // Create and publish profile event
  const profileTemplate: EventTemplate = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({name}),
  }

  console.log("🔐 Signing profile event for new user:", name)
  const signedEvent = await simpleSigner!.signEvent(profileTemplate)
  console.log("✅ Profile event signed:", signedEvent)

  // Publish to default relays
  const pool = getPool()
  console.log("📡 Publishing profile to relays:", DEFAULT_RELAYS)

  try {
    // Use the group method and collect all publish responses
    const group = pool.group(DEFAULT_RELAYS)
    // The event method returns Observable<PublishResponse>, collect all responses
    const publishResponses: PublishResponse[] = []
    await new Promise<void>((resolve, reject) => {
      const subscription = group.event(signedEvent).subscribe({
        next: (response: PublishResponse) => {
          publishResponses.push(response)
        },
        error: (error) => reject(error),
        complete: () => resolve(),
      })
      // Add timeout to prevent hanging
      setTimeout(() => {
        subscription.unsubscribe()
        resolve()
      }, 10000)
    })
    console.log("📤 Profile publish responses:", publishResponses)

    const successfulPublishes = publishResponses.filter(
      (response: PublishResponse) => response.ok
    )
    const failedPublishes = publishResponses.filter(
      (response: PublishResponse) => !response.ok
    )

    if (successfulPublishes.length > 0) {
      console.log(
        `✅ Profile published successfully to ${successfulPublishes.length}/${publishResponses.length} relays:`,
        signedEvent.id
      )
    }

    if (failedPublishes.length > 0) {
      console.warn(
        `⚠️ Failed to publish profile to ${failedPublishes.length}/${publishResponses.length} relays:`
      )
      failedPublishes.forEach((response: PublishResponse) => {
        console.warn(`❌ ${response.from}: ${response.message || "Unknown error"}`)
      })
    }
  } catch (error) {
    console.error("❌ Failed to publish profile:", error)
    throw error
  }
}

/**
 * Login with a private key
 * @param privateKey - hex or nsec format
 */
export function privateKeyLogin(privateKey: string) {
  if (privateKey && typeof privateKey === "string") {
    const bytes =
      privateKey.indexOf("nsec1") === 0
        ? (nip19.decode(privateKey).data as Uint8Array)
        : hexToBytes(privateKey)
    const hex = bytesToHex(bytes)
    simpleSigner = new SimpleSigner(normalizeToSecretKey(hex))
    const publicKey = getPublicKey(bytes)

    const store = useUserStore.getState()
    store.setPrivateKey(hex)
    store.setPublicKey(publicKey)
  }
}

/**
 * Subscribe to events with filters
 */
export function subscribeToEvents(
  relays: string[],
  filters: Filter | Filter[],
  onEvent: (event: NostrEvent) => void,
  options?: {closeOnEose?: boolean}
) {
  const pool = getPool()
  const group = pool.group(relays)
  const subscription = group.req(filters)

  return subscription.subscribe({
    next: (response) => {
      if (response === "EOSE" && options?.closeOnEose) {
        // Handle EOSE
      } else if (typeof response !== "string") {
        // It's a NostrEvent
        onEvent(response)
      }
    },
    error: (error) => {
      console.error("Subscription error:", error)
    },
  })
}

/**
 * Check relay connection status
 */
export function getRelayConnectionStatus() {
  const pool = getPool()
  const status = new Map()

  for (const [url, relay] of pool.relays) {
    status.set(url, {
      connected: relay.connected,
      url: url,
    })
  }

  return status
}

/**
 * Publish an event
 */
export async function publishEvent(template: EventTemplate, relayUrls?: string[]) {
  const signer = getCurrentSigner()
  if (!signer) {
    throw new Error("No signer available")
  }

  console.log("🔐 Signing event:", template)
  const signedEvent = await signer.signEvent(template)
  console.log("✅ Event signed:", signedEvent)

  // Add to event store immediately for local availability
  const eventStore = getEventStore()
  eventStore.add(signedEvent)
  console.log("💾 Event added to local store:", signedEvent.id)

  // Try to publish to relays but don't fail the entire function if this fails
  const pool = getPool()
  const relays = relayUrls && relayUrls.length > 0 ? relayUrls : DEFAULT_RELAYS
  console.log("📡 Publishing to relays:", relays)

  // Check relay connection status
  const connectionStatus = getRelayConnectionStatus()
  console.log("🔗 Relay connections:", connectionStatus)

  try {
    // Use the group method and collect all publish responses
    const group = pool.group(relays)
    // The event method returns Observable<PublishResponse>, collect all responses
    const publishResponses: PublishResponse[] = []
    await new Promise<void>((resolve, reject) => {
      const subscription = group.event(signedEvent).subscribe({
        next: (response: PublishResponse) => {
          publishResponses.push(response)
        },
        error: (error) => reject(error),
        complete: () => resolve(),
      })
      // Add timeout to prevent hanging
      setTimeout(() => {
        subscription.unsubscribe()
        resolve()
      }, 10000)
    })
    console.log("📤 Publish responses:", publishResponses)

    const successfulPublishes = publishResponses.filter(
      (response: PublishResponse) => response.ok
    )
    const failedPublishes = publishResponses.filter(
      (response: PublishResponse) => !response.ok
    )

    if (successfulPublishes.length > 0) {
      console.log(
        `✅ Event published successfully to ${successfulPublishes.length}/${publishResponses.length} relays:`,
        signedEvent.id
      )
      console.log(
        "📤 Successful relays:",
        successfulPublishes.map((r: PublishResponse) => r.from)
      )
    }

    if (failedPublishes.length > 0) {
      console.warn(
        `⚠️ Failed to publish to ${failedPublishes.length}/${publishResponses.length} relays:`
      )
      failedPublishes.forEach((response: PublishResponse) => {
        console.warn(`❌ ${response.from}: ${response.message || "Unknown error"}`)
      })
    }

    if (publishResponses.length === 0) {
      console.warn(
        "⚠️ No relays responded to publish request, but event is available locally"
      )
    }
  } catch (error) {
    console.warn("⚠️ Failed to publish to relays, but event is available locally:", error)
    console.log("🔗 Relay status after error:", getRelayConnectionStatus())
    // Don't throw the error - event is still available locally
  }

  return signedEvent
}

/**
 * Subscribe to events - compatible with applesauce-simple interface
 * This version checks both the local event store and subscribes to relays
 */
export function subscribe(
  filters: Filter | Filter[],
  _options?: {closeOnEose?: boolean},
  relays?: string[]
) {
  const pool = getPool()
  const eventStore = getEventStore()
  const relayUrls = relays || DEFAULT_RELAYS
  const group = pool.group(relayUrls)
  const subscription = group.req(filters)
  let rxjsSubscription: {unsubscribe: () => void} | null = null

  return {
    on: (eventType: string, callback: (event: NostrEvent) => void) => {
      if (eventType === "event") {
        // First, query the local event store for existing events
        try {
          const filtersArray = Array.isArray(filters) ? filters : [filters]
          const existingEventsStream = eventStore.filters(filtersArray)
          const subscription = existingEventsStream.subscribe({
            next: (event) => {
              console.log("📦 Found existing event in store:", event.id)
              callback(event)
            },
            error: (error) => {
              console.warn("Failed to query event store:", error)
            },
          })
          // Unsubscribe immediately since we just want the existing events
          setTimeout(() => subscription.unsubscribe(), 100)
        } catch (error) {
          console.warn("Failed to query event store:", error)
        }

        // Then, subscribe to new events from relays
        rxjsSubscription = subscription.subscribe({
          next: (response) => {
            if (typeof response !== "string") {
              console.log("📡 Received new event from relay:", response.id)
              callback(response)
            }
          },
          error: (error) => {
            console.error("Subscription error:", error)
          },
        })
      }
    },
    stop: () => {
      if (rxjsSubscription) {
        rxjsSubscription.unsubscribe()
        rxjsSubscription = null
      }
    },
  }
}

/**
 * Fetch multiple events by filter from relays
 */
export async function fetchEvents(
  filter: Filter | Filter[],
  relays: string[] = DEFAULT_RELAYS
) {
  const pool = getPool()
  const group = pool.group(relays)
  const events = await group.req(filter).toPromise()
  return Array.isArray(events) ? events : []
}

/**
 * Fetch a single event by ID
 */
export async function fetchEvent(eventId: string, relays: string[] = DEFAULT_RELAYS) {
  const pool = getPool()
  const group = pool.group(relays)
  const events = await group.req({ids: [eventId]}).toPromise()
  return Array.isArray(events) && events.length > 0 ? events[0] : null
}
