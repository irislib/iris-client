import {useState, useCallback} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import type {HistoryEntry} from "@/lib/cashu/core/models/History"
import {IndexedDbRepositories} from "@/lib/cashu/indexeddb/index"
import {
  getNPubCashBalance,
  claimNPubCashTokens,
  extractMintFromToken,
} from "@/lib/npubcash"
import {ndk} from "@/utils/ndk"
import type {EnrichedHistoryEntry} from "./useHistoryEnrichment"

const meltQuoteRepos = new IndexedDbRepositories({name: "iris-cashu-db"})
let meltQuoteReposInitialized = false

const ensureMeltQuoteReposInit = async () => {
  if (!meltQuoteReposInitialized) {
    await meltQuoteRepos.init()
    meltQuoteReposInitialized = true
  }
}

export function useWalletRefresh(
  manager: Manager | null,
  myPubKey: string | null,
  enrichHistoryWithMetadata: (entries: HistoryEntry[]) => Promise<EnrichedHistoryEntry[]>
) {
  const [refreshing, setRefreshing] = useState(false)

  const refreshData = useCallback(
    async (immediate = false) => {
      if (!manager) {
        console.warn("⚠️ No manager available for refresh")
        return
      }
      console.log(
        "🔄 Refreshing Cashu wallet data...",
        immediate ? "(immediate)" : "(delayed)"
      )
      try {
        // Add small delay to let cashu persist changes (unless immediate refresh)
        if (!immediate) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }

        const bal = await manager.wallet.getBalances()
        console.log("💰 Balance fetched:", bal)

        const hist = await manager.history.getPaginatedHistory(0, 1000)
        console.log(
          "📜 Raw history entries from manager:",
          hist.length,
          hist.map((h) => ({
            type: h.type,
            amount: h.amount,
            timestamp: h.createdAt,
          }))
        )

        const enrichedHist = await enrichHistoryWithMetadata(hist)
        console.log("✅ Wallet data refreshed, history count:", enrichedHist.length)

        return {balance: bal, history: enrichedHist}
      } catch (error) {
        console.error("❌ Failed to refresh data:", error)
        throw error
      }
    },
    [manager, enrichHistoryWithMetadata]
  )

  const handleRefresh = useCallback(
    async (balance: {[mintUrl: string]: number} | null) => {
      console.log("🔄 Manual refresh button clicked")
      setRefreshing(true)
      try {
        // Check and redeem pending mint quotes (for stuck incoming Lightning payments)
        if (manager) {
          console.log("🔍 Checking and requeueing paid mint quotes")
          try {
            const result = await manager.quotes.requeuePaidMintQuotes()
            console.log(
              `✅ Requeued ${result.requeued.length} paid mint quotes for redemption`
            )
            if (result.requeued.length > 0) {
              console.log("⏳ Waiting for quotes to be processed...")
              // Give processor time to redeem quotes
              await new Promise((resolve) => setTimeout(resolve, 3000))
            }
          } catch (err) {
            console.error("Failed to requeue mint quotes:", err)
          }

          // Force recalculate balance from all proofs in database
          console.log("🔍 Recalculating balance from all proofs")
          try {
            const freshBalance = await manager.wallet.getBalances()
            console.log("💰 Fresh balance:", freshBalance)
          } catch (err) {
            console.error("Failed to recalculate balance:", err)
          }
        }

        // Check pending melt quotes (for stuck outgoing Lightning payments)
        if (manager && balance) {
          const mints = Object.keys(balance)
          console.log("🔍 Checking pending melt quotes on mints:", mints)
          for (const mintUrl of mints) {
            try {
              // Force check by calling mint API directly
              const {CashuMint} = await import("@cashu/cashu-ts")
              const mint = new CashuMint(mintUrl)

              // Get pending quotes from our DB
              await ensureMeltQuoteReposInit()
              const pendingQuotes =
                await meltQuoteRepos.meltQuoteRepository.getPendingMeltQuotes()

              console.log(`📋 Found ${pendingQuotes.length} pending melt quotes`)

              // Check each one
              for (const quote of pendingQuotes) {
                try {
                  const status = await mint.checkMeltQuote(quote.quote)
                  console.log(`🔎 Quote ${quote.quote}: ${status.state}`)

                  if (status.state === "PAID" && quote.state !== "PAID") {
                    console.log(`✅ Quote ${quote.quote} is now PAID, updating...`)
                    await meltQuoteRepos.meltQuoteRepository.setMeltQuoteState(
                      quote.mintUrl,
                      quote.quote,
                      "PAID"
                    )
                  }
                } catch (err) {
                  console.error(`Failed to check quote ${quote.quote}:`, err)
                }
              }
            } catch (err) {
              console.error(`Failed to check mint ${mintUrl}:`, err)
            }
          }
        }

        const data = await refreshData(true) // immediate = true for manual refresh

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
                    console.log(`✅ Auto-added mint from npub.cash token: ${mintUrl}`)
                  } catch (error) {
                    console.log(`Mint already exists or failed to add: ${mintUrl}`)
                  }
                }

                await manager.wallet.receive(token)
                return await refreshData(true)
              }
            }
          }
        }

        return data
      } catch (error) {
        console.error("Failed to refresh:", error)
        throw error
      } finally {
        setRefreshing(false)
      }
    },
    [manager, myPubKey, refreshData]
  )

  return {refreshing, refreshData, handleRefresh}
}
