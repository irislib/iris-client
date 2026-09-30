import {useState, useEffect} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import {usePublicKey} from "@/stores/user"
import {getLightningAddress, getNPubCashInfo} from "@/lib/npubcash"
import {truncateMiddle} from "@/utils/utils"
import {RiFileCopyLine, RiCheckLine} from "@remixicon/react"
import CopyButton from "@/shared/components/button/CopyButton"
import {decode} from "light-bolt11-decoder"
import {useQRCode} from "../hooks/useQRCode"
import {nostr} from "@/utils/nostrClient"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.CASHU_WALLET)

interface ReceiveLightningModeProps {
  manager: Manager | null
  mintUrl: string
  onClose: () => void
  initialInvoice?: string
}

export default function ReceiveLightningMode({
  manager,
  mintUrl,
  onClose,
  initialInvoice,
}: ReceiveLightningModeProps) {
  const myPubKey = usePublicKey()
  const [lightningAmount, setLightningAmount] = useState<number>(100)
  const [lightningDescription, setLightningDescription] = useState<string>("")
  const [invoice, setInvoice] = useState<string>("")
  const [receiving, setReceiving] = useState(false)
  const [addressCopied, setAddressCopied] = useState(false)
  const [hasMintConfigured, setHasMintConfigured] = useState<boolean>(false)
  const [checkingMint, setCheckingMint] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string>("")

  // Generate QR for lightning address (when no invoice yet)
  const lightningAddress = myPubKey ? getLightningAddress(myPubKey) : ""
  const lightningAddressQR = useQRCode(
    `lightning:${lightningAddress}`,
    !invoice && hasMintConfigured && !!myPubKey
  )

  // Generate QR for invoice (when invoice exists)
  const invoiceQR = useQRCode(`lightning:${invoice}`, !!invoice)

  // Handle initial invoice (from pending mint entry)
  useEffect(() => {
    const loadInitialInvoice = async () => {
      if (!initialInvoice) return

      setInvoice(initialInvoice)

      // Decode invoice to extract amount and description
      try {
        const decoded = decode(initialInvoice)
        const amountSection = decoded.sections.find(
          (s: {name: string}) => s.name === "amount"
        )
        const descSection = decoded.sections.find(
          (s: {name: string}) => s.name === "description"
        )

        if (amountSection && "value" in amountSection && amountSection.value) {
          // Amount is in millisats, convert to sats
          setLightningAmount(Math.floor(Number(amountSection.value) / 1000))
        }
        if (descSection && "value" in descSection && descSection.value) {
          setLightningDescription(String(descSection.value))
        }
      } catch (err) {
        warn("Failed to decode invoice:", err)
      }
    }

    loadInitialInvoice()
  }, [initialInvoice])

  // Check if mint is configured and ensure npub.cash default mint exists
  useEffect(() => {
    const checkMint = async () => {
      if (!manager || !myPubKey) {
        setHasMintConfigured(false)
        return
      }

      setCheckingMint(true)
      try {
        // Check if any mint exists
        const balances = await manager.wallet.getBalances()
        const hasMint = Object.keys(balances).length > 0

        if (!hasMint) {
          // Try to get default mint from npub.cash
          const signer = nostr().signer
          if (signer) {
            const info = await getNPubCashInfo(signer)
            if (info?.mintUrl) {
              log(`Adding default npub.cash mint: ${info.mintUrl}`)
              try {
                await manager.mint.addMint(info.mintUrl)
                setHasMintConfigured(true)
              } catch (err) {
                error("Failed to add default mint:", err)
                setHasMintConfigured(false)
              }
            } else {
              setHasMintConfigured(false)
            }
          } else {
            setHasMintConfigured(false)
          }
        } else {
          setHasMintConfigured(true)
        }
      } catch (err) {
        error("Error checking mint:", err)
        setHasMintConfigured(false)
      } finally {
        setCheckingMint(false)
      }
    }

    checkMint()
  }, [manager, myPubKey])

  const createLightningInvoice = async () => {
    if (!manager || !mintUrl || !lightningAmount) return
    setReceiving(true)
    setErrorMessage("")
    try {
      const quote = await manager.quotes.createMintQuote(
        mintUrl,
        lightningAmount,
        lightningDescription.trim() || undefined
      )
      setInvoice(quote.request)
    } catch (err) {
      error("Failed to create mint quote:", err)
      setErrorMessage(
        "Failed to create invoice: " +
          (err instanceof Error ? err.message : "Unknown error")
      )
    } finally {
      setReceiving(false)
    }
  }

  if (checkingMint) {
    return (
      <div className="flex justify-center p-8">
        <div className="text-base-content/60">Setting up mint...</div>
      </div>
    )
  }

  if (!hasMintConfigured) {
    return (
      <div className="alert alert-warning">
        <div className="flex flex-col gap-2">
          <div className="font-semibold">No mint configured</div>
          <div className="text-sm">
            Please add a mint in the Mints tab before using Lightning payments. Payments
            to your npub.cash address will be automatically received once a mint is
            configured.
          </div>
          <button
            className="btn btn-sm btn-primary mt-2"
            onClick={() => {
              onClose()
            }}
          >
            Go to Wallet
          </button>
        </div>
      </div>
    )
  }

  if (invoice) {
    return (
      <div className="space-y-4">
        {lightningAmount > 0 && (
          <div className="text-center">
            <div className="text-3xl font-bold">{lightningAmount} bit</div>
            {lightningDescription && (
              <div className="text-sm text-base-content/70 mt-1">
                {lightningDescription}
              </div>
            )}
          </div>
        )}

        {invoiceQR && (
          <div className="flex justify-center">
            <div className="bg-white rounded-lg p-4">
              <img
                src={invoiceQR}
                alt="Lightning Invoice QR Code"
                className="w-64 h-64"
              />
            </div>
          </div>
        )}

        <CopyButton
          copyStr={invoice}
          text="Copy Invoice"
          className="btn btn-primary w-full"
        />

        <div className="form-control">
          <label className="label">
            <span className="label-text">Lightning Invoice</span>
          </label>
          <textarea
            className="textarea textarea-bordered h-24 font-mono text-xs resize-none"
            value={invoice}
            readOnly
          />
        </div>

        <button
          className="btn btn-ghost w-full"
          onClick={() => {
            setInvoice("")
            setLightningAmount(100)
            setLightningDescription("")
            onClose()
          }}
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="alert alert-error">
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Lightning Address */}
      {myPubKey && lightningAddressQR && (
        <div className="space-y-4">
          <div className="flex justify-center">
            <div className="bg-white rounded-lg p-4">
              <img
                src={lightningAddressQR}
                alt="Lightning Address QR Code"
                className="w-64 h-64"
              />
            </div>
          </div>
          <div
            className="flex items-center justify-center gap-2 bg-base-200 rounded-lg p-3 cursor-pointer hover:bg-base-300 transition-colors"
            onClick={() => {
              const address = getLightningAddress(myPubKey)
              navigator.clipboard.writeText(address)
              setAddressCopied(true)
              setTimeout(() => setAddressCopied(false), 2000)
            }}
          >
            <span className="text-sm font-mono">{truncateMiddle(lightningAddress)}</span>
            {addressCopied ? (
              <RiCheckLine className="w-5 h-5 text-success" />
            ) : (
              <RiFileCopyLine className="w-5 h-5 opacity-60" />
            )}
          </div>
          <div className="divider">OR</div>
        </div>
      )}

      <div className="form-control">
        <label className="label">
          <span className="label-text">Create invoice for specific amount (bits)</span>
        </label>
        <input
          type="number"
          className="input input-bordered"
          placeholder="100"
          value={lightningAmount}
          onChange={(e) => setLightningAmount(Number(e.target.value))}
        />
      </div>
      <div className="form-control">
        <label className="label">
          <span className="label-text">Description (optional)</span>
        </label>
        <input
          type="text"
          className="input input-bordered"
          placeholder="What is this payment for?"
          value={lightningDescription}
          onChange={(e) => setLightningDescription(e.target.value)}
          maxLength={200}
        />
      </div>
      <button
        className="btn btn-primary w-full"
        onClick={createLightningInvoice}
        disabled={!lightningAmount || receiving}
      >
        {receiving ? "Creating..." : "Create Invoice"}
      </button>
    </div>
  )
}
