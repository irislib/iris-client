import {useState, ChangeEvent, useRef, useEffect} from "react"
import {AppEvent} from "@/lib/nostr"
import {RiCheckLine, RiCloseLine, RiPlayFill} from "@remixicon/react"
import Modal from "@/shared/components/ui/Modal"
import {usePublicKey, useUserStore} from "@/stores/user"
import {useWalletProviderStore} from "@/stores/walletProvider"
import {createAndPublishZapInvoice} from "@/utils/zapUtils"
import {savePaymentMetadata} from "@/stores/paymentMetadata"
import {nostr} from "@/utils/nostrClient"
import {KIND_ZAP_RECEIPT} from "@/utils/constants"
import {getCachedName} from "@/utils/nostr"
import FeedItem from "../event/FeedItem/FeedItem"
import Icon from "../Icons/Icon"

interface ZapAllModalProps {
  events: AppEvent[]
  onClose: () => void
}

interface ZapProgress {
  total: number
  current: number
  currentEvent: AppEvent | null
  totalZapped: number
  completed: boolean
  error?: string
}

interface LogEntry {
  timestamp: Date
  type: "success" | "error" | "skip"
  message: string
  eventId: string
  authorName?: string
}

function ZapAllModal({events, onClose}: ZapAllModalProps) {
  const myPubKey = usePublicKey()
  const {defaultZapAmount, defaultZapComment} = useUserStore()
  const {activeProviderType, sendPayment: walletProviderSendPayment} =
    useWalletProviderStore()

  const [zapAmount, setZapAmount] = useState<string>(
    defaultZapAmount > 0 ? defaultZapAmount.toString() : "21"
  )
  const [maxBudget, setMaxBudget] = useState<string>("1000")
  const [zapComment, setZapComment] = useState<string>(defaultZapComment || "")
  const [skipAlreadyZapped, setSkipAlreadyZapped] = useState<boolean>(true)
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isStopped, setIsStopped] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState<ZapProgress>({
    total: events.length,
    current: 0,
    currentEvent: null,
    totalZapped: 0,
    completed: false,
  })
  const logEndRef = useRef<HTMLDivElement>(null)

  const hasWallet = activeProviderType !== "disabled" && activeProviderType !== undefined

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({behavior: "smooth"})
    }
  }, [logs])

  const addLog = (
    type: "success" | "error" | "skip",
    message: string,
    eventId: string,
    authorName?: string
  ) => {
    setLogs((prev) => [
      ...prev,
      {
        timestamp: new Date(),
        type,
        message,
        eventId,
        authorName,
      },
    ])
  }

  const handleZapAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    setZapAmount(e.target.value)
  }

  const handleMaxBudgetChange = (e: ChangeEvent<HTMLInputElement>) => {
    setMaxBudget(e.target.value)
  }

  const handleZapCommentChange = (e: ChangeEvent<HTMLInputElement>) => {
    setZapComment(e.target.value)
  }

  // Check if the current user has already zapped an event
  const hasAlreadyZapped = async (event: AppEvent): Promise<boolean> => {
    if (!myPubKey) return false

    return new Promise((resolve) => {
      const filter = {
        kinds: [KIND_ZAP_RECEIPT],
        ["#e"]: [event.id],
      }

      try {
        const sub = nostr().subscribe(filter)
        let found = false

        sub?.on("event", (zapEvent: AppEvent) => {
          // Check if this zap is from me
          const description = zapEvent.tags?.find((t) => t[0] === "description")?.[1]
          if (description) {
            try {
              const zapRequest = JSON.parse(description)
              if (zapRequest.pubkey === myPubKey) {
                found = true
                sub.stop()
                resolve(true)
              }
            } catch (e) {
              // Invalid JSON, skip
            }
          }
        })

        sub?.on("eose", () => {
          sub.stop()
          resolve(found)
        })

        // Timeout after 2 seconds
        setTimeout(() => {
          sub.stop()
          resolve(found)
        }, 2000)
      } catch (error) {
        console.warn("Error checking zap status:", error)
        resolve(false)
      }
    })
  }

  const startZapCampaign = async () => {
    const ndkInstance = nostr()
    const signer = ndkInstance.signer

    if (!signer) {
      setProgress((prev) => ({...prev, error: "No signer available"}))
      return
    }

    if (!hasWallet) {
      setProgress((prev) => ({...prev, error: "No wallet connected"}))
      return
    }

    const amountPerZap = Number(zapAmount)
    const budget = Number(maxBudget)

    if (amountPerZap < 1) {
      setProgress((prev) => ({...prev, error: "Zap amount must be at least 1"}))
      return
    }

    if (budget < amountPerZap) {
      setProgress((prev) => ({...prev, error: "Budget must be at least one zap amount"}))
      return
    }

    setIsRunning(true)
    setProgress({
      total: events.length,
      current: 0,
      currentEvent: null,
      totalZapped: 0,
      completed: false,
    })

    let totalSpent = 0

    for (let i = 0; i < events.length; i++) {
      // Check if stopped
      if (isStopped) {
        setProgress((prev) => ({
          ...prev,
          completed: true,
          error: `Campaign stopped by user after ${i} zaps`,
        }))
        break
      }

      // Wait while paused
      while (isPaused && !isStopped) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const event = events[i]

      // Check if budget exceeded
      if (totalSpent + amountPerZap > budget) {
        setProgress((prev) => ({
          ...prev,
          completed: true,
          error: `Budget exhausted after ${i} zaps (${totalSpent} bits)`,
        }))
        break
      }

      // Get author info for logging
      const authorName = getCachedName(event.pubkey)

      // Skip if already zapped and user wants to skip
      if (skipAlreadyZapped) {
        const alreadyZapped = await hasAlreadyZapped(event)
        if (alreadyZapped) {
          addLog("skip", "Already zapped", event.id, authorName)
          continue
        }
      }

      // Update progress to show current event
      setProgress((prev) => ({
        ...prev,
        current: i + 1,
        currentEvent: event,
      }))

      try {
        // Get author profile to get lightning address
        const author = nostr().getUser({pubkey: event.pubkey})
        await author.fetchProfile()

        const lud16 = author.profile?.lud16
        if (!lud16) {
          addLog("error", "No lightning address", event.id, authorName)
          continue
        }

        // Create and publish zap invoice
        const amountMsats = amountPerZap * 1000
        const invoice = await createAndPublishZapInvoice(
          event,
          amountMsats,
          zapComment,
          lud16,
          signer
        )

        // Save payment metadata
        await savePaymentMetadata(invoice, "zap", event.pubkey, event.id)

        // Attempt payment
        await walletProviderSendPayment(invoice)

        // Update spent amount
        totalSpent += amountPerZap

        // Update progress
        setProgress((prev) => ({
          ...prev,
          totalZapped: totalSpent,
        }))

        // Log success
        addLog("success", `Zapped ${amountPerZap} bits`, event.id, authorName)

        // Small delay between zaps to avoid overwhelming the wallet
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error"
        addLog("error", errorMsg, event.id, authorName)
        // Continue with next event
      }
    }

    // Mark as completed
    setProgress((prev) => ({
      ...prev,
      completed: true,
      currentEvent: null,
    }))
    setIsRunning(false)
  }

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Icon name="zap" size={20} />
            Zap All Posts ({events.length})
          </h2>
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost">
            <RiCloseLine className="w-5 h-5" />
          </button>
        </div>

        {!isRunning ? (
          <>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Amount per post (bits)</label>
              <input
                type="number"
                min="1"
                value={zapAmount}
                onChange={handleZapAmountChange}
                className="input input-bordered w-full"
                placeholder="21"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Max budget (bits)</label>
              <input
                type="number"
                min="1"
                value={maxBudget}
                onChange={handleMaxBudgetChange}
                className="input input-bordered w-full"
                placeholder="1000"
              />
              <span className="text-xs text-base-content/50">
                Max {Math.floor(Number(maxBudget) / Number(zapAmount))} posts with budget
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Comment (optional)</label>
              <input
                type="text"
                value={zapComment}
                onChange={handleZapCommentChange}
                className="input input-bordered w-full"
                placeholder="Great posts!"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipAlreadyZapped}
                onChange={(e) => setSkipAlreadyZapped(e.target.checked)}
                className="checkbox checkbox-sm"
              />
              <span className="text-sm text-base-content/70">Skip already zapped</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button
                onClick={startZapCampaign}
                className="btn btn-primary flex-1"
                disabled={!hasWallet || !nostr().signer}
              >
                <RiPlayFill className="w-5 h-5" />
                Start
              </button>
              <button onClick={onClose} className="btn btn-ghost">
                Cancel
              </button>
            </div>

            {(!hasWallet || !nostr().signer) && (
              <div className="text-sm text-error">
                {!nostr().signer ? "No signer available" : "No wallet connected"}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="stats shadow">
              <div className="stat">
                <div className="stat-title">Progress</div>
                <div className="stat-value text-2xl">
                  {progress.current} / {progress.total}
                </div>
                <div className="stat-desc">{progress.totalZapped} bits zapped</div>
              </div>
            </div>

            {progress.currentEvent && (
              <div className="border border-primary rounded-lg overflow-hidden transition-all duration-300 animate-pulse">
                <div className="bg-primary/10 px-3 py-2 text-sm font-medium">
                  Currently zapping...
                </div>
                <div className="max-h-[300px] overflow-hidden">
                  <FeedItem
                    event={progress.currentEvent}
                    asEmbed={true}
                    showActions={false}
                    truncate={200}
                  />
                </div>
              </div>
            )}

            {progress.completed && (
              <div className="flex items-center gap-2 p-4 bg-success/10 rounded-lg">
                <RiCheckLine className="w-5 h-5 text-success" />
                <div>
                  <div className="font-medium">Campaign completed!</div>
                  <div className="text-sm text-base-content/70">
                    Zapped {progress.current} posts with {progress.totalZapped} bits
                  </div>
                  {progress.error && (
                    <div className="text-sm text-warning mt-1">{progress.error}</div>
                  )}
                </div>
              </div>
            )}

            {progress.error && !progress.completed && (
              <div className="text-sm text-error">{progress.error}</div>
            )}

            <div className="flex gap-2">
              {!progress.completed && (
                <>
                  <button
                    onClick={() => setIsPaused(!isPaused)}
                    className="btn btn-warning flex-1"
                  >
                    {isPaused ? "Continue" : "Pause"}
                  </button>
                  <button
                    onClick={() => setIsStopped(true)}
                    className="btn btn-error flex-1"
                  >
                    Stop
                  </button>
                </>
              )}
              {progress.completed && (
                <button onClick={onClose} className="btn btn-ghost flex-1">
                  Close
                </button>
              )}
            </div>

            {logs.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2">Log</div>
                <div className="max-h-48 overflow-y-auto border border-base-300 rounded-lg p-2 bg-base-100">
                  {logs.map((log, index) => {
                    let logTypeClass = "bg-warning/10 text-warning"
                    if (log.type === "success") {
                      logTypeClass = "bg-success/10 text-success"
                    } else if (log.type === "error") {
                      logTypeClass = "bg-error/10 text-error"
                    }

                    return (
                      <div
                        key={index}
                        className={`text-xs py-1 px-2 mb-1 rounded ${logTypeClass}`}
                      >
                        <span className="opacity-70">
                          {log.timestamp.toLocaleTimeString()}
                        </span>
                        {" - "}
                        {log.authorName && (
                          <>
                            <span className="font-medium">{log.authorName}</span>
                            {": "}
                          </>
                        )}
                        {log.message}
                      </div>
                    )
                  })}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default ZapAllModal
