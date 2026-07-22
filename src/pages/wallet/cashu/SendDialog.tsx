import {useState, useEffect} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import type {Token, PaymentRequest} from "@cashu/cashu-ts"
import Modal from "@/shared/components/ui/Modal"
import SendEcashMode from "./SendEcashMode"
import SendLightningMode from "./SendLightningMode"

interface SendDialogProps {
  isOpen: boolean
  onClose: () => void
  manager: Manager | null
  mintUrl: string
  onSuccess: () => void
  initialToken?: Token
  initialDisplayAmount?: number
  initialInvoice?: string
  balance?: number
}

export default function SendDialog({
  isOpen,
  onClose,
  manager,
  mintUrl,
  onSuccess,
  initialToken,
  initialDisplayAmount,
  initialInvoice,
  balance,
}: SendDialogProps) {
  const [sendMode, setSendMode] = useState<"select" | "ecash" | "lightning">("select")
  const [, setPaymentRequest] = useState<PaymentRequest | null>(null)

  // Handle initial token (from history)
  useEffect(() => {
    if (initialToken && isOpen) {
      setSendMode("ecash")
    }
  }, [initialToken, isOpen])

  // Handle initial invoice (from QR scan)
  useEffect(() => {
    const handleInitialInvoice = async () => {
      if (!initialInvoice || !isOpen) return

      // Check if it's a payment request
      if (initialInvoice.startsWith("creq")) {
        try {
          const {decodePaymentRequest} = await import("@cashu/cashu-ts")
          const decodedRequest = decodePaymentRequest(initialInvoice)
          setPaymentRequest(decodedRequest)
          setSendMode("ecash")
          return
        } catch (error) {
          console.error("Failed to decode payment request:", error)
        }
      }

      // Otherwise treat as lightning invoice
      setSendMode("lightning")
    }
    handleInitialInvoice()
  }, [initialInvoice, isOpen])

  const handleClose = () => {
    onClose()
    setSendMode("select")
  }

  if (!isOpen) return null

  return (
    <Modal onClose={handleClose}>
      <div className="p-4">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="font-bold text-lg">Send</h3>
            <div className="text-xs opacity-60 mt-1">
              {mintUrl.replace(/^https?:\/\//, "")}
            </div>
          </div>
          {balance !== undefined && (
            <div className="text-sm opacity-70">Balance: {balance} bit</div>
          )}
        </div>

        {sendMode === "select" && (
          <div className="space-y-4">
            <button
              className="btn btn-outline w-full justify-start"
              onClick={() => setSendMode("ecash")}
            >
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Ecash
            </button>

            <button
              className="btn btn-outline w-full justify-start"
              onClick={() => setSendMode("lightning")}
            >
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Lightning
            </button>
          </div>
        )}

        {sendMode === "ecash" && (
          <SendEcashMode
            manager={manager}
            mintUrl={mintUrl}
            onSuccess={onSuccess}
            onClose={handleClose}
            initialToken={initialToken}
            initialDisplayAmount={initialDisplayAmount}
            initialInvoice={initialInvoice}
            balance={balance}
          />
        )}

        {sendMode === "lightning" && (
          <SendLightningMode
            manager={manager}
            mintUrl={mintUrl}
            onSuccess={onSuccess}
            onClose={handleClose}
            initialInvoice={initialInvoice}
            balance={balance}
          />
        )}
      </div>
    </Modal>
  )
}
