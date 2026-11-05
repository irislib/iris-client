import {
  LEGACY_IRIS_BLOSSOM_URL,
  getDefaultServers,
} from "@/pages/settings/mediaservers-utils"
import {persist} from "zustand/middleware"
import {create} from "zustand"
import {DEFAULT_RELAYS, DEFAULT_PRIVATE_RELAYS} from "@/shared/constants/relays"
type MediaServerProtocol = "blossom" | "nip96"

interface MediaServer {
  url: string
  protocol: MediaServerProtocol
  isDefault?: boolean
}

export interface RelayConfig {
  url: string
  disabled?: boolean // If not set, relay is enabled by default
}

interface UserState {
  publicKey: string
  privateKey: string

  nip07Login: boolean
  linkedDevice: boolean

  DHTPublicKey: string
  DHTPrivateKey: string

  relays: string[]
  privateRelays: string[]
  relayConfigs: RelayConfig[]
  mediaservers: MediaServer[]
  defaultMediaserver: MediaServer | null

  walletConnect: boolean
  defaultZapAmount: number
  defaultZapComment: string
  ndkOutboxModel: boolean
  autoConnectUserRelays: boolean
  followRelayHints: boolean

  zapDonationEnabled: boolean
  zapDonationRecipients: Array<{
    recipient: string // npub or lightning address
    percentage: number
  }>
  zapDonationMinAmount: number

  hasHydrated: boolean

  setPublicKey: (publicKey: string) => void
  setPrivateKey: (privateKey: string) => void
  setNip07Login: (nip07Login: boolean) => void
  setLinkedDevice: (linkedDevice: boolean) => void
  setDHTPublicKey: (DHTPublicKey: string) => void
  setDHTPrivateKey: (DHTPrivateKey: string) => void
  setRelays: (relays: string[]) => void
  setRelayConfigs: (configs: RelayConfig[]) => void
  toggleRelayConnection: (url: string) => void
  addRelay: (url: string, disabled?: boolean) => void
  removeRelay: (url: string) => void
  setMediaservers: (mediaservers: MediaServer[]) => void
  setDefaultMediaserver: (server: MediaServer) => void
  addMediaserver: (server: MediaServer) => void
  removeMediaserver: (url: string) => void
  setWalletConnect: (walletConnect: boolean) => void
  setDefaultZapAmount: (defaultZapAmount: number) => void
  setDefaultZapComment: (defaultZapComment: string) => void
  setNdkOutboxModel: (ndkOutboxModel: boolean) => void
  setAutoConnectUserRelays: (autoConnectUserRelays: boolean) => void
  setFollowRelayHints: (followRelayHints: boolean) => void
  setZapDonationEnabled: (enabled: boolean) => void
  setZapDonationRecipients: (
    recipients: Array<{recipient: string; percentage: number}>
  ) => void
  addZapDonationRecipient: (recipient: string, percentage: number) => void
  removeZapDonationRecipient: (recipient: string) => void
  updateZapDonationRecipient: (recipient: string, percentage: number) => void
  setZapDonationMinAmount: (amount: number) => void
  reset: () => void
  ensureDefaultMediaserver: (isSubscriber: boolean) => void
  awaitHydration: () => Promise<void>
}

