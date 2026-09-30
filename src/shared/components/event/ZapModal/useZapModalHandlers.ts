import {ChangeEvent, Dispatch, SetStateAction} from "react"
import {LnPayCb, AppEvent, zapInvoiceFromEvent, UserProfile} from "@/lib/nostr"
import {savePaymentMetadata} from "@/stores/paymentMetadata"
import {nostr} from "@/utils/nostrClient"
import {getZapAmount} from "@/utils/nostr"
import {KIND_ZAP_RECEIPT, DEBUG_NAMESPACES} from "@/utils/constants"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface UseZapModalHandlersParams {
  // State setters
  setZapAmount: (amount: string) => void
  setCustomAmount: (amount: string) => void
  setZapMessage: (message: string) => void
  setShouldSetDefault: (should: boolean) => void
  setShouldSetDefaultComment: (should: boolean) => void
  setCopiedPaymentRequest: (copied: boolean) => void
  setNoAddress: (noAddress: boolean) => void
  setErrorMessage: (message: string) => void
  setIsProcessing: (processing: boolean) => void
  setBolt11Invoice: (invoice: string) => void
  setShowQRCode: (show: boolean) => void
  setZapped: Dispatch<SetStateAction<boolean>>
  setZapRefresh: (refresh: boolean) => void
  setDefaultZapAmount: (amount: number) => void
  setDefaultZapComment: (comment: string) => void

  // State values
  zapAmount: string
  customAmount: string
  zapMessage: string
  shouldSetDefault: boolean
  shouldSetDefaultComment: boolean
  hasWallet: boolean
  activeProviderType: string | undefined
  walletProviderSendPayment: (pr: string) => Promise<{preimage?: string} | void>
  zapDonationEnabled: boolean
  zapDonationRecipients: Array<{recipient: string; percentage: number}>
  zapDonationMinAmount: number
  bolt11Invoice: string
  zapRefresh: boolean

  // Props
  event: AppEvent
  profile: UserProfile | null
  onClose: () => void
}

