import {useState, useEffect} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import {getEncodedToken} from "@cashu/cashu-ts"
import {savePaymentMetadata} from "@/stores/paymentMetadata"
import {UserRow} from "@/shared/components/user/UserRow"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.CASHU_WALLET)

interface SendEcashFormProps {
  manager: Manager | null
  mintUrl: string
  balance?: number
  selectedUserPubkey: string | null
  requestedMint: string | null
  onTokenCreated: (token: string, amount: number) => void
  initialAmount?: number
  initialNote?: string
}

export default function SendEcashForm({
  manager,
  mintUrl,
  balance,
  selectedUserPubkey,
  requestedMint,
  onTokenCreated,
  initialAmount = 0,
  initialNote = "",
}: SendEcashFormProps) {
  const [sendAmount, setSendAmount] = useState<number>(initialAmount)
  const [sendNote, setSendNote] = useState<string>(initialNote)
  const [sending, setSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>("")

  // Update state when initial values change (e.g., from payment request decode)
  useEffect(() => {
    if (initialAmount > 0) {
      setSendAmount(initialAmount)
    }
  }, [initialAmount])

  useEffect(() => {
    if (initialNote) {
      setSendNote(initialNote)
    }
  }, [initialNote])

  const sendEcash = async () => {
    if (!manager) return

    if (!sendAmount || sendAmount <= 0) {
      setErrorMessage("Please enter a valid amount")
      return
    }

    setSending(true)
    setErrorMessage("")
    try {
      const balances = await manager.wallet.getBalances()
      let useMint = mintUrl

      // If payment request specifies a mint, check if we have enough balance there
      if (requestedMint) {
        // Normalize mint URLs for comparison (handle trailing slashes, http/https)
        const normalizeMintUrl = (url: string) =>
          url
            .replace(/\/$/, "")
            .replace(/^https?:\/\//, "")
            .toLowerCase()
        const normalizedRequested = normalizeMintUrl(requestedMint)

        // Find matching mint in balances
        const matchingMint = Object.keys(balances).find(
          (mint) => normalizeMintUrl(mint) === normalizedRequested
        )

        const requestedBalance = matchingMint ? balances[matchingMint] : 0

        if (requestedBalance >= sendAmount && matchingMint) {
          useMint = matchingMint
          log("✓ Using requested mint with sufficient balance:", matchingMint)
        } else {
          warn("⚠️ Insufficient balance on requested mint, using mint selection:", {
            requested: requestedMint,
            matchingMint,
            requestedBalance,
            needed: sendAmount,
          })
          // Fall back to smart mint selection
          const {selectMintForPayment} = await import("@/lib/cashu/mintSelection")
          useMint = selectMintForPayment(balances, sendAmount)
        }
      } else {
        // No requested mint, use smart selection
        const {selectMintForPayment} = await import("@/lib/cashu/mintSelection")
        useMint = selectMintForPayment(balances, sendAmount)
      }

      const token = await manager.wallet.send(
        useMint,
        sendAmount,
        sendNote.trim() || undefined
      )
      const encoded = getEncodedToken(token)

      // Save note and recipient to paymentMetadata
      if (sendNote.trim() || selectedUserPubkey) {
        try {
          await savePaymentMetadata(
            encoded,
            "other",
            selectedUserPubkey || undefined,
            undefined,
            sendNote.trim() || undefined
          )
        } catch (err) {
          warn("Failed to save send note:", err)
        }
      }

      onTokenCreated(encoded, sendAmount)
    } catch (err) {
      error("Failed to create ecash token:", err)
      setErrorMessage(
        "Failed to create token: " +
          (err instanceof Error ? err.message : "Unknown error")
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="alert alert-error">
          <span>{errorMessage}</span>
        </div>
      )}
      {selectedUserPubkey && (
        <div className="alert alert-info">
          <div className="flex flex-col gap-2 w-full">
            <div className="text-sm font-semibold">Payment Request From:</div>
            <UserRow pubKey={selectedUserPubkey} />
            {requestedMint && (
              <div className="text-xs opacity-60 mt-1">
                Requested mint: {requestedMint.replace(/^https?:\/\//, "")}
              </div>
            )}
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          sendEcash()
        }}
      >
        <div className="form-control">
          <label className="label">
            <span className="label-text">Amount (bits)</span>
          </label>
          <input
            type="number"
            className={`input input-bordered ${
              sendAmount > 0 && balance !== undefined && sendAmount > balance
                ? "input-error"
                : ""
            }`}
            placeholder="Amount in bits"
            value={sendAmount || ""}
            onChange={(e) => setSendAmount(Number(e.target.value))}
            max={balance}
          />
          {sendAmount > 0 && balance !== undefined && sendAmount > balance && (
            <label className="label">
              <span className="label-text-alt text-error">
                Exceeds balance ({balance} bit)
              </span>
            </label>
          )}
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text">Note (optional)</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            placeholder="What's this for?"
            value={sendNote}
            onChange={(e) => setSendNote(e.target.value)}
            maxLength={200}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={
            !sendAmount || sending || (balance !== undefined && sendAmount > balance)
          }
        >
          {sending ? "Creating..." : "Create Token"}
        </button>
      </form>
    </div>
  )
}