let hydrationPromise: Promise<void> | null = null
let resolveHydration: (() => void) | null = null
let hydrationFinished = false

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => {
      const initialState = {
        publicKey: "",
        privateKey: "",
        nip07Login: false,
        linkedDevice: false,
        DHTPublicKey: "",
        DHTPrivateKey: "",
        relays: DEFAULT_RELAYS,
        privateRelays: DEFAULT_PRIVATE_RELAYS,
        relayConfigs: DEFAULT_RELAYS.map((url) => ({url})),
        mediaservers: [],
        defaultMediaserver: null,
        walletConnect: false,
        defaultZapAmount: 0,
        defaultZapComment: "",
        ndkOutboxModel: !import.meta.env.VITE_USE_LOCAL_RELAY,
        autoConnectUserRelays: !import.meta.env.VITE_USE_LOCAL_RELAY,
        followRelayHints: false,
        zapDonationEnabled: false,
        zapDonationRecipients: [
          {
            recipient: "npub10pensatlcfwktnvjjw2dtem38n6rvw8g6fv73h84cuacxn4c28eqyfn34f",
            percentage: 5,
          },
        ],
        zapDonationMinAmount: 1,
        hasHydrated: false,
      }

      const actions = {
        setPublicKey: (publicKey: string) => set({publicKey}),
        setPrivateKey: (privateKey: string) => set({privateKey}),
        setNip07Login: (nip07Login: boolean) => set({nip07Login}),
        setLinkedDevice: (linkedDevice: boolean) => set({linkedDevice}),
        setDHTPublicKey: (DHTPublicKey: string) => set({DHTPublicKey}),
        setDHTPrivateKey: (DHTPrivateKey: string) => set({DHTPrivateKey}),
        setRelays: (relays: string[]) => {
          // When setting relays, update both old relays array and new relayConfigs
          // Keep existing configs for known relays, add new ones as enabled (no disabled flag)
          set((state) => {
            const existingConfigs = new Map(state.relayConfigs.map((c) => [c.url, c]))
            const newConfigs = relays.map(
              (url) => existingConfigs.get(url) || {url} // No disabled flag means enabled
            )
            return {
              relays,
              relayConfigs: newConfigs,
              privateRelays: newConfigs
                .filter((config) => !config.disabled)
                .map((config) => config.url),
            }
          })
        },
        setRelayConfigs: (configs: RelayConfig[]) => {
          // Update both relayConfigs and relays array (for backward compatibility)
          const enabledRelays = configs.filter((c) => !c.disabled).map((c) => c.url)
          set({
            relayConfigs: configs,
            relays: enabledRelays,
            privateRelays: enabledRelays,
          })
        },
        toggleRelayConnection: (url: string) => {
          set((state) => {
            const configs = state.relayConfigs.map((c) =>
              c.url === url ? {...c, disabled: !c.disabled} : c
            )
            const enabledRelays = configs.filter((c) => !c.disabled).map((c) => c.url)
            return {
              relayConfigs: configs,
              relays: enabledRelays,
              privateRelays: enabledRelays,
            }
          })
        },
        addRelay: (url: string, disabled: boolean = false) => {
          set((state) => {
            // Check if relay already exists
            if (state.relayConfigs.some((c) => c.url === url)) {
              return state
            }
            const newConfig = disabled ? {url, disabled} : {url}
            const configs = [...state.relayConfigs, newConfig]
            const enabledRelays = configs.filter((c) => !c.disabled).map((c) => c.url)
            return {
              relayConfigs: configs,
              relays: enabledRelays,
              privateRelays: enabledRelays,
            }
          })
        },
        removeRelay: (url: string) => {
          set((state) => {
            const configs = state.relayConfigs.filter((c) => c.url !== url)
            const enabledRelays = configs.filter((c) => !c.disabled).map((c) => c.url)
            return {
              relayConfigs: configs,
              relays: enabledRelays,
              privateRelays: enabledRelays,
            }
          })
        },
        setMediaservers: (mediaservers: MediaServer[]) => set({mediaservers}),
        setDefaultMediaserver: (server: MediaServer) => set({defaultMediaserver: server}),
        addMediaserver: (server: MediaServer) =>
          set((state) => ({
            mediaservers: [...new Set([...state.mediaservers, server])],
          })),
        removeMediaserver: (url: string) =>
          set((state) => ({
            mediaservers: state.mediaservers.filter((s) => s.url !== url),
          })),
        setWalletConnect: (walletConnect: boolean) => set({walletConnect}),
        setDefaultZapAmount: (defaultZapAmount: number) => set({defaultZapAmount}),
        setDefaultZapComment: (defaultZapComment: string) => set({defaultZapComment}),
        setNdkOutboxModel: (ndkOutboxModel: boolean) => set({ndkOutboxModel}),
        setAutoConnectUserRelays: (autoConnectUserRelays: boolean) =>
          set({autoConnectUserRelays}),
        setFollowRelayHints: (followRelayHints: boolean) => set({followRelayHints}),
        setZapDonationEnabled: (enabled: boolean) => set({zapDonationEnabled: enabled}),
        setZapDonationRecipients: (
          recipients: Array<{recipient: string; percentage: number}>
        ) => set({zapDonationRecipients: recipients}),
        addZapDonationRecipient: (recipient: string, percentage: number) =>
          set((state) => ({
            zapDonationRecipients: [
              ...state.zapDonationRecipients,
              {recipient, percentage},
            ],
          })),
        removeZapDonationRecipient: (recipient: string) =>
          set((state) => ({
            zapDonationRecipients: state.zapDonationRecipients.filter(
              (r) => r.recipient !== recipient
            ),
          })),
        updateZapDonationRecipient: (recipient: string, percentage: number) =>
          set((state) => ({
            zapDonationRecipients: state.zapDonationRecipients.map((r) =>
              r.recipient === recipient ? {recipient, percentage} : r
            ),
          })),
        setZapDonationMinAmount: (amount: number) => set({zapDonationMinAmount: amount}),
        reset: () => set(initialState),
        ensureDefaultMediaserver: (isSubscriber: boolean) =>
          set((state) => {
            if (!state.defaultMediaserver) {
              const defaults = getDefaultServers(isSubscriber)
              return {
                mediaservers: defaults,
                defaultMediaserver: defaults[0],
              }
            }
            return {}
          }),
        awaitHydration: () => {
          if (hydrationFinished || get().hasHydrated) return Promise.resolve()
          if (!hydrationPromise) {
            hydrationPromise = new Promise<void>((resolve) => {
              resolveHydration = resolve
            })
          }
          return hydrationPromise
        },
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "user-storage",
      version: 3, // Bump version to trigger media server migration
      merge: (persistedState, currentState) => {
        const saved = (persistedState || {}) as Partial<UserState>
        // Inspect persisted fields before merging defaults. Empty and disabled
        // lists are intentional; legacy relay-only settings are authoritative too.
        const relayConfigs: RelayConfig[] = Array.isArray(saved.relayConfigs)
          ? saved.relayConfigs
          : Array.isArray(saved.relays)
            ? saved.relays.map((url) => ({url}))
            : currentState.relayConfigs
        return {
          ...currentState,
          ...saved,
          relayConfigs,
          // A saved relay choice governed both kinds of traffic before this
          // split. Only a truly fresh store receives distinct private defaults.
          privateRelays: Array.isArray(saved.privateRelays)
            ? saved.privateRelays
            : Array.isArray(saved.relayConfigs) || Array.isArray(saved.relays)
              ? relayConfigs
                  .filter((config) => !config.disabled)
                  .map((config) => config.url)
              : currentState.privateRelays,
          relays: relayConfigs
            .filter((config) => !config.disabled)
            .map((config) => config.url),
        }
      },
      onRehydrateStorage: () => (state, error) => {
        if (state) {
          state.hasHydrated = true
        }

        if (error) {
          console.warn("[Iris] user store rehydrate failed:", error)
          try {
            localStorage.removeItem("user-storage")
          } catch {
            // Storage may be unavailable; startup should still continue with defaults.
          }
        }

        hydrationFinished = true
        if (resolveHydration) {
          resolveHydration()
          resolveHydration = null
          hydrationPromise = null
        }
      },
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Record<string, unknown>
        if (version <= 2) {
          const defaultFallbacks = getDefaultServers(false)
          const persistedMediaServers = Array.isArray(state.mediaservers)
            ? (state.mediaservers as MediaServer[]).filter(
                (server) => server?.url && server.url !== LEGACY_IRIS_BLOSSOM_URL
              )
            : []

          const seen = new Set(persistedMediaServers.map((server) => server.url))
          const mediaservers = [...persistedMediaServers]
          for (const server of defaultFallbacks) {
            if (!seen.has(server.url)) {
              mediaservers.push(server)
              seen.add(server.url)
            }
          }

          state.mediaservers = mediaservers

          const persistedDefault = state.defaultMediaserver as
            MediaServer | null | undefined
          state.defaultMediaserver =
            persistedDefault && persistedDefault.url !== LEGACY_IRIS_BLOSSOM_URL
              ? persistedDefault
              : mediaservers[0] || defaultFallbacks[0]
        }

        return state
      },
    }
  )
)

export const usePublicKey = () => useUserStore((state) => state.publicKey)
