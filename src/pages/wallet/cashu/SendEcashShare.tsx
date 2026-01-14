import {useState, useEffect, useMemo} from "react"
import type {Manager} from "@/lib/cashu/core/index"
import {
  getDecodedToken,
  CashuMint,
  CashuWallet,
  type Token,
  type Proof,
} from "@cashu/cashu-ts"
import {RiShare2Line} from "@remixicon/react"
import {DoubleRatchetUserSearch} from "@/pages/chats/components/DoubleRatchetUserSearch"
import type {DoubleRatchetUser} from "@/pages/chats/utils/doubleRatchetUsers"
import {useNavigate} from "@/navigation"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useUserStore} from "@/stores/user"
import {useAnimatedQR} from "@/hooks/useAnimatedQR"
import CopyButton from "@/shared/components/button/CopyButton"
import {getSessionManagerAsync} from "@/shared/services/PrivateChats"
import {savePaymentMetadata} from "@/stores/paymentMetadata"
import {UserRow} from "@/shared/components/user/UserRow"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
const {log, warn, error: logError} = createDebugLogger(DEBUG_NAMESPACES.CASHU_WALLET)

interface SendEcashShareProps {
  manager: Manager | null
  generatedToken: string
  initialToken?: Token
  selectedUserPubkey: string | null
  onClose: () => void
}

