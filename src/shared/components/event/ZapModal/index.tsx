import {Dispatch, FormEvent, SetStateAction} from "react"
import {AppEvent, UserProfile} from "@/lib/nostr"
import Modal from "@/shared/components/ui/Modal.tsx"
import {useZapModalState} from "./useZapModalState"
import {useZapModalHandlers} from "./useZapModalHandlers"
import {useQRCodeGenerator} from "./useQRCodeGenerator"
import {useZapReceiptPoller} from "./useZapReceiptPoller"
import {ZapModalHeader} from "./ZapModalHeader"
import {ZapAmountSelector} from "./ZapAmountSelector"
import {ZapQRCodeView} from "./ZapQRCodeView"
import {ZapFormInputs} from "./ZapFormInputs"
import {ZAP_AMOUNTS} from "./constants"

interface ZapModalProps {
  onClose: () => void
  event: AppEvent
  profile: UserProfile | null
  setZapped: Dispatch<SetStateAction<boolean>>
  initialInvoice?: string
  initialAmount?: string
  paymentFailed?: boolean
}

function ZapModal({
  onClose,
  event,
  profile,
  setZapped,
  initialInvoice,
  initialAmount,
  paymentFailed,
}: ZapModalProps) {
  const state = useZapModalState({initialInvoice, initialAmount, paymentFailed})

  const handlers = useZapModalHandlers({
    ...state,
    setZapped,
    event,
    profile,
    onClose,
  })

  // Generate QR code when needed
  useQRCodeGenerator(
    state.showQRCode,
    state.bolt11Invoice,
    state.setQrCodeUrl,
    state.setErrorMessage
  )

  // Poll for zap receipts
  useZapReceiptPoller(state.showQRCode, handlers.fetchZapReceipt)

  // Build amounts object with default amount if set
  const amounts: Record<string, string> = {
    ...(state.defaultZapAmount > 0 ? {[state.defaultZapAmount.toString()]: ""} : {}),
    ...ZAP_AMOUNTS,
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    handlers.handleZap()
  }

  return (
    <Modal onClose={onClose} hasBackground={true}>
      <div className="flex flex-col items-center justify-center p-4 gap-6">
        <ZapModalHeader pubKey={event.pubkey} />

        <ZapAmountSelector
          amounts={amounts}
          zapAmount={state.zapAmount}
          onAmountChange={handlers.handleZapAmountChange}
        />

        {state.showQRCode ? (
          <ZapQRCodeView
            hasWallet={state.hasWallet}
            errorMessage={state.errorMessage}
            paymentFailed={paymentFailed}
            zapAmount={state.zapAmount}
            zapMessage={state.zapMessage}
            qrCodeUrl={state.qrCodeUrl}
            bolt11Invoice={state.bolt11Invoice}
            copiedPaymentRequest={state.copiedPaymentRequest}
            onCopyPaymentRequest={handlers.handleCopyPaymentRequest}
          />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
            <ZapFormInputs
              customAmount={state.customAmount}
              zapAmount={state.zapAmount}
              onCustomAmountChange={handlers.handleCustomAmountChange}
              onConfirmCustomAmount={handlers.handleConfirmCustomAmount}
              zapMessage={state.zapMessage}
              onZapMessageChange={handlers.handleZapMessageChange}
              shouldSetDefault={state.shouldSetDefault}
              onSetDefaultAmount={handlers.handleSetDefaultAmount}
              shouldSetDefaultComment={state.shouldSetDefaultComment}
              onSetDefaultComment={handlers.handleSetDefaultComment}
              defaultZapComment={state.defaultZapComment}
              zapDonationEnabled={state.zapDonationEnabled}
              setZapDonationEnabled={state.setZapDonationEnabled}
              zapDonationRecipients={state.zapDonationRecipients}
              donationPubkeys={state.donationPubkeys}
              recipientNames={state.recipientNames}
              totalDonationAmount={state.totalDonationAmount}
              isProcessing={state.isProcessing}
              effectiveDonationAmount={state.effectiveDonationAmount}
              noAddress={state.noAddress}
              errorMessage={state.errorMessage}
            />
          </form>
        )}
      </div>
    </Modal>
  )
}

export default ZapModal
