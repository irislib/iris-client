import {useState, useEffect} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import {decode} from "light-bolt11-decoder"
import {savePaymentMetadata} from "@/stores/paymentMetadata"
import {getLNURLInvoice} from "@/utils/zapUtils"
import {LightningUserSearch} from "./LightningUserSearch"

interface SendLightningModeProps {
  manager: Manager | null
  mintUrl: string
  onSuccess: () => void
  onClose: () => void
  initialInvoice?: string
  balance?: number
}

export default function SendLightningMode({
  manager,
  mintUrl,
  onSuccess,
  onClose,
  initialInvoice,
  balance,
}: SendLightningModeProps) {
  const [sendAmount, setSendAmount] = useState<number>(0)
  const [sendInvoice, setSendInvoice] = useState<string>("")
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null)
  const [invoiceDescription, setInvoiceDescription] = useState<string>("")
  const [sending, setSending] = useState(false)
  const [isLightningAddress, setIsLightningAddress] = useState(false)
  const [lnurlComment, setLnurlComment] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [selectedUserPubkey, setSelectedUserPubkey] = useState<string | null>(null)

  // Handle initial invoice (from QR scan)
  useEffect(() => {
    if (initialInvoice) {
      setSendInvoice(initialInvoice)
    }
  }, [initialInvoice])

  // Detect lightning address and decode invoice amount and description
  useEffect(() => {
    if (!sendInvoice.trim()) {
      setInvoiceAmount(null)
      setInvoiceDescription("")
      setIsLightningAddress(false)
      return
    }

    const trimmed = sendInvoice.trim()

    // Check if it's a lightning address or LNURL
    if (
      (trimmed.includes("@") && !trimmed.toLowerCase().startsWith("lnbc")) ||
      trimmed.toLowerCase().startsWith("lnurl")
    ) {
      setIsLightningAddress(true)
      setInvoiceAmount(null)
      setInvoiceDescription("")
      return
    }

    setIsLightningAddress(false)

    try {
      const decodedInvoice = decode(trimmed)
      const amountSection = decodedInvoice.sections.find(
        (section: {name: string}) => section.name === "amount"
      )
      if (amountSection && "value" in amountSection) {
        // Convert millisatoshis to bits
        const bits = Math.floor(parseInt(amountSection.value) / 1000)
        setInvoiceAmount(bits)
      } else {
        setInvoiceAmount(null)
      }

      // Extract description
      const descSection = decodedInvoice.sections.find(
        (section: {name: string}) => section.name === "description"
      )
      if (descSection && "value" in descSection) {
        setInvoiceDescription(descSection.value as string)
      } else {
        setInvoiceDescription("")
      }
    } catch (error) {
      console.warn("Failed to decode invoice:", error)
      setInvoiceAmount(null)
    }
  }, [sendInvoice])

  const handleSelectLightningUser = (pubkey: string, lud16: string) => {
    setSendInvoice(lud16)
    setSelectedUserPubkey(pubkey)
  }

  const sendLightning = async () => {
    if (!manager || !sendInvoice.trim()) return

    if (isLightningAddress && (!sendAmount || sendAmount <= 0)) {
      setError("Please enter a valid amount")
      return
    }

    // Validate balance for lightning address payments
    if (isLightningAddress && balance !== undefined && sendAmount > balance) {
      setError(`Insufficient balance. You have ${balance} bit`)
      return
    }

    // Validate balance for invoice payments
    if (
      !isLightningAddress &&
      invoiceAmount &&
      balance !== undefined &&
      invoiceAmount > balance
    ) {
      setError(`Insufficient balance. You have ${balance} bit`)
      return
    }

    setSending(true)
    setError("")
    try {
      let invoice = sendInvoice.trim()

      // If it's a lightning address, fetch invoice with comment
      if (isLightningAddress) {
        const originalDestination = invoice
        invoice = await getLNURLInvoice(invoice, sendAmount, lnurlComment || undefined)

        // Save metadata with custom comment and destination for LNURL payments
        try {
          await savePaymentMetadata(
            invoice,
            "other",
            selectedUserPubkey || undefined,
            undefined,
            lnurlComment || undefined,
            originalDestination
          )
        } catch (err) {
          console.warn("Failed to save payment metadata:", err)
        }
      } else {
        // Save payment metadata (description auto-extracted from invoice)
        try {
          await savePaymentMetadata(invoice, "other", selectedUserPubkey || undefined)
        } catch (err) {
          console.warn("Failed to save payment metadata:", err)
        }
      }

      // Create melt quote
      const quote = await manager.quotes.createMeltQuote(mintUrl, invoice)

      // Pay the quote
      const result = await manager.quotes.payMeltQuote(mintUrl, quote.quote)
      if (result.state !== "PAID") {
        throw new Error(
          result.state === "PENDING"
            ? "Payment is pending at the mint; check your wallet history before retrying"
            : "The mint did not pay the invoice"
        )
      }

      setSendInvoice("")
      setLnurlComment("")
      onSuccess()
      onClose()
    } catch (error) {
      console.error("Failed to pay lightning invoice:", error)
      setError(
        "Failed to pay invoice: " +
          (error instanceof Error ? error.message : "Unknown error")
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        sendLightning()
      }}
      className="space-y-4"
    >
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {balance !== undefined &&
        ((isLightningAddress && sendAmount > 0 && sendAmount > balance) ||
          (!isLightningAddress && invoiceAmount !== null && invoiceAmount > balance)) && (
          <div className="alert alert-error">
            <span>Amount exceeds balance ({balance} bit available)</span>
          </div>
        )}
      <div className="form-control">
        <label className="label">
          <span className="label-text">Search users</span>
        </label>
        <LightningUserSearch
          placeholder="Search users with lightning..."
          onUserSelect={handleSelectLightningUser}
          maxResults={5}
        />
      </div>
      <div className="divider">OR</div>
      <div className="form-control">
        <label className="label">
          <span className="label-text">
            {isLightningAddress ? "Lightning Address / LNURL" : "Lightning Invoice"}
          </span>
        </label>
        <textarea
          className="textarea textarea-bordered h-24"
          placeholder="lnbc..., user@domain.com, or lnurl..."
          value={sendInvoice}
          onChange={(e) => setSendInvoice(e.target.value)}
        />
      </div>

      {isLightningAddress && (
        <>
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
              <span className="label-text">Comment (optional)</span>
            </label>
            <input
              type="text"
              className="input input-bordered"
              placeholder="What's this payment for?"
              value={lnurlComment}
              onChange={(e) => setLnurlComment(e.target.value)}
              maxLength={500}
            />
          </div>
        </>
      )}

      {!isLightningAddress && invoiceAmount !== null && (
        <div
          className={`alert ${
            balance !== undefined && invoiceAmount > balance
              ? "alert-error"
              : "alert-info"
          }`}
        >
          <div className="flex flex-col gap-2">
            <div>
              <span className="font-bold">Amount</span>
              <div className="text-lg">{invoiceAmount.toLocaleString()} bits</div>
              {balance !== undefined && invoiceAmount > balance && (
                <div className="text-sm text-error">Exceeds balance ({balance} bit)</div>
              )}
            </div>
            {invoiceDescription && (
              <div>
                <span className="font-bold">Description</span>
                <div className="text-sm text-base-content/70 break-words">
                  {invoiceDescription}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={
          !sendInvoice.trim() ||
          sending ||
          (invoiceAmount !== null && balance !== undefined && invoiceAmount > balance)
        }
      >
        {sending ? "Paying..." : "Pay"}
      </button>
    </form>
  )
}
