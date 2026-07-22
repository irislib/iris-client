import {useWalletStore} from "@/stores/wallet"
import {useWalletProviderStore} from "@/stores/walletProvider"
import {useEffect, useRef} from "react"

const loadCashuManager = async () => {
  const {initCashuManager} = await import("@/lib/cashu/manager")
  return initCashuManager()
}

export const useWalletBalance = () => {
  const {balance, setBalance} = useWalletStore()
  const {activeProviderType, activeNWCId, nwcConnections} = useWalletProviderStore()
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    let disposed = false
    let unsubscribers: Array<() => void> = []
    const setCurrentBalance = (value: number | null) => {
      if (!disposed) setBalance(value)
    }

    // Clear any existing intervals
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    const updateBalance = async () => {
      if (disposed) return
      try {
        // No wallet selected
        if (activeProviderType === "disabled" || activeProviderType === undefined) {
          setCurrentBalance(null)
          return
        }

        // Cashu wallet
        if (activeProviderType === "cashu") {
          const manager = await loadCashuManager()
          const balances = await manager.wallet.getBalances()
          const totalBalance = Object.values(balances).reduce((sum, val) => sum + val, 0)
          setCurrentBalance(totalBalance)
          return
        }

        // NWC wallet
        if (activeProviderType === "nwc" && activeNWCId) {
          const connection = nwcConnections.find((c) => c.id === activeNWCId)
          if (connection?.balance !== undefined) {
            setCurrentBalance(connection.balance)
          } else {
            setCurrentBalance(null)
          }
          return
        }

        // Native WebLN - most don't support balance
        if (activeProviderType === "native") {
          setCurrentBalance(null)
          return
        }

        setCurrentBalance(null)
      } catch (error) {
        if (!disposed) console.warn("Failed to get wallet balance:", error)
        setCurrentBalance(null)
      }
    }

    // Initial update
    updateBalance()

    // Listen to Cashu events for real-time updates
    if (activeProviderType === "cashu") {
      void loadCashuManager()
        .then((manager) => {
          if (disposed) return
          unsubscribers = [
            manager.on("melt-quote:paid", () => updateBalance()),
            manager.on("send:created", () => updateBalance()),
            manager.on("receive:created", () => updateBalance()),
            manager.on("mint-quote:redeemed", () => updateBalance()),
            manager.on("proofs:saved", () => updateBalance()),
          ]
        })
        .catch((error) => {
          if (!disposed) {
            console.warn("Failed to initialize Cashu balance updates:", error)
          }
        })
    }

    // Poll every 30 seconds as a backup if a provider update is missed.
    pollIntervalRef.current = setInterval(updateBalance, 30000)

    return () => {
      disposed = true
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [setBalance, activeProviderType, activeNWCId, nwcConnections])

  return {balance}
}