export default function SendEcashShare({
  manager,
  generatedToken,
  initialToken,
  selectedUserPubkey,
  onClose,
}: SendEcashShareProps) {
  const navigate = useNavigate()
  const isTopOfStack = useIsTopOfStack()
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("")
  const [sendingDm, setSendingDm] = useState(false)
  const [error, setError] = useState<string>("")
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [tokenStatus, setTokenStatus] = useState<"spent" | "unspent" | null>(null)
  const [recipientPubkey, setRecipientPubkey] = useState<string | null>(null)

  const {currentFragment, isAnimated} = useAnimatedQR(generatedToken)

  // Load recipient from metadata if viewing a sent token from history
  useEffect(() => {
    const loadMetadata = async () => {
      if (!generatedToken || selectedUserPubkey) return // Skip if payment request recipient

      const {getPaymentMetadata} = await import("@/stores/paymentMetadata")
      const metadata = await getPaymentMetadata(generatedToken)
      if (metadata?.recipient) {
        setRecipientPubkey(metadata.recipient)
      }
    }
    loadMetadata()
  }, [generatedToken, selectedUserPubkey])

  // Auto-send to payment request recipient if specified
  useEffect(() => {
    if (!isTopOfStack) return

    const autoSendDm = async () => {
      if (!selectedUserPubkey || !generatedToken) return

      log("🚀 Auto-sending token to payment request recipient:", selectedUserPubkey)
      setSendingDm(true)
      setError("")

      try {
        const sessionManager = await getSessionManagerAsync()
        log("✓ Session manager available")

        const myPubKey = useUserStore.getState().publicKey
        if (!myPubKey) {
          throw new Error("User not logged in")
        }
        log("✓ User logged in:", myPubKey)

        log("📨 Sending message...")
        const sentMessage = await sessionManager.sendMessage(
          selectedUserPubkey,
          generatedToken
        )
        log("✓ Message sent:", sentMessage.id)

        // Update local store
        await usePrivateMessagesStore
          .getState()
          .upsert(selectedUserPubkey, myPubKey, sentMessage)
        log("✓ Local store updated")

        // Save payment metadata
        try {
          await savePaymentMetadata(
            generatedToken,
            "dm",
            selectedUserPubkey,
            undefined,
            undefined
          )
          log("✓ Payment metadata saved")
        } catch (err) {
          warn("Failed to save payment metadata:", err)
        }

        // Navigate to chat
        log("✓ Navigating to chat...")
        onClose()
        navigate("/chats/chat", {
          state: {id: selectedUserPubkey},
        })
      } catch (err) {
        logError("❌ Failed to auto-send token via DM:", err)
        setError(
          "Failed to send DM: " + (err instanceof Error ? err.message : "Unknown error")
        )
        setSendingDm(false)
      }
    }

    autoSendDm()
  }, [isTopOfStack, selectedUserPubkey, generatedToken, onClose, navigate])

  // Parse token to extract amount and memo
  const tokenData = useMemo(() => {
    // If we have initialToken (Token object from history), use it directly
    if (initialToken) {
      let total = 0
      const token = initialToken

      // Handle v3 tokens (token array format)
      if ("token" in token && Array.isArray(token.token)) {
        for (const entry of token.token) {
          if (entry.proofs && Array.isArray(entry.proofs)) {
            for (const proof of entry.proofs) {
              total += proof.amount || 0
            }
          }
        }
      }
      // Handle v4 tokens (direct proofs array)
      else if ("proofs" in token && Array.isArray(token.proofs)) {
        for (const proof of token.proofs) {
          total += proof.amount || 0
        }
      }

      return {
        amount: total,
        memo: token.memo || "",
      }
    }

    // Otherwise decode from generated token string
    if (!generatedToken) return {amount: 0, memo: ""}
    try {
      const decoded = getDecodedToken(generatedToken)
      let total = 0

      // Handle v3 tokens (token array format)
      if (decoded.token && Array.isArray(decoded.token)) {
        for (const entry of decoded.token) {
          if (entry.proofs && Array.isArray(entry.proofs)) {
            for (const proof of entry.proofs) {
              total += proof.amount || 0
            }
          }
        }
      }
      // Handle v4 tokens (direct proofs array)
      else if (decoded.proofs && Array.isArray(decoded.proofs)) {
        for (const proof of decoded.proofs) {
          total += proof.amount || 0
        }
      }

      return {
        amount: total,
        memo: decoded.memo || "",
      }
    } catch (err) {
      logError("Failed to decode token:", err)
      return {amount: 0, memo: ""}
    }
  }, [initialToken, generatedToken])

  // Generate QR code
  useEffect(() => {
    const generateQR = async () => {
      const dataToEncode = isAnimated ? currentFragment : generatedToken
      if (!dataToEncode) {
        setQrCodeUrl("")
        return
      }
      try {
        const QRCode = await import("qrcode")
        const url = await new Promise<string>((resolve, reject) => {
          QRCode.toDataURL(
            dataToEncode,
            {
              errorCorrectionLevel: "H",
              margin: 1,
              width: 256,
              color: {
                dark: "#000000",
                light: "#FFFFFF",
              },
            },
            (error, url) => {
              if (error) reject(error)
              else resolve(url)
            }
          )
        })
        setQrCodeUrl(url)
      } catch (err) {
        logError("Error generating QR code:", err)
      }
    }
    generateQR()
  }, [generatedToken, currentFragment, isAnimated])

  const handleSendTokenDm = async (user: DoubleRatchetUser) => {
    if (!generatedToken) return

    log("📤 Sending token via DM to:", user.pubkey)
    setSendingDm(true)
    setError("")
    try {
      const sessionManager = await getSessionManagerAsync()
      log("✓ Session manager available")

      const myPubKey = useUserStore.getState().publicKey
      if (!myPubKey) {
        throw new Error("User not logged in")
      }
      log("✓ User logged in:", myPubKey)

      // Send the message (dmMessage not implemented yet, just send token)
      const messageContent = generatedToken
      log("📨 Sending message...")
      const sentMessage = await sessionManager.sendMessage(user.pubkey, messageContent)
      log("✓ Message sent:", sentMessage.id)

      // Update local store
      await usePrivateMessagesStore.getState().upsert(user.pubkey, myPubKey, sentMessage)
      log("✓ Local store updated")

      // Save payment metadata
      try {
        await savePaymentMetadata(generatedToken, "dm", user.pubkey, undefined, undefined)
        log("✓ Payment metadata saved")
      } catch (err) {
        warn("Failed to save payment metadata:", err)
      }

      // Navigate to chat
      log("✓ Navigating to chat...")
      onClose()
      navigate("/chats/chat", {
        state: {id: user.pubkey},
      })
    } catch (err) {
      logError("❌ Failed to send token via DM:", err)
      setError(
        "Failed to send DM: " + (err instanceof Error ? err.message : "Unknown error")
      )
    } finally {
      setSendingDm(false)
    }
  }

  const checkTokenStatus = async () => {
    if (!generatedToken || !manager) return

    setCheckingStatus(true)
    setError("")
    setTokenStatus(null)
    try {
      const decoded = getDecodedToken(generatedToken)

      // Get proofs
      const proofs: Proof[] = []

      if (decoded.token && Array.isArray(decoded.token) && decoded.token[0]) {
        proofs.push(...(decoded.token[0].proofs || []))
      } else if (decoded.proofs) {
        proofs.push(...decoded.proofs)
      }

      if (proofs.length === 0) {
        setError("Invalid token format")
        return
      }

      // Get mint URL
      const mintUrl = decoded.mint
      if (!mintUrl) {
        setError("No mint URL in token")
        return
      }

      // Create temporary wallet instance to check proof states
      const mint = new CashuMint(mintUrl)
      const mintKeys = await mint.getKeys()
      const tempWallet = new CashuWallet(mint, {keys: mintKeys.keysets})

      const states = await tempWallet.checkProofsStates(proofs)

      // If any proof is spent, token is spent
      const isSpent = states.some((state) => state.state === "SPENT")
      setTokenStatus(isSpent ? "spent" : "unspent")
    } catch (err) {
      logError("Failed to check token status:", err)
      setError(
        "Failed to check status: " +
          (err instanceof Error ? err.message : "Unknown error")
      )
    } finally {
      setCheckingStatus(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {recipientPubkey && (
        <div
          className="alert alert-info cursor-pointer hover:bg-info/30 transition-colors"
          onClick={() => {
            onClose()
            navigate("/chats/chat", {state: {id: recipientPubkey}})
          }}
        >
          <div className="flex flex-col gap-2 w-full">
            <div className="text-sm font-semibold">Sent to:</div>
            <UserRow pubKey={recipientPubkey} />
          </div>
        </div>
      )}
      <div className="alert alert-success">
        <div className="flex flex-col gap-1">
          <div className="font-bold text-lg">{tokenData.amount} bit</div>
          {tokenData.memo && <div className="text-sm opacity-80">{tokenData.memo}</div>}
        </div>
      </div>
      <div className="form-control">
        <label className="label">
          <span className="label-text">Cashu Token</span>
        </label>
        <textarea
          className="textarea textarea-bordered h-32 font-mono text-xs resize-none"
          value={generatedToken}
          readOnly
        />
      </div>
      <div className="flex gap-2">
        <CopyButton
          copyStr={generatedToken}
          text="Copy"
          className="btn btn-primary flex-1 gap-2"
        />
        {navigator.share && (
          <button
            className="btn btn-primary flex-1 gap-2"
            onClick={async () => {
              try {
                await navigator.share({
                  text: generatedToken,
                  title: "Cashu Token",
                })
              } catch (err) {
                warn("Share failed:", err)
              }
            }}
          >
            <RiShare2Line className="w-5 h-5" />
            Share
          </button>
        )}
      </div>
      <button
        className="btn btn-outline w-full"
        onClick={checkTokenStatus}
        disabled={checkingStatus}
      >
        {checkingStatus ? "Checking..." : "Check Status"}
      </button>
      {tokenStatus && (
        <div
          className={`alert ${tokenStatus === "spent" ? "alert-warning" : "alert-success"}`}
        >
          <span>
            {tokenStatus === "spent"
              ? "✓ Token has been claimed"
              : "Token not yet claimed"}
          </span>
        </div>
      )}
      <div className="divider">DM</div>
      <div className="form-control">
        <DoubleRatchetUserSearch
          placeholder="Search secure messaging users..."
          onUserSelect={handleSendTokenDm}
          maxResults={5}
          showCount={false}
        />
        {sendingDm && (
          <div className="alert alert-info mt-2">
            <span>Sending DM...</span>
          </div>
        )}
      </div>
      <div className="divider">QR</div>
      {qrCodeUrl && (
        <div className="flex justify-center">
          <div className="bg-white rounded-lg p-4">
            <img src={qrCodeUrl} alt="Cashu Token QR Code" className="w-64 h-64" />
          </div>
        </div>
      )}
      <button className="btn btn-ghost w-full" onClick={onClose}>
        Done
      </button>
    </div>
  )
}
