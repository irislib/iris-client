import {withRecoveryMount} from "@/navigation/recoveryMount"
import {useState, useEffect} from "react"
import {RiQrCodeLine} from "@remixicon/react"
import Embed, {type EmbedComponentProps} from "./index.ts"

function CashuPaymentRequestComponent({match, key}: EmbedComponentProps) {
  const [amount, setAmount] = useState<number | null>(null)
  const [description, setDescription] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [copied, setCopied] = useState(false)

  // Decode on mount
  useEffect(() => {
    const decodeRequest = async () => {
      setLoading(true)
      try {
        const trimmedRequest = match.trim()

        const {decodePaymentRequest} = await import("@cashu/cashu-ts")
        const decoded = decodePaymentRequest(trimmedRequest)

        setAmount(decoded.amount || null)
        setDescription(decoded.description || "")
      } catch (err) {
        console.error("❌ Failed to decode payment request:", err)
        setError(err instanceof Error ? err.message : "Invalid payment request")
      } finally {
        setLoading(false)
      }
    }

    decodeRequest()
  }, [match])

  const handlePay = async () => {
    // Navigate to send with this payment request
    const url = `/wallet?paymentRequest=${encodeURIComponent(match.trim())}`
    window.location.href = withRecoveryMount(url)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(match)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      key={key}
      className="cashu-payment-request-embed flex flex-col gap-3 p-4 bg-base-200 rounded-lg border border-base-300 my-2"
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <RiQrCodeLine className="w-10 h-10 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-base">Cashu Payment Request</div>
          <div className="text-sm text-base-content/70">
            {loading && "Decoding request..."}
            {error && <span className="text-error">{error}</span>}
            {!error && !loading && (
              <>
                {amount !== null && (
                  <div className="font-medium text-primary">{amount} bits</div>
                )}
                {description && (
                  <div className="text-xs text-base-content/60 mt-1">{description}</div>
                )}
                {amount === null && !description && (
                  <span className="text-base-content/60">No amount specified</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleCopy} className="btn btn-ghost btn-sm flex-1">
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={handlePay}
          className="btn btn-primary btn-sm flex-1"
          disabled={loading || !!error}
        >
          Pay
        </button>
      </div>
    </div>
  )
}

const CashuPaymentRequest: Embed = {
  regex: /(creq[A-Za-z0-9_-]+)/gi,
  component: CashuPaymentRequestComponent,
  settingsKey: "cashu",
}

export default CashuPaymentRequest
