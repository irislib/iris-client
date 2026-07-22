import {create} from "zustand"
import {persist} from "zustand/middleware"
import {SimpleWebLNWallet} from "@/utils/webln"
import {SimpleNWCWallet} from "@/utils/nwc"
import throttle from "lodash/throttle"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.CASHU_WALLET)
const loadCashuManager = () => import("@/lib/cashu/manager")

export type WalletProviderType = "native" | "nwc" | "cashu" | "disabled" | undefined

export interface NWCConnection {
  id: string
  name: string
  connectionString: string // nostr+walletconnect://...
  wallet?: SimpleNWCWallet
  lastUsed?: number
  balance?: number
  isLocalCashuWallet?: boolean // true if this connection comes from bc:config
}

interface WalletProviderState {
  // Current active provider settings
  activeProviderType: WalletProviderType
  activeNWCId?: string

  // Provider instances
  nativeWallet: SimpleWebLNWallet | null
  activeWallet: SimpleWebLNWallet | SimpleNWCWallet | null

  // Saved NWC connections
  nwcConnections: NWCConnection[]

  // Actions
  setActiveProviderType: (type: WalletProviderType) => void
  setActiveNWCId: (id: string) => void
  setNativeWallet: (wallet: SimpleWebLNWallet | null) => void
  setActiveWallet: (wallet: SimpleWebLNWallet | SimpleNWCWallet | null) => void

  // NWC connection management
  addNWCConnection: (connection: Omit<NWCConnection, "id">) => string
  removeNWCConnection: (id: string) => void
  updateNWCConnection: (id: string, updates: Partial<NWCConnection>) => void
  connectToNWC: (id: string) => Promise<boolean>
  disconnectCurrentProvider: () => Promise<void>

  // Provider initialization
  initializeProviders: () => Promise<void>
  refreshActiveProvider: () => Promise<void>
  startCashuNWCChecking: () => void
  checkCashuNWCConnection: () => boolean
  cleanup: () => void

  // Wallet operations
  sendPayment: (invoice: string) => Promise<{preimage?: string}>
  createInvoice: (amount: number, description?: string) => Promise<{invoice: string}>
  getBalance: () => Promise<number | null | undefined>
  getInfo: () => Promise<Record<string, unknown> | null>
}