export function useZapModalHandlers(params: UseZapModalHandlersParams) {
  const handleZapAmountChange = (amount: string) => {
    params.setZapAmount(amount)
    params.setCustomAmount("")
  }

  const handleConfirmCustomAmount = () => {
    params.setZapAmount(params.customAmount)
  }

  const handleCustomAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    params.setCustomAmount(event.target.value)
  }

  const handleZapMessageChange = (event: ChangeEvent<HTMLInputElement>) => {
    params.setZapMessage(event.target.value)
  }

  const handleSetDefaultAmount = (e: ChangeEvent<HTMLInputElement>) => {
    params.setShouldSetDefault(e.target.checked)
  }

  const handleSetDefaultComment = (e: ChangeEvent<HTMLInputElement>) => {
    params.setShouldSetDefaultComment(e.target.checked)
  }

  const handleCopyPaymentRequest = () => {
    navigator.clipboard.writeText(params.bolt11Invoice)
    params.setCopiedPaymentRequest(true)
    setTimeout(() => {
      params.setCopiedPaymentRequest(false)
    }, 3000)
  }

  const handleZap = async () => {
    params.setNoAddress(false)
    params.setErrorMessage("")
    params.setIsProcessing(true)
    try {
      if (Number(params.zapAmount) < 1) {
        params.setErrorMessage("Zap amount must be greater than 0")
        params.setIsProcessing(false)
        return
      }
    } catch (err) {
      params.setErrorMessage("Zap amount must be a valid number")
      warn("Zap amount must be a number: ", err)
      params.setIsProcessing(false)
      return
    }
    const amount = Number(params.zapAmount) * 1000

    try {
      if (params.shouldSetDefault) {
        params.setDefaultZapAmount(Number(params.zapAmount))
      }
      if (params.shouldSetDefaultComment && params.zapMessage.trim()) {
        params.setDefaultZapComment(params.zapMessage.trim())
      }

      const lnPay: LnPayCb = async ({pr}) => {
        log("🎯 lnPay callback called, invoice:", pr.slice(0, 30) + "...")
        log(
          "💳 hasWallet:",
          params.hasWallet,
          "activeProviderType:",
          params.activeProviderType
        )

        // Always set the invoice for QR code display
        params.setBolt11Invoice(pr)
        params.setShowQRCode(true)

        if (params.hasWallet) {
          // Save zap metadata
          log("💾 Saving zap metadata for invoice:", pr.slice(0, 30) + "...")
          try {
            await savePaymentMetadata(pr, "zap", params.event.pubkey, params.event.id)
            log("✅ Zap metadata saved successfully")
          } catch (err) {
            error("❌ Failed to save zap metadata:", err)
          }

          // Optimistic update: immediately close modal and show zapped state
          params.setZapped(true)
          params.setZapRefresh(!params.zapRefresh)
          params.onClose()

          // Attempt wallet payment in background
          setTimeout(() => {
            log("💸 Starting wallet payment...")
            params
              .walletProviderSendPayment(pr)
              .then(async () => {
                log("✅ Payment succeeded")

                // Send donation zaps if enabled
                if (
                  params.zapDonationEnabled &&
                  params.zapDonationRecipients.length > 0
                ) {
                  log("💝 Sending donation zaps...")
                  try {
                    const {calculateMultiRecipientDonations, sendDonationZaps} =
                      await import("@/utils/nostr")
                    const donations = calculateMultiRecipientDonations(
                      Number(params.zapAmount),
                      params.zapDonationRecipients,
                      params.zapDonationMinAmount
                    )

                    const ndkInstance = nostr()
                    const signer = ndkInstance.signer
                    if (signer) {
                      await sendDonationZaps(
                        donations,
                        signer,
                        params.event,
                        params.walletProviderSendPayment
                      )
                      log("✅ Donation zaps sent")
                    }
                  } catch (donationError) {
                    warn("Donation zaps failed (non-fatal):", donationError)
                  }
                }
              })
              .catch(async (caughtError: Error) => {
                warn("Wallet payment failed:", caughtError)
                // Revert optimistic update
                params.setZapped(false)
                params.setZapRefresh(!params.zapRefresh)
                // Show error toast with link to event
                const {useToastStore} = await import("@/stores/toast")
                const {nip19} = await import("nostr-tools")
                const errorMsg =
                  caughtError instanceof Error ? caughtError.message : "Payment failed"
                const noteId = nip19.noteEncode(params.event.id)
                const recipientName =
                  params.profile?.name ||
                  params.profile?.displayName ||
                  params.event.pubkey.slice(0, 8)
                const message = `Zap to ${recipientName} (${Number(params.zapAmount)} bits) failed. ${errorMsg}`
                useToastStore.getState().addToast(message, "error", 10000, `/${noteId}`)
              })
          }, 100)
        }

        // Always return undefined to let NostrClient know we're handling payment via QR
        return undefined
      }

      // Check if we have a lightning address from the passed profile
      if (!params.profile?.lud16 && !params.profile?.lud06) {
        params.setNoAddress(true)
        params.setIsProcessing(false)
        return
      }

      // Create zap invoice manually
      const {createZapInvoice} = await import("@/utils/nostr")
      const ndkInstance = nostr()
      const signer = ndkInstance.signer
      if (!signer) {
        throw new Error("No signer available")
      }

      const invoice = await createZapInvoice(
        params.event,
        amount,
        params.zapMessage || "",
        params.profile.lud16!, // We already checked it exists above
        signer
      )

      // Call the lnPay callback with the invoice
      await lnPay({
        pr: invoice,
        target: params.event,
        recipientPubkey: params.event.pubkey,
        amount,
        unit: "msat",
      })
    } catch (err) {
      warn("Zap failed: ", err)
      if (err instanceof Error) {
        if (err.message.includes("No zap endpoint found")) {
          params.setNoAddress(true)
        } else {
          params.setErrorMessage(
            err.message || "Failed to process zap. Please try again."
          )
        }
      }
    } finally {
      params.setIsProcessing(false)
    }
  }

  const fetchZapReceipt = () => {
    const filter = {
      kinds: [KIND_ZAP_RECEIPT],
      ["#e"]: [params.event.id],
    }
    try {
      const sub = nostr().subscribe(filter)

      sub?.on("event", async (zapEvent: AppEvent) => {
        sub.stop()
        const receiptInvoice = zapEvent.tagValue("bolt11")
        if (receiptInvoice) {
          const amountPaid = await getZapAmount(zapEvent)
          const zapRequest = zapInvoiceFromEvent(zapEvent)
          const amountRequested = zapRequest?.amount ? zapRequest.amount / 1000 : -1

          if (params.bolt11Invoice === receiptInvoice && amountPaid === amountRequested) {
            params.setZapped(true)
            params.onClose()
          }
        }
      })
    } catch (error) {
      warn("Unable to fetch zap receipt", error)
    }
  }

  return {
    handleZapAmountChange,
    handleConfirmCustomAmount,
    handleCustomAmountChange,
    handleZapMessageChange,
    handleSetDefaultAmount,
    handleSetDefaultComment,
    handleCopyPaymentRequest,
    handleZap,
    fetchZapReceipt,
  }
}
