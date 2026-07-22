import {useState, useCallback} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import type {HistoryEntry} from "@/lib/cashu/core/models/History"
import {
  getNPubCashBalance,
  claimNPubCashTokens,
  extractMintFromToken,
} from "@/lib/npubcash"
import {ndk} from "@/utils/ndk"
import type {EnrichedHistoryEntry} from "./useHistoryEnrichment"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.CASHU_WALLET)

export function useWalletRefresh(
  manager: Manager | null,
  myPubKey: string | null,
  enrichHistoryWithMetadata: (entries: HistoryEntry[]) => Promise<EnrichedHistoryEntry[]>
) {
  const [refreshing, setRefreshing] = useState(false)

  const refreshData = useCallback(async () => {
    if (!manager) {
      warn("⚠️ No manager available for refresh")
      return
    }
    log("🔄 Refreshing Cashu wallet data...")
    try {
      const bal = await manager.wallet.getBalances()
      log("💰 Balance fetched:", bal)

      const hist = await manager.history.getPaginatedHistory(0, 1000)
      log(
        "📜 Raw history entries from manager:",
        hist.length,
        hist.map((h) => ({
          type: h.type,
          amount: h.amount,
          timestamp: h.createdAt,
        }))
      )

      const enrichedHist = await enrichHistoryWithMetadata(hist)
      log("✅ Wallet data refreshed, history count:", enrichedHist.length)

      return {balance: bal, history: enrichedHist}
    } catch (err) {
      error("❌ Failed to refresh data:", err)
      throw err
    }
  }, [manager, enrichHistoryWithMetadata])

  const handleRefresh = useCallback(
    async (_balance: {[mintUrl: string]: number} | null) => {
      log("🔄 Manual refresh button clicked")
      setRefreshing(true)
      try {
        // Check and redeem pending mint quotes (for stuck incoming Lightning payments)
        if (manager) {
          log("🔍 Checking and requeueing paid mint quotes")
          try {
            const result = await manager.quotes.requeuePaidMintQuotes()
            log(`✅ Requeued ${result.requeued.length} paid mint quotes for redemption`)
            if (result.requeued.length > 0) {
              log("⏳ Waiting for quotes to be processed...")
              // Give processor time to redeem quotes
              await new Promise((resolve) => setTimeout(resolve, 3000))
            }
          } catch (err) {
            error("Failed to requeue mint quotes:", err)
          }

          // Force recalculate balance from all proofs in database
          log("🔍 Recalculating balance from all proofs")
          try {
            const freshBalance = await manager.wallet.getBalances()
            log("💰 Fresh balance:", freshBalance)
          } catch (err) {
            error("Failed to recalculate balance:", err)
          }
        }

        // Reconcile persisted outgoing Lightning payments, including wallets whose
        // pending melt consumed their entire ready balance.
        if (manager) {
          log("🔍 Reconciling pending melt quotes")
          const result = await manager.quotes.reconcilePendingMelts()
          log("✅ Melt quote reconciliation complete", {
            paid: result.paid.length,
            unpaid: result.unpaid.length,
            pending: result.pending.length,
            failed: result.failed.length,
          })
        }

        const data = await refreshData()

        // Also check npub.cash
        if (myPubKey && ndk().signer) {
          const signer = ndk().signer
          if (signer) {
            const balance = await getNPubCashBalance(signer)
            if (balance > 0) {
              const token = await claimNPubCashTokens(signer)
              if (token && manager) {
                // Extract mint URL from token and ensure it's added
                const mintUrl = await extractMintFromToken(token)
                if (mintUrl) {
                  try {
                    await manager.mint.addMint(mintUrl)
                    log(`✅ Auto-added mint from npub.cash token: ${mintUrl}`)
                  } catch (err) {
                    log(`Mint already exists or failed to add: ${mintUrl}`)
                  }
                }

                await manager.wallet.receive(token)
                return await refreshData()
              }
            }
          }
        }

        return data
      } catch (err) {
        error("Failed to refresh:", err)
        throw err
      } finally {
        setRefreshing(false)
      }
    },
    [manager, myPubKey, refreshData]
  )

  return {refreshing, refreshData, handleRefresh}
}