export const useWalletProviderStore = create<WalletProviderState>()(
  persist(
    (set, get) => ({
      // Initial state
      activeProviderType: undefined,
      activeNWCId: undefined,
      nativeWallet: null,
      activeWallet: null,
      nwcConnections: [],

      setActiveProviderType: (type: WalletProviderType) => {
        log("🔄 Setting active provider type to:", type)
        const prevType = get().activeProviderType
        log("🔄 Previous provider type was:", prevType)
        set({activeProviderType: type})
        get().refreshActiveProvider()
      },

      setActiveNWCId: (id: string) => {
        log("🔄 Setting active NWC ID to:", id)
        set({activeNWCId: id})
        get().refreshActiveProvider()
      },

      setNativeWallet: (wallet: SimpleWebLNWallet | null) => {
        set({nativeWallet: wallet})
        if (get().activeProviderType === "native") {
          set({activeWallet: wallet})
        }
      },

      setActiveWallet: (wallet: SimpleWebLNWallet | SimpleNWCWallet | null) => {
        set({activeWallet: wallet})
      },

      addNWCConnection: (connection: Omit<NWCConnection, "id">) => {
        const id = `nwc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        const newConnection: NWCConnection = {
          ...connection,
          id,
          lastUsed: Date.now(),
        }

        set((state) => ({
          nwcConnections: [...state.nwcConnections, newConnection],
        }))

        return id
      },

      removeNWCConnection: (id: string) => {
        const state = get()

        // If removing the active NWC connection, switch to native
        if (state.activeNWCId === id) {
          set({
            activeProviderType: "native",
            activeNWCId: undefined,
            activeWallet: state.nativeWallet,
          })
        }

        set((state) => ({
          nwcConnections: state.nwcConnections.filter((conn) => conn.id !== id),
        }))
      },

      updateNWCConnection: (id: string, updates: Partial<NWCConnection>) => {
        set((state) => ({
          nwcConnections: state.nwcConnections.map((conn) =>
            conn.id === id ? {...conn, ...updates, lastUsed: Date.now()} : conn
          ),
        }))
      },

      connectToNWC: async (id: string): Promise<boolean> => {
        log("🔌 Starting NWC connection for ID:", id)
        const state = get()
        const connection = state.nwcConnections.find((conn) => conn.id === id)

        if (!connection) {
          warn(`❌ NWC connection ${id} not found`)
          return false
        }

        log("🔌 Found connection:", {
          name: connection.name,
          isLocalCashu: connection.isLocalCashuWallet,
          hasWallet: !!connection.wallet,
          connectionStringLength: connection.connectionString?.length,
        })

        try {
          // No longer need NDK for NWC connection

          // Parse the NWC connection string
          // Format: nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>
          let pubkey: string | undefined
          let relayUrls: string[] | undefined
          let secret: string | undefined

          try {
            const url = new URL(connection.connectionString)
            pubkey = url.hostname || url.pathname.replace("/", "")

            // Get relay URLs - can be comma-separated
            const relayParam = url.searchParams.get("relay")
            if (relayParam) {
              relayUrls = relayParam
                .split(",")
                .map((r) => r.trim())
                .filter((r) => r.startsWith("wss://"))
            }

            secret = url.searchParams.get("secret") || undefined

            log("🔌 Parsed NWC parameters:", {pubkey, relayUrls, secret})

            // Validate that we have the required parameters
            if (!pubkey || !relayUrls || relayUrls.length === 0 || !secret) {
              throw new Error("Missing required NWC parameters: pubkey, relay, or secret")
            }
          } catch (parseError) {
            error(
              "❌ Failed to parse NWC connection string:",
              connection.connectionString,
              parseError
            )
            throw new Error(
              `Invalid NWC connection string format. Expected: nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>`
            )
          }

          // Create our simple NWC wallet
          log("🔌 Creating SimpleNWCWallet with:", {
            pubkey,
            relayUrls,
            hasSecret: !!secret,
          })

          const wallet = new SimpleNWCWallet({
            pubkey,
            relayUrls,
            secret,
          })

          // Connect the wallet
          await wallet.connect()

          log("🔌 SimpleNWCWallet created and connected:", {
            walletExists: !!wallet,
            walletType: wallet?.constructor?.name,
          })

          // Update the connection with the wallet
          get().updateNWCConnection(id, {wallet})

          // Set as active
          set({
            activeProviderType: "nwc",
            activeNWCId: id,
            activeWallet: wallet,
          })

          // Verify the state was updated
          const newState = get()
          log("🔌 State after setting wallet:", {
            hasActiveWallet: !!newState.activeWallet,
            activeWalletType: newState.activeWallet?.constructor?.name,
            activeNWCId: newState.activeNWCId,
            activeProviderType: newState.activeProviderType,
          })

          log("✅ NWC connection successful!")
          return true
        } catch (err) {
          error("❌ Failed to connect to NWC:", err)
          return false
        }
      },

      disconnectCurrentProvider: async () => {
        const state = get()

        // Clean up active wallet
        if (state.activeWallet) {
          // NDK wallets don't need explicit disconnect
        }

        set({
          activeProviderType: "disabled",
          activeNWCId: undefined,
          activeWallet: null,
        })
      },

      initializeProviders: async () => {
        const state = get()
        log("🔍 Initializing providers. Current state:", {
          activeProviderType: state.activeProviderType,
          nwcConnectionsCount: state.nwcConnections.length,
          activeNWCId: state.activeNWCId,
          hasActiveWallet: !!state.activeWallet,
          hasNativeWallet: !!state.nativeWallet,
        })

        // Initialize Cashu manager early if it's the active provider or if undefined (default)
        if (
          state.activeProviderType === "cashu" ||
          state.activeProviderType === undefined
        ) {
          log("🔍 Eagerly initializing Cashu manager...")
          try {
            const {initCashuManager} = await loadCashuManager()
            const manager = await initCashuManager()
            log("✅ Cashu manager initialized early")

            // Trigger immediate balance update
            try {
              const balances = await manager.wallet.getBalances()
              const totalBalance = Object.values(balances).reduce(
                (sum, val) => sum + val,
                0
              )
              // Import useWalletStore at runtime to avoid circular dependencies
              const {useWalletStore} = await import("@/stores/wallet")
              useWalletStore.getState().setBalance(totalBalance)
              log("✅ Initial balance set:", totalBalance)
            } catch (balanceError) {
              error("Failed to fetch initial balance:", balanceError)
            }
          } catch (err) {
            error("❌ Failed to initialize Cashu manager early:", err)
          }
        }

        // Only check for Cashu NWC if we don't have an active provider yet
        if (state.activeProviderType === undefined) {
          log("🔍 About to call startCashuNWCChecking...")
          get().startCashuNWCChecking()
          log("🔍 Returned from startCashuNWCChecking, continuing...")
        }

        // Only run wallet discovery if activeProviderType is undefined
        if (state.activeProviderType === undefined) {
          log("🔍 Starting wallet discovery - defaulting to Cashu")

          // Default to Cashu wallet
          set({
            activeProviderType: "cashu",
          })

          // Also check for native WebLN
          if (window.webln) {
            try {
              const nativeWallet = new SimpleWebLNWallet()
              const connected = await nativeWallet.connect()
              if (connected) {
                log("🔍 Found native WebLN, but keeping Cashu as default")
                set({nativeWallet})
              }
            } catch (error) {
              warn("Failed to enable native WebLN provider:", error)
            }
          }
        }

        // Also handle already-selected providers (not in else block anymore)
        if (
          state.activeProviderType !== undefined &&
          state.activeProviderType !== "disabled"
        ) {
          log("🔍 Provider already selected, updating providers...")
          log("🔍 Checking conditions for NWC init:", {
            activeProviderType: state.activeProviderType,
            isNWC: state.activeProviderType === "nwc",
            activeNWCId: state.activeNWCId,
            hasActiveNWCId: !!state.activeNWCId,
            condition: state.activeProviderType === "nwc" && state.activeNWCId,
          })

          // Provider already selected, just update providers
          if (window.webln && !state.nativeWallet) {
            try {
              const nativeWallet = new SimpleWebLNWallet()
              const connected = await nativeWallet.connect()
              if (connected) {
                set({nativeWallet})
                if (state.activeProviderType === "native") {
                  set({activeWallet: nativeWallet})
                }
              }
            } catch (error) {
              warn("Failed to enable native WebLN provider:", error)
            }
          }

          // Initialize active NWC connection if selected
          if (state.activeProviderType === "nwc" && state.activeNWCId) {
            log("🔍 Initializing active NWC connection:", state.activeNWCId)
            log(
              "🔍 Available NWC connections:",
              state.nwcConnections.map((c) => ({
                id: c.id,
                name: c.name,
                hasWallet: !!c.wallet,
                isLocalCashu: c.isLocalCashuWallet,
              }))
            )
            const success = await get().connectToNWC(state.activeNWCId)
            log("🔍 NWC connection result:", success)
            log("🔍 Active wallet after connection:", !!get().activeWallet)
          }
        }
      },

      refreshActiveProvider: async () => {
        const state = get()
        log("🔄 Refreshing active provider. Current state:", {
          activeProviderType: state.activeProviderType,
          activeNWCId: state.activeNWCId,
          nwcConnectionsCount: state.nwcConnections.length,
        })

        switch (state.activeProviderType) {
          case "cashu":
            log("🔄 Using Cashu wallet")
            // Cashu manager should be initialized by initializeProviders
            set({activeWallet: null})
            break

          case "native":
            log("🔄 Setting native wallet")
            set({activeWallet: state.nativeWallet})
            break

          case "nwc":
            if (state.activeNWCId) {
              const connection = state.nwcConnections.find(
                (c) => c.id === state.activeNWCId
              )
              log(
                "🔄 Looking for NWC connection:",
                state.activeNWCId,
                "found:",
                !!connection,
                "hasWallet:",
                !!connection?.wallet,
                "isLocalCashu:",
                !!connection?.isLocalCashuWallet
              )
              if (connection?.wallet) {
                log("🔄 Using existing NWC wallet")
                set({activeWallet: connection.wallet})
              } else if (state.activeNWCId) {
                log("🔄 Reconnecting to NWC:", state.activeNWCId)
                // Try to reconnect
                await get().connectToNWC(state.activeNWCId)
              }
            } else {
              log("🔄 No NWC ID set, clearing wallet")
              set({activeWallet: null})
            }
            break

          case "disabled":
          default:
            log("🔄 Disabling wallet")
            set({activeWallet: null})
            break
        }
      },

      startCashuNWCChecking: () => {
        const state = get()

        // Check if we already have a Cashu NWC connection
        const existingCashuConnection = state.nwcConnections.find(
          (conn) => conn.isLocalCashuWallet
        )

        if (existingCashuConnection) {
          log("🔍 Already have Cashu NWC connection, skipping check")
          return
        }

        log("🔍 Starting delayed Cashu NWC checking...")

        const timeoutIds: NodeJS.Timeout[] = []

        const scheduleCheck = (delay: number, attempt: number) => {
          const timeoutId = setTimeout(() => {
            log(`🔍 Cashu check attempt ${attempt} (${delay / 1000}s)`)
            const found = get().checkCashuNWCConnection()
            if (found) {
              log("🔍 Cashu NWC connection found, stopping further checks")
              // Clear any remaining scheduled checks
              timeoutIds.forEach((id) => clearTimeout(id))
            }
          }, delay)
          timeoutIds.push(timeoutId)
        }

        // Schedule checks at 3s, 5s, 10s, and 15s
        scheduleCheck(3000, 1)
        scheduleCheck(5000, 2)
        scheduleCheck(10000, 3)
        scheduleCheck(15000, 4)
      },

      checkCashuNWCConnection: (): boolean => {
        const state = get()
        log("🔍 Checking for Cashu NWC connection in localStorage...")

        try {
          const bcConfigString = localStorage.getItem("bc:config")
          if (bcConfigString) {
            log("🔍 Found bc:config in localStorage")
            const bcConfig = JSON.parse(bcConfigString)
            const cashuNWCString = bcConfig.nwcUrl

            if (cashuNWCString) {
              log("🔍 Found Cashu NWC string:", cashuNWCString.substring(0, 50) + "...")

              // Check if we already have this connection
              const existingConnection = state.nwcConnections.find(
                (conn) => conn.connectionString === cashuNWCString
              )

              if (existingConnection) {
                log("🔍 Cashu NWC connection already exists, setting as active")

                // Ensure existing connection has the isLocalCashuWallet flag
                if (!existingConnection.isLocalCashuWallet) {
                  log("🔍 Adding isLocalCashuWallet flag to existing connection")
                  get().updateNWCConnection(existingConnection.id, {
                    isLocalCashuWallet: true,
                  })
                }

                if (state.activeProviderType === undefined) {
                  set({
                    activeProviderType: "nwc",
                    activeNWCId: existingConnection.id,
                  })
                  get().refreshActiveProvider()
                }
                return true // Connection found and configured
              } else {
                log("🔍 Adding new Cashu NWC connection")
                const connectionId = get().addNWCConnection({
                  name: "Cashu Wallet",
                  connectionString: cashuNWCString,
                  isLocalCashuWallet: true,
                })

                // Set as active if no wallet type is selected yet
                if (state.activeProviderType === undefined) {
                  log("🔍 Setting Cashu NWC as active")
                  set({
                    activeProviderType: "nwc",
                    activeNWCId: connectionId,
                  })
                  get().refreshActiveProvider()
                } else {
                  log(
                    "🔍 Other wallet already active, Cashu NWC added but not set as active"
                  )
                }
                return true // New connection added
              }
            } else {
              log("🔍 No nwcUrl found in bc:config")
              return false
            }
          } else {
            log("🔍 No bc:config found in localStorage")
            return false
          }
        } catch (error) {
          warn("🔍 Error checking for Cashu NWC connection:", error)
          return false
        }
      },

      cleanup: () => {
        // NDK cleanup is handled automatically
      },

      // Wallet operations
      sendPayment: async (invoice: string) => {
        const {activeWallet, activeProviderType, nativeWallet} = get()

        // Don't save metadata here - caller should save it with correct type before calling
        // (e.g., FeedItemZap saves type "zap" with pubkey/eventId, DM saves type "dm", etc.)

        // Handle Cashu wallet
        if (activeProviderType === "cashu") {
          const {getCashuManager} = await loadCashuManager()
          const manager = getCashuManager()
          if (!manager) {
            throw new Error("Cashu manager not initialized")
          }

          // Decode invoice to get amount
          const {decode} = await import("light-bolt11-decoder")
          const decodedInvoice = decode(invoice)
          const amountSection = decodedInvoice.sections.find(
            (section: {name: string}) => section.name === "amount"
          )
          const invoiceAmountMsat =
            amountSection && "value" in amountSection ? parseInt(amountSection.value) : 0
          const invoiceAmountSat = Math.ceil(invoiceAmountMsat / 1000)

          // Get available mints with balance
          const balances = await manager.wallet.getBalances()

          // Select best mint for this payment
          const {selectMintForPayment} = await import("@/lib/cashu/mintSelection")
          const mintUrl = selectMintForPayment(balances, invoiceAmountSat)

          try {
            log("⚡ Creating melt quote for invoice:", invoice.slice(0, 30) + "...")
            const quote = await manager.quotes.createMeltQuote(mintUrl, invoice)
            log("📝 Melt quote created:", {
              quoteId: quote.quote,
              request: quote.request?.slice(0, 30) + "...",
            })
            const result = await manager.quotes.payMeltQuote(mintUrl, quote.quote)
            if (result.state !== "PAID") {
              throw new Error(
                result.state === "PENDING"
                  ? "Cashu payment is pending at the mint"
                  : "Cashu mint did not pay the invoice"
              )
            }

            return {preimage: result.payment_preimage || undefined}
          } catch (error: unknown) {
            // Check if it's a network/mint error
            const errorMessage = error instanceof Error ? error.message : String(error)
            if (
              errorMessage.includes("Failed to fetch") ||
              errorMessage.includes("NetworkError")
            ) {
              const mintDomain = mintUrl.replace(/^https?:\/\//, "").split("/")[0]
              throw new Error(
                `Cashu mint (${mintDomain}) is offline. Try again later or change mints in wallet settings.`
              )
            }
            throw error
          }
        }

        // Handle NWC wallets with our SimpleNWCWallet
        if (activeProviderType === "nwc" && activeWallet instanceof SimpleNWCWallet) {
          const result = await activeWallet.payInvoice(invoice)
          if (!result) {
            throw new Error("Payment failed")
          }
          return result
        }

        // Handle native WebLN wallets (only if explicitly active)
        if (
          activeProviderType === "native" &&
          nativeWallet instanceof SimpleWebLNWallet
        ) {
          return await nativeWallet.sendPayment(invoice)
        }

        throw new Error("No active wallet configured for payment")
      },

      createInvoice: async (amount: number, description?: string) => {
        const {activeWallet, activeProviderType} = get()

        // Handle Cashu wallet
        if (activeProviderType === "cashu") {
          const {getCashuManager} = await loadCashuManager()
          const manager = getCashuManager()
          if (!manager) {
            throw new Error("Cashu manager not initialized")
          }

          // Get available mints
          const mints = await manager.mint.getAllMints()
          if (mints.length === 0) {
            throw new Error("No mints configured. Add a mint first.")
          }

          // Use active mint if set, otherwise first mint
          const {useCashuWalletStore} = await import("@/stores/cashuWallet")
          const activeMint = useCashuWalletStore.getState().activeMint
          const mintUrl =
            activeMint && mints.some((m) => m.mintUrl === activeMint)
              ? activeMint
              : mints[0].mintUrl
          const quote = await manager.quotes.createMintQuote(mintUrl, amount, description)

          return {invoice: quote.request}
        }

        if (!activeWallet) {
          throw new Error("No wallet connected")
        }

        // Check if it's our SimpleNWC wallet
        if (activeProviderType === "nwc" && activeWallet instanceof SimpleNWCWallet) {
          const result = await activeWallet.makeInvoice(amount, description)
          if (result) {
            return result
          }
          throw new Error("Failed to create invoice")
        }

        // Handle native WebLN wallets
        if (
          activeProviderType === "native" &&
          activeWallet instanceof SimpleWebLNWallet
        ) {
          return await activeWallet.makeInvoice(amount, description)
        }

        throw new Error("Invoice creation not supported for this wallet type")
      },

      getBalance: throttle(
        async () => {
          try {
            const {activeWallet, activeProviderType} = get()
            log(
              "🔍 getBalance called (throttled), activeProviderType:",
              activeProviderType,
              "hasActiveWallet:",
              !!activeWallet
            )

            // Handle Cashu wallet
            if (activeProviderType === "cashu") {
              const {getCashuManager} = await loadCashuManager()
              const manager = getCashuManager()
              if (!manager) {
                log("🔍 Cashu manager not initialized yet")
                return null
              }
              const balances = await manager.wallet.getBalances()
              const totalBalance = Object.values(balances).reduce(
                (sum, val) => sum + val,
                0
              )
              log("🔍 Cashu wallet balance:", totalBalance)
              return totalBalance
            }

            if (!activeWallet) {
              log("🔍 No active wallet, returning null")
              return null
            }

            // Handle NWC wallets with our SimpleNWCWallet
            if (activeProviderType === "nwc" && activeWallet instanceof SimpleNWCWallet) {
              log("🔍 Using SimpleNWCWallet for balance request")
              const balance = await activeWallet.getBalance()
              return balance
            }

            // Handle native WebLN wallets
            if (
              activeProviderType === "native" &&
              activeWallet instanceof SimpleWebLNWallet
            ) {
              log("🔍 Using SimpleWebLNWallet for balance request")
              const balance = await activeWallet.getBalance()
              return balance
            }

            return 0
          } catch (err) {
            error("Failed to get balance:", err)
            return null
          }
        },
        3000, // Throttle to max once per 3 seconds
        {leading: true, trailing: false} // Execute on first call, skip trailing calls
      ),

      getInfo: async () => {
        try {
          const {activeWallet} = get()

          if (!activeWallet) {
            return null
          }

          // NDK wallets don't have a direct getInfo method
          return null
        } catch (err) {
          error("Failed to get wallet info:", err)
          return null
        }
      },
    }),
    {
      name: "wallet-provider-store",
      partialize: (state) => ({
        activeProviderType: state.activeProviderType,
        activeNWCId: state.activeNWCId,
        nwcConnections: state.nwcConnections.map((conn) => ({
          // Don't persist the wallet instance, only connection info
          id: conn.id,
          name: conn.name,
          connectionString: conn.connectionString,
          lastUsed: conn.lastUsed,
          balance: conn.balance,
          isLocalCashuWallet: conn.isLocalCashuWallet,
        })),
      }),
    }
  )
)
