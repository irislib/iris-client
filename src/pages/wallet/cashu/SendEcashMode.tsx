import {useState, useEffect} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import {getEncodedToken, decodePaymentRequest, type Token} from "@cashu/cashu-ts"
import SendEcashForm from "./SendEcashForm"
import SendEcashShare from "./SendEcashShare"

interface SendEcashModeProps {
  manager: Manager | null
  mintUrl: string
  onSuccess: () => void
  onClose: () => void
  initialToken?: Token
  initialInvoice?: string
  balance?: number
}

export default function SendEcashMode({
  manager,
  mintUrl,
  onSuccess,
  onClose,
  initialToken,
  initialInvoice,
  balance,
}: SendEcashModeProps) {
  const [generatedToken, setGeneratedToken] = useState<string>("")
  const [selectedUserPubkey, setSelectedUserPubkey] = useState<string | null>(null)
  const [initialAmount, setInitialAmount] = useState<number>(0)
  const [initialNote, setInitialNote] = useState<string>("")
  const [requestedMint, setRequestedMint] = useState<string | null>(null)

  // Handle initial invoice (payment request - creq)
  useEffect(() => {
    const handlePaymentRequest = async () => {
      if (!initialInvoice || !initialInvoice.startsWith("creq")) return

      try {
        const decodedRequest = decodePaymentRequest(initialInvoice)

        // Pre-populate amount
        if (decodedRequest.amount) {
          setInitialAmount(decodedRequest.amount)
        }

        // Pre-populate note/description
        if (decodedRequest.description) {
          setInitialNote(decodedRequest.description)
        }

        // Check if it's a NIP-117 (double ratchet DM) transport
        const hasNip117Transport = decodedRequest.transport?.some(
          (t) =>
            t.type === "nostr" &&
            t.tags?.some((tag: string[]) => tag[0] === "n" && tag[1] === "117")
        )

        // Auto-select recipient for DM if NIP-117
        if (hasNip117Transport && decodedRequest.transport?.[0]?.target) {
          setSelectedUserPubkey(decodedRequest.transport[0].target)
        }

        // Extract requested mint (first in mints array)
        if (decodedRequest.mints && decodedRequest.mints.length > 0) {
          setRequestedMint(decodedRequest.mints[0])
        }
      } catch (error) {
        console.error("Failed to decode payment request:", error)
      }
    }

    handlePaymentRequest()
  }, [initialInvoice])

  // Handle initial token (from history) - encode and display
  useEffect(() => {
    const loadInitialToken = async () => {
      if (!initialToken) return
      try {
        const encoded = getEncodedToken(initialToken)
        setGeneratedToken(encoded)

        // Load existing metadata for DM message suggestion (not implemented yet)
        const {getPaymentMetadata} = await import("@/stores/paymentMetadata")
        const metadata = await getPaymentMetadata(encoded)
        if (metadata?.message) {
          console.log("Token has metadata message:", metadata.message)
        }
      } catch (error) {
        console.error("Failed to encode initial token:", error)
      }
    }
    loadInitialToken()
  }, [initialToken])

  const handleTokenCreated = async (token: string) => {
    setGeneratedToken(token)
    onSuccess()

    // If payment request with NIP-117 recipient, auto-send via DM
    if (selectedUserPubkey) {
      console.log(
        "🚀 Auto-sending token to payment request recipient:",
        selectedUserPubkey
      )
      // SendEcashShare will handle the auto-send on mount
    }
  }

  if (generatedToken) {
    return (
      <SendEcashShare
        manager={manager}
        generatedToken={generatedToken}
        initialToken={initialToken}
        selectedUserPubkey={selectedUserPubkey}
        onClose={onClose}
      />
    )
  }

  return (
    <SendEcashForm
      manager={manager}
      mintUrl={mintUrl}
      balance={balance}
      selectedUserPubkey={selectedUserPubkey}
      requestedMint={requestedMint}
      onTokenCreated={handleTokenCreated}
      initialAmount={initialAmount}
      initialNote={initialNote}
    />
  )
}
