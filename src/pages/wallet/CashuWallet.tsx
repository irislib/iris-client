import {useState, useEffect, useCallback, useRef} from "react"
import {initCashuManager, getCashuManager} from "@/lib/cashu/manager"
import type {Manager} from "@/lib/cashu/core/index"
import type {SendHistoryEntry, HistoryEntry} from "@/lib/cashu/core/models/History"
import type {Token} from "@cashu/cashu-ts"
import RightColumn from "@/shared/components/RightColumn"
import Widget from "@/shared/components/ui/Widget"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import {useCashuWalletStore} from "@/stores/cashuWallet"
import {useWalletProviderStore} from "@/stores/walletProvider"
import {RiArrowRightUpLine, RiArrowLeftDownLine, RiRefreshLine} from "@remixicon/react"
import SendDialog from "./cashu/SendDialog"
import ReceiveDialog from "./cashu/ReceiveDialog"
import QRScannerModal from "./cashu/QRScannerModal"
import HistoryList from "./cashu/HistoryList"
import MintsList from "./cashu/MintsList"
import TransactionDetailsModal from "./cashu/TransactionDetailsModal"
import {formatUsd} from "./cashu/utils"
import {Link, useNavigate, useLocation} from "@/navigation"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import Header from "@/shared/components/header/Header"
import Icon from "@/shared/components/Icons/Icon"
import {usePublicKey} from "@/stores/user"
import TermsOfService from "@/shared/components/TermsOfService"
import {useSettingsStore} from "@/stores/settings"
import {
  useHistoryEnrichment,
  type EnrichedHistoryEntry,
} from "./hooks/useHistoryEnrichment"
import {useNPubCashClaim} from "./hooks/useNPubCashClaim"
import {useWalletRefresh} from "./hooks/useWalletRefresh"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.CASHU_WALLET)

const DEFAULT_MINT = "https://mint.coinos.io"

