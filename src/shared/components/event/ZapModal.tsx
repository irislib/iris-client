import {
  ChangeEvent,
  Dispatch,
  FormEvent,
  SetStateAction,
  useEffect,
  useState,
} from "react"
import {NostrEvent} from "nostr-tools"
import {getTagValue} from "@/utils/nostr"
import {RiCheckLine, RiFileCopyLine} from "@remixicon/react"
import {decode} from "light-bolt11-decoder"

import {Avatar} from "@/shared/components/user/Avatar"
import Modal from "@/shared/components/ui/Modal.tsx"
import {Name} from "@/shared/components/user/Name"
// import {useUserStore} from "@/stores/user" // Temporarily disabled
import {useZapStore} from "@/stores/zap"
import {subscribe} from "@/utils/applesauce"

interface ZapModalProps {
  onClose: () => void
  event: NostrEvent
  setZapped: Dispatch<SetStateAction<boolean>>
}

function ZapModal({onClose, event, setZapped}: ZapModalProps) {
  const {defaultZapAmount, setDefaultZapAmount} = useZapStore()
  // Temporarily disabled for NDK migration
  // const {walletConnect: isWalletConnect} = useUserStore()
  const [copiedPaymentRequest, setCopiedPaymentRequest] = useState(false)
  const [noAddress, setNoAddress] = useState(false)
  // const [showQRCode, setShowQRCode] = useState(false)
  // const [bolt11Invoice, setBolt11Invoice] = useState<string>("")
  const [zapAmount, setZapAmount] = useState<string>(defaultZapAmount.toString())
  const [customAmount, setCustomAmount] = useState<string>("")
  const [zapMessage, setZapMessage] = useState<string>("")
  const [shouldSetDefault, setShouldSetDefault] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string>("")
  // const [qrCodeUrl, setQrCodeUrl] = useState<string>("") // Temporarily disabled
  // const [zapRefresh, setZapRefresh] = useState(false) // Temporarily disabled

  const amounts: Record<string, string> = {
    [defaultZapAmount.toString()]: "",
    "1000": "👍",
    "5000": "💜",
    "10000": "😍",
    "20000": "🤩",
    "50000": "🔥",
    "100000": "🚀",
    "1000000": "🤯",
  }

  const handleZapAmountChange = (amount: string) => {
    setZapAmount(amount)
    setCustomAmount("")
  }

  const handleConfirmCustomAmount = () => {
    setZapAmount(customAmount)
  }

  const handleCustomAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCustomAmount(event.target.value)
  }

  const handleZapMessageChange = (event: ChangeEvent<HTMLInputElement>) => {
    setZapMessage(event.target.value)
  }

  const handleSetDefaultAmount = (e: ChangeEvent<HTMLInputElement>) => {
    setShouldSetDefault(e.target.checked)
  }

  const handleCopyPaymentRequest = () => {
    // navigator.clipboard.writeText(bolt11Invoice) // Disabled - zap functionality not available
    setCopiedPaymentRequest(true)
    setTimeout(() => {
      setCopiedPaymentRequest(false)
    }, 3000)
  }

  const handleZap = async () => {
    setNoAddress(false)
    setError("")
    setIsProcessing(true)
    try {
      if (Number(zapAmount) < 1) {
        setError("Zap amount must be greater than 0")
        return
      }
    } catch (error) {
      setError("Zap amount must be a valid number")
      console.warn("Zap amount must be a number: ", error)
    }
    try {
      // const amount = Number(zapAmount) * 1000 // Temporarily disabled

      if (shouldSetDefault) {
        setDefaultZapAmount(Number(zapAmount))
      }

      // TODO: Implement zapping with applesauce - NDK functionality temporarily disabled
      console.warn("Zapping functionality temporarily disabled - NDK replacement needed")
      /*
      const lnPay: LnPayCb = async ({pr}) => {
        if (isWalletConnect) {
          try {
            const {requestProvider} = await import("@getalby/bitcoin-connect-react")
            const provider = await requestProvider()
            await provider.sendPayment(pr)
            setZapped(true)
            setZapRefresh(!zapRefresh)
            onClose()
            return provider.sendPayment(pr)
          } catch (error) {
            setError("Failed to connect to wallet. Please try again.")
            throw error
          }
        } else {
          setBolt11Invoice(pr)
          setShowQRCode(true)
          return undefined
        }
      }

      const zapper = new NDKZapper(event, amount, "msat", {
        comment: zapMessage,
        // ndk: ndk(), // TODO: implement zapper with applesauce
        lnPay,
        tags: [
          ["e", event.id],
          ["p", event.pubkey],
        ],
      })

      await zapper.zap()
      */
    } catch (error) {
      console.warn("Zap failed: ", error)
      if (error instanceof Error) {
        if (error.message.includes("No zap endpoint found")) {
          setNoAddress(true)
        } else {
          setError(error.message || "Failed to process zap. Please try again.")
        }
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const fetchZapReceipt = () => {
    const filter = {
      kinds: [9735],
      ["#e"]: [event.id],
    }
    try {
      const sub = subscribe(filter)

      sub?.on("event", async (event: NostrEvent) => {
        sub.stop()
        const receiptInvoice = getTagValue(event, "bolt11")
        if (receiptInvoice) {
          const decodedInvoice = decode(receiptInvoice)
          // TODO: implement zapInvoiceFromEvent with applesauce
          // const zapRequest = zapInvoiceFromEvent(event)

          const amountSection = decodedInvoice.sections.find(
            (section) => section.name === "amount"
          )
          const amountPaid =
            amountSection && "value" in amountSection
              ? Math.floor(parseInt(amountSection.value) / 1000)
              : 0
          const amountRequested = -1 // zapRequest?.amount ? zapRequest.amount / 1000 : -1

          if (false && amountPaid === amountRequested) {
            // bolt11Invoice === receiptInvoice
            setZapped(true)
            onClose()
          }
        }
      })
    } catch (error) {
      console.warn("Unable to fetch zap receipt", error)
    }
  }

  useEffect(() => {
    const timer = setInterval(() => {
      fetchZapReceipt()
    }, 2500)

    return () => {
      clearInterval(timer)
    }
  }, []) // showQRCode disabled

  useEffect(() => {
    // QR code generation disabled - zap functionality not available
    // if (showQRCode && bolt11Invoice) {
    //   const generateQRCode = async () => {
    //     try {
    //       const QRCode = await import("qrcode")
    //       QRCode.toDataURL(`lightning:${bolt11Invoice}`, function (error, url) {
    //         if (error) {
    //           setError("Failed to generate QR code")
    //           console.error("Error generating QR code:", error)
    //         } else {
    //           setQrCodeUrl(url)
    //         }
    //       })
    //     } catch (error) {
    //       setError("Failed to generate QR code")
    //       console.error("Error importing QRCode:", error)
    //     }
    //   }
    //   generateQRCode()
    // }
  }, []) // showQRCode, bolt11Invoice disabled

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    handleZap()
  }

  return (
    <Modal onClose={onClose} hasBackground={true}>
      <div className="flex flex-col items-center justify-center p-4 gap-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <Avatar pubKey={event.pubkey} width={40} showBadge={false} />
            <div className="flex flex-col">
              <span className="text-sm opacity-70">Send zap to</span>
              <Name pubKey={event.pubkey} className="font-semibold" />
            </div>
          </div>
          <h3 className="font-semibold uppercase">Zap amount in sats</h3>
        </div>

        <div className="grid grid-cols-4 gap-2 w-full">
          {Object.entries(amounts).map(([amount, emoji]) => (
            <button
              key={amount}
              onClick={() => handleZapAmountChange(amount)}
              className={`btn ${
                zapAmount === amount ? "btn-primary" : "btn-neutral"
              } w-full`}
            >
              {emoji} {parseInt(amount) >= 1000 ? `${parseInt(amount) / 1000}K` : amount}
            </button>
          ))}
        </div>

        {false ? ( // showQRCode disabled
          <div className="flex flex-col items-center gap-4">
            <p>
              Scan the QR code to zap <b>{zapAmount} sats</b>
            </p>
            <div className="w-40 h-40">
              {false && <img id="qr-image" className="w-40 h-40" src="" />}
            </div>
            <a href={`lightning:undefined`} className="btn btn-primary w-full">
              Open in Wallet
            </a>
            <button
              className="btn btn-neutral gap-2 w-full"
              onClick={handleCopyPaymentRequest}
            >
              {!copiedPaymentRequest ? <RiFileCopyLine /> : <RiCheckLine />}
              Copy zap invoice
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
            {noAddress && (
              <span className="text-red-500">The user has no lightning address.</span>
            )}
            {error && <span className="text-red-500">{error}</span>}

            <div className="flex gap-2">
              <input
                type="number"
                className="input input-bordered grow"
                value={customAmount}
                onChange={handleCustomAmountChange}
                placeholder="Custom amount"
              />
              <button
                type="button"
                className="btn btn-neutral"
                onClick={handleConfirmCustomAmount}
                disabled={
                  !customAmount || Number(customAmount) <= 0 || customAmount === zapAmount
                }
              >
                Confirm
              </button>
            </div>

            <input
              type="text"
              className="input input-bordered w-full"
              value={zapMessage}
              onChange={handleZapMessageChange}
              placeholder="Comment (optional)"
            />

            <label className="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                className="checkbox"
                checked={shouldSetDefault}
                onChange={handleSetDefaultAmount}
              />
              <span className="label-text">Set as default zap amount</span>
            </label>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <div className="loading loading-spinner loading-sm" />
              ) : (
                `Zap ${zapAmount} sats`
              )}
            </button>
          </form>
        )}
      </div>
    </Modal>
  )
}

export default ZapModal
