import {useState, useEffect} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import {usePublicKey} from "@/stores/user"
import {RiFileCopyLine, RiQrCodeLine} from "@remixicon/react"

interface ReceiveEcashModeProps {
  manager: Manager | null
  onSuccess: () => void
  onClose: () => void
  onScanRequest?: () => void
  onRequestClick?: () => void
  initialToken?: string
}

export default function ReceiveEcashMode({
  manager,
  onSuccess,
  onClose,
  onScanRequest,
  onRequestClick,
  initialToken,
}: ReceiveEcashModeProps) {
  const myPubKey = usePublicKey()
  const [mode, setMode] = useState<"menu" | "paste">("menu")
  const [tokenInput, setTokenInput] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [receiveNote, setReceiveNote] = useState<string>("")
  const [receiving, setReceiving] = useState(false)
  const [previewAmount, setPreviewAmount] = useState<number | null>(null)
  const [previewMemo, setPreviewMemo] = useState<string>("")
  const [previewMint, setPreviewMint] = useState<string>("")

  // Handle initial token (from QR scan) and extract memo
  useEffect(() => {
    const handleInitialToken = async () => {
      if (!initialToken) return

      setTokenInput(initialToken)
      setMode("paste")

      // Try to extract memo from token
      try {
        const {getDecodedToken} = await import("@cashu/cashu-ts")
        const decoded = getDecodedToken(initialToken.trim())
        if (decoded.memo) {
          setReceiveNote(decoded.memo)
        }
      } catch (err) {
        console.warn("Failed to decode token for memo:", err)
      }
    }

    handleInitialToken()
  }, [initialToken])

  // Live preview of pasted token
  useEffect(() => {
    const decodeTokenPreview = async () => {
      const trimmed = tokenInput.trim()
      if (!trimmed || !trimmed.startsWith("cashu")) {
        setPreviewAmount(null)
        setPreviewMemo("")
        setPreviewMint("")
        return
      }

      try {
        const {getDecodedToken} = await import("@cashu/cashu-ts")
        const decoded = getDecodedToken(trimmed)

        // Calculate amount
        let total = 0
        if (decoded.proofs && Array.isArray(decoded.proofs)) {
          for (const proof of decoded.proofs) {
            total += proof.amount || 0
          }
        } else if (decoded.token && Array.isArray(decoded.token)) {
          for (const tokenEntry of decoded.token) {
            if (tokenEntry.proofs && Array.isArray(tokenEntry.proofs)) {
              for (const proof of tokenEntry.proofs) {
                total += proof.amount || 0
              }
            }
          }
        }

        setPreviewAmount(total)
        setPreviewMemo(decoded.memo || "")
        setPreviewMint(decoded.mint || "")

        // Auto-fill note from memo if not already set
        if (decoded.memo && !receiveNote) {
          setReceiveNote(decoded.memo)
        }
      } catch (err) {
        // Invalid token, clear preview
        setPreviewAmount(null)
        setPreviewMemo("")
        setPreviewMint("")
      }
    }

    decodeTokenPreview()
  }, [tokenInput, receiveNote])

  const receiveEcash = async () => {
    if (!manager || !tokenInput.trim()) return
    setReceiving(true)
    setError("")
    try {
      const {getDecodedToken} = await import("@cashu/cashu-ts")
      const decoded = getDecodedToken(tokenInput.trim())

      const mintUrl = decoded.mint
      if (mintUrl) {
        const isKnown = await manager.mint.isKnownMint(mintUrl)
        if (!isKnown) {
          await manager.mint.addMint(mintUrl)
        }
      }

      // Check if we have send metadata for this token (means we sent it originally)
      const {getPaymentMetadata, savePaymentMetadata} =
        await import("@/stores/paymentMetadata")
      const trimmedToken = tokenInput.trim()
      const existingMetadata = await getPaymentMetadata(trimmedToken)

      // Use receiveNote or fall back to token memo
      const noteToSave = receiveNote.trim() || decoded.memo || undefined

      // If we sent this token and are now redeeming it ourselves,
      // save metadata marking ourselves as the sender
      if (existingMetadata?.recipient && myPubKey) {
        await savePaymentMetadata(
          trimmedToken,
          "other",
          undefined,
          undefined,
          noteToSave,
          undefined,
          myPubKey
        )
      } else if (noteToSave) {
        // Save note even if no existing metadata
        await savePaymentMetadata(trimmedToken, "other", undefined, undefined, noteToSave)
      }

      await manager.wallet.receive(trimmedToken)

      // Get the most recent receive entry (just created) and save metadata by entry ID
      // This allows enrichment to find metadata for received tokens
      try {
        const recentHistory = await manager.history.getPaginatedHistory(0, 10)
        const receiveEntry = recentHistory.find(
          (e) =>
            e.type === "receive" &&
            e.mintUrl === mintUrl &&
            Math.abs(e.createdAt - Date.now()) < 5000 // Within last 5 seconds
        )

        if (receiveEntry && noteToSave) {
          // Save metadata using entry ID as key so enrichment can find it
          await savePaymentMetadata(
            `receive_entry_${receiveEntry.id}`,
            "other",
            undefined,
            undefined,
            noteToSave
          )
        }
      } catch (err) {
        console.warn("Failed to save metadata by entry ID:", err)
      }

      setTokenInput("")
      onClose()
      onSuccess()
    } catch (error) {
      console.error("Failed to receive token:", error)
      setError(
        "Failed to receive token: " +
          (error instanceof Error ? error.message : "Unknown error")
      )
    } finally {
      setReceiving(false)
    }
  }

  if (mode === "menu") {
    return (
      <div className="space-y-4">
        <button
          className="btn btn-outline w-full justify-start"
          onClick={() => setMode("paste")}
        >
          <RiFileCopyLine className="w-5 h-5 mr-2" />
          PASTE
        </button>

        <button
          className="btn btn-outline w-full justify-start"
          onClick={() => {
            onClose()
            onScanRequest?.()
          }}
        >
          <RiQrCodeLine className="w-5 h-5 mr-2" />
          SCAN
        </button>

        <button
          className="btn btn-outline w-full justify-start"
          onClick={() => onRequestClick?.()}
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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          REQUEST
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        receiveEcash()
      }}
      className="space-y-4"
    >
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <div className="form-control">
        <label className="label">
          <span className="label-text">Paste Cashu token</span>
        </label>
        <textarea
          className="textarea textarea-bordered h-24"
          placeholder="cashuA..."
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
        />
        {previewAmount !== null && (
          <div className="mt-2 p-3 bg-base-300 rounded-lg space-y-1">
            <div className="font-semibold text-success">{previewAmount} bits</div>
            {previewMemo && (
              <div className="text-sm text-base-content/70">{previewMemo}</div>
            )}
            {previewMint && (
              <div className="text-xs text-base-content/60">
                {previewMint.replace(/^https?:\/\//, "")}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="form-control">
        <label className="label">
          <span className="label-text">Note (optional)</span>
        </label>
        <input
          type="text"
          className="input input-bordered"
          placeholder="Add a note..."
          value={receiveNote}
          onChange={(e) => setReceiveNote(e.target.value)}
          maxLength={200}
        />
        <label className="label">
          <span className="label-text-alt text-base-content/60">
            Pre-filled from token memo, can be edited
          </span>
        </label>
      </div>
      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={!tokenInput.trim() || receiving}
      >
        {receiving ? "Receiving..." : "Receive"}
      </button>
    </form>
  )
}