export default function CashuWallet() {
  const {
    expandHistory,
    activeTab,
    activeMint,
    toggleExpandHistory,
    setActiveTab,
    setActiveMint,
    setCachedMintInfo,
    getCachedMintInfo,
  } = useCashuWalletStore()
  const {activeProviderType} = useWalletProviderStore()
  const navigate = useNavigate()
  const location = useLocation()
  const isTopOfStack = useIsTopOfStack()
  const myPubKey = usePublicKey()
  const {legal, updateLegal} = useSettingsStore()

  const [manager, setManager] = useState<Manager | null>(null)
  const [balance, setBalance] = useState<{[mintUrl: string]: number} | null>(null)
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<EnrichedHistoryEntry[]>([])
  const [showSendDialog, setShowSendDialog] = useState(false)
  const [showReceiveDialog, setShowReceiveDialog] = useState(false)
  const [showQRScanner, setShowQRScanner] = useState(false)
  const [usdRate, setUsdRate] = useState<number | null>(null)
  const [sendDialogInitialToken, setSendDialogInitialToken] = useState<Token | undefined>(
    undefined
  )
  const [sendDialogInitialInvoice, setSendDialogInitialInvoice] = useState<string>("")
  const [receiveDialogInitialToken, setReceiveDialogInitialToken] = useState<string>("")
  const [receiveDialogInitialInvoice, setReceiveDialogInitialInvoice] =
    useState<string>("")
  const [showTransactionDetails, setShowTransactionDetails] = useState(false)
  const [selectedTransaction, setSelectedTransaction] =
    useState<EnrichedHistoryEntry | null>(null)
  const [qrError, setQrError] = useState<string>("")
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [showToS, setShowToS] = useState(false)
  const handledDeepLink = useRef(false)

  // Use extracted hooks
  const {enrichHistoryWithMetadata} = useHistoryEnrichment()
  const {refreshing, refreshData, handleRefresh} = useWalletRefresh(
    manager,
    myPubKey,
    enrichHistoryWithMetadata
  )

  // Auto-refresh balance and history after data changes
  const handleDataRefresh = useCallback(async () => {
    const data = await refreshData()
    if (data) {
      setBalance(data.balance)
      setHistory(data.history)
    }
  }, [refreshData])

  // Auto-claim npub.cash tokens
  useNPubCashClaim(myPubKey, manager, handleDataRefresh)

  const handleSendEntryClick = useCallback((entry: SendHistoryEntry) => {
    setSendDialogInitialToken(entry.token)
    setShowSendDialog(true)
  }, [])

  const handleMintEntryClick = useCallback((entry: HistoryEntry) => {
    if (entry.type === "mint" && entry.state === "UNPAID") {
      // Show receive dialog with the pending invoice
      setReceiveDialogInitialInvoice(entry.paymentRequest)
      setShowReceiveDialog(true)
    }
  }, [])

  const handleReceiveEntryClick = useCallback((entry: HistoryEntry) => {
    setSelectedTransaction(entry as EnrichedHistoryEntry)
    setShowTransactionDetails(true)
  }, [])

  const handleCloseSendDialog = () => {
    setShowSendDialog(false)
    setSendDialogInitialToken(undefined)
    setSendDialogInitialInvoice("")
  }

  const handleCloseReceiveDialog = () => {
    setShowReceiveDialog(false)
    setReceiveDialogInitialToken("")
    setReceiveDialogInitialInvoice("")
  }

  const handleManualRefresh = useCallback(async () => {
    const data = await handleRefresh(balance)
    if (data) {
      setBalance(data.balance)
      setHistory(data.history)
    }
  }, [handleRefresh, balance])

  const handleQRScanSuccess = async (result: string) => {
    setShowQRScanner(false)
    setQrError("")

    log("🔍 QR scanned:", result.substring(0, 50) + "...")

    // Strip cashu: URI prefix if present
    let cleanResult = result
    if (result.toLowerCase().startsWith("cashu:")) {
      cleanResult = result.slice(6)
      log("✂️ Stripped cashu: prefix, now:", cleanResult.substring(0, 50) + "...")
    }

    // Check if it's a Cashu token
    if (cleanResult.startsWith("cashu")) {
      setReceiveDialogInitialToken(cleanResult)
      setShowReceiveDialog(true)
      return
    }

    // Check if it's a Cashu payment request
    if (cleanResult.startsWith("creq")) {
      try {
        const {decodePaymentRequest} = await import("@cashu/cashu-ts")
        decodePaymentRequest(cleanResult) // Validate format

        // Handle payment request - open send dialog with request data
        setSendDialogInitialInvoice(cleanResult)
        setShowSendDialog(true)
        return
      } catch (err) {
        error("Failed to decode payment request:", err)
        setQrError("Invalid payment request")
        return
      }
    }

    // Check if it's a Lightning invoice
    if (result.toLowerCase().startsWith("lightning:")) {
      setSendDialogInitialInvoice(result.slice(10))
      setShowSendDialog(true)
      return
    }

    if (
      result.toLowerCase().startsWith("lnbc") ||
      result.toLowerCase().startsWith("lnurl")
    ) {
      setSendDialogInitialInvoice(result)
      setShowSendDialog(true)
      return
    }

    error("❌ Unrecognized QR format. First 100 chars:", result.substring(0, 100))
    setQrError("Unrecognized QR code format")
  }

  // Handle receiveToken from navigation state
  useEffect(() => {
    if (!manager || handledDeepLink.current) return

    const state = location.state as
      | {receiveToken?: string; lightningInvoice?: string}
      | undefined

    if (!state?.receiveToken && !state?.lightningInvoice) return

    handledDeepLink.current = true

    if (state.receiveToken) {
      setReceiveDialogInitialToken(state.receiveToken)
      setShowReceiveDialog(true)
    } else if (state.lightningInvoice) {
      setSendDialogInitialInvoice(state.lightningInvoice)
      setShowSendDialog(true)
    }
  }, [location.state, manager])

  // Handle paymentRequest from URL params
  useEffect(() => {
    if (!isTopOfStack) return

    const params = new URLSearchParams(location.search)
    const paymentRequest = params.get("paymentRequest")
    if (paymentRequest && manager) {
      setSendDialogInitialInvoice(paymentRequest)
      setShowSendDialog(true)
      // Clear the URL param
      window.history.replaceState({}, "", "/wallet")
    }
  }, [isTopOfStack, location.search, manager])

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  // Check if we need to show ToS before wallet access.
  useEffect(() => {
    if (!legal.tosAccepted) {
      setShowToS(true)
    }
  }, [legal.tosAccepted])

  const handleToSAccept = () => {
    updateLegal({tosAccepted: true, tosAcceptedVersion: 1})
    setShowToS(false)
  }

  // Redirect to settings if default Cashu wallet is not selected
  useEffect(() => {
    if (!isTopOfStack) return

    if (activeProviderType !== undefined && activeProviderType !== "cashu") {
      navigate("/settings/wallet")
    }
  }, [isTopOfStack, activeProviderType, navigate])

  useEffect(() => {
    const init = async () => {
      try {
        const mgr = getCashuManager() || (await initCashuManager())
        setManager(mgr)

        // Load balance
        const bal = await mgr.wallet.getBalances()
        setBalance(bal)

        // Load all mints and cache their info
        const mints = await mgr.mint.getAllMints()
        for (const {mintUrl} of mints) {
          // Skip if already cached
          if (getCachedMintInfo(mintUrl)) continue

          // Fetch and cache mint info
          try {
            const {CashuMint} = await import("@cashu/cashu-ts")
            const mint = new CashuMint(mintUrl)
            const info = await mint.getInfo()
            setCachedMintInfo(mintUrl, info)
          } catch (err) {
            warn(`Failed to fetch info for ${mintUrl}:`, err)
          }
        }

        // Set active mint if not already set
        if (!activeMint && bal && Object.keys(bal).length > 0) {
          setActiveMint(Object.keys(bal)[0])
        }

        // Load history
        const hist = await mgr.history.getPaginatedHistory(0, 1000)
        const enrichedHist = await enrichHistoryWithMetadata(hist)
        setHistory(enrichedHist)

        // Listen to events for real-time updates
        const updateData = async (eventName: string) => {
          log(`🎯 Event received: ${eventName}, updating wallet data...`)
          try {
            await handleDataRefresh()
            log(`✅ Updated from ${eventName}`)
          } catch (err) {
            error("Failed to refresh data:", err)
          }
        }

        const unsubscribers = [
          mgr.on("melt-quote:paid", () => updateData("melt-quote:paid")),
          mgr.on("send:created", () => updateData("send:created")),
          mgr.on("receive:created", () => updateData("receive:created")),
          mgr.on("mint-quote:created", () => updateData("mint-quote:created")),
          mgr.on("mint-quote:redeemed", () => updateData("mint-quote:redeemed")),
          mgr.on("proofs:saved", () => updateData("proofs:saved")),
        ]

        return () => {
          unsubscribers.forEach((unsub) => unsub())
        }
      } catch (err) {
        error("Failed to initialize Cashu manager:", err)
      } finally {
        setLoading(false)
      }
    }

    const cleanup = init()

    // Fetch USD rate from Coinbase
    const fetchUsdRate = async () => {
      try {
        const response = await fetch(
          "https://api.coinbase.com/v2/exchange-rates?currency=BTC"
        )
        const data = await response.json()
        setUsdRate(parseFloat(data.data.rates.USD))
      } catch (err) {
        error("Failed to fetch USD rate:", err)
      }
    }
    fetchUsdRate()

    // Refresh rate every 60 seconds
    const rateInterval = setInterval(fetchUsdRate, 60000)

    return () => {
      cleanup.then((cleanupFn) => cleanupFn?.())
      clearInterval(rateInterval)
    }
  }, [
    enrichHistoryWithMetadata,
    handleDataRefresh,
    activeMint,
    setActiveMint,
    setCachedMintInfo,
    getCachedMintInfo,
  ])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-base-content">Loading Cashu wallet...</div>
      </div>
    )
  }

  const totalBalance = balance
    ? Object.values(balance).reduce((sum, val) => sum + val, 0)
    : 0

  return (
    <>
      {showToS && <TermsOfService onAccept={handleToSAccept} />}
      <Header>
        <div className="flex items-center justify-between w-full min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate">Wallet</span>
            {isOffline && (
              <span className="badge badge-sm badge-error text-xs">Offline</span>
            )}
          </div>
          <div className="flex gap-2 md:gap-3 mr-6 md:mr-0">
            <button
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="btn btn-circle btn-ghost btn-sm flex-shrink-0 disabled:opacity-70"
              title="Refresh"
            >
              <RiRefreshLine className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <Link
              to="/settings/wallet"
              className="btn btn-circle btn-ghost btn-sm flex-shrink-0"
              title="Wallet Settings"
            >
              <Icon name="gear" className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </Header>
      <div className="flex justify-center h-screen overflow-y-auto">
        <div className="flex-1 overflow-y-auto" data-main-scroll-container="true">
          <div className="max-w-2xl mx-auto pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0 pt-[calc(4rem+env(safe-area-inset-top))] md:pt-0">
            {/* Balance Section */}
            <div className="pt-16 md:pt-8 pb-8 text-center">
              {/* Balance Display */}
              <div className="text-5xl font-bold mb-2">{totalBalance} bit</div>
              <div className="text-xl text-base-content/60">
                {formatUsd(totalBalance, usdRate)}
              </div>

              {/* Mint Info */}
              {activeMint && (
                <div className="text-sm text-base-content/60 mt-4">
                  Mint:{" "}
                  <button
                    onClick={() => setActiveTab("mints")}
                    className="font-medium hover:underline cursor-pointer"
                  >
                    {activeMint.replace(/^https?:\/\//, "")}
                  </button>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-center gap-6 px-4 py-8">
              <button
                onClick={() => setShowReceiveDialog(true)}
                className="btn btn-primary rounded-full px-6"
              >
                <RiArrowLeftDownLine className="w-5 h-5 mr-1" />
                RECEIVE
              </button>

              <button
                onClick={() => setShowQRScanner(true)}
                className="btn btn-ghost btn-circle btn-lg"
              >
                <svg
                  className="w-7 h-7"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  />
                </svg>
              </button>

              <button
                onClick={() => setShowSendDialog(true)}
                className="btn btn-primary rounded-full px-6"
              >
                SEND
                <RiArrowRightUpLine className="w-5 h-5 ml-1" />
              </button>
            </div>

            {/* History Section */}
            <div className="px-4">
              {/* Expand/Collapse Toggle */}
              <div className="flex justify-center py-4">
                <button onClick={toggleExpandHistory}>
                  <svg
                    className={`w-6 h-6 transition-transform ${expandHistory ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              </div>

              {/* Tabs and Content */}
              {expandHistory && (
                <>
                  <div className="flex border-b border-base-300">
                    <button
                      onClick={() => setActiveTab("history")}
                      className={`px-4 py-2 ${
                        activeTab === "history"
                          ? "border-b-2 font-bold"
                          : "text-base-content/60"
                      }`}
                    >
                      History
                    </button>
                    <button
                      onClick={() => setActiveTab("mints")}
                      className={`px-4 py-2 ${
                        activeTab === "mints"
                          ? "border-b-2 font-bold"
                          : "text-base-content/60"
                      }`}
                    >
                      Mints
                    </button>
                  </div>

                  {/* History Tab */}
                  {activeTab === "history" && (
                    <div className="py-4">
                      <HistoryList
                        history={history}
                        usdRate={usdRate}
                        onSendEntryClick={handleSendEntryClick}
                        onMintEntryClick={handleMintEntryClick}
                        onReceiveEntryClick={handleReceiveEntryClick}
                      />
                    </div>
                  )}

                  {/* Mints Tab */}
                  {activeTab === "mints" && (
                    <div className="py-4">
                      <MintsList
                        balance={balance}
                        manager={manager}
                        onBalanceUpdate={handleDataRefresh}
                        activeMint={activeMint}
                        onMintClick={setActiveMint}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <SendDialog
              isOpen={showSendDialog}
              onClose={handleCloseSendDialog}
              manager={manager}
              mintUrl={activeMint || DEFAULT_MINT}
              onSuccess={handleDataRefresh}
              initialToken={sendDialogInitialToken}
              initialInvoice={sendDialogInitialInvoice}
              balance={balance?.[activeMint || DEFAULT_MINT] || 0}
            />

            <ReceiveDialog
              isOpen={showReceiveDialog}
              onClose={handleCloseReceiveDialog}
              manager={manager}
              mintUrl={activeMint || DEFAULT_MINT}
              onSuccess={handleDataRefresh}
              initialToken={receiveDialogInitialToken}
              initialInvoice={receiveDialogInitialInvoice}
              balance={totalBalance}
              onScanRequest={() => setShowQRScanner(true)}
            />

            <QRScannerModal
              isOpen={showQRScanner}
              onClose={() => {
                setShowQRScanner(false)
                setQrError("")
              }}
              onScanSuccess={handleQRScanSuccess}
            />

            <TransactionDetailsModal
              isOpen={showTransactionDetails}
              onClose={() => {
                setShowTransactionDetails(false)
                setSelectedTransaction(null)
              }}
              entry={selectedTransaction}
              usdRate={usdRate}
            />

            {qrError && (
              <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 max-w-md">
                <div className="alert alert-error">
                  <span>{qrError}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => setQrError("")}>
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <RightColumn>
          {() => (
            <>
              <Widget title="Popular" className="h-96">
                <AlgorithmicFeed
                  type="popular"
                  displayOptions={{
                    small: true,
                    showDisplaySelector: false,
                  }}
                />
              </Widget>
            </>
          )}
        </RightColumn>
      </div>
    </>
  )
}
