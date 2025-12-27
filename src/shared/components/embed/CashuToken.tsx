import {useState, useEffect} from "react"
import {RiBitCoinFill, RiLockLine} from "@remixicon/react"
import type {Proof} from "@cashu/cashu-ts"
import Embed, {type EmbedComponentProps} from "./index.ts"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

function CashuTokenComponent({match, event}: EmbedComponentProps) {
  const [amount, setAmount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [copied, setCopied] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemed, setRedeemed] = useState(false)
  const [p2pkLock, setP2pkLock] = useState<string | null>(null)
  const [canRedeem, setCanRedeem] = useState(true)
  const [memo, setMemo] = useState<string>("")
  const [mintUrl, setMintUrl] = useState<string>("")
  const [isOwnEvent, setIsOwnEvent] = useState(false)
  const [checking, setChecking] = useState(false)
  const [tokenSpent, setTokenSpent] = useState(false)
  const [lastCheckStatus, setLastCheckStatus] = useState<"UNSPENT" | "SPENT" | null>(null)

  // Decode on mount and check if already redeemed
  useEffect(() => {
    const decodeToken = async () => {
      setLoading(true)
      try {
        const trimmedToken = match.trim()

        // Check if event author is us
        const {useUserStore} = await import("@/stores/user")
        const myPubKey = useUserStore.getState().publicKey
        setIsOwnEvent(event?.pubkey === myPubKey)

        // Check if already redeemed (has sender metadata = was received)
        const {getPaymentMetadata} = await import("@/stores/paymentMetadata")
        const metadata = await getPaymentMetadata(trimmedToken)
        if (metadata?.sender) {
          setRedeemed(true)
        }

        const {getDecodedToken} = await import("@cashu/cashu-ts")
        const decoded = getDecodedToken(trimmedToken)

        // Calculate total amount and check for P2PK locks
        let totalAmount = 0
        let lockedPubkey: string | null = null

        const checkProofsForP2PK = (
          proofs: Array<{amount?: number; secret?: string}>
        ) => {
          for (const proof of proofs) {
            totalAmount += proof.amount || 0

            // Check if proof has P2PK lock
            if (proof.secret && typeof proof.secret === "string") {
              try {
                // P2PK secrets are JSON with format: ["P2PK", {"nonce":"...","data":"<pubkey>","tags":[...]}]
                const secretData = JSON.parse(proof.secret)
                if (Array.isArray(secretData) && secretData[0] === "P2PK") {
                  const p2pkData = secretData[1]
                  if (p2pkData?.data) {
                    lockedPubkey = p2pkData.data
                  }
                }
              } catch {
                // Not a P2PK secret, continue
              }
            }
          }
        }

        if (decoded.proofs && Array.isArray(decoded.proofs)) {
          checkProofsForP2PK(decoded.proofs)
        } else if (decoded.token && Array.isArray(decoded.token)) {
          for (const tokenEntry of decoded.token) {
            if (tokenEntry.proofs && Array.isArray(tokenEntry.proofs)) {
              checkProofsForP2PK(tokenEntry.proofs)
            }
          }
        }

        setAmount(totalAmount)
        setP2pkLock(lockedPubkey)
        setMemo(decoded.memo || "")
        setMintUrl(decoded.mint || "")

        // Check if we can redeem (only if locked to our pubkey)
        if (lockedPubkey) {
          const {useUserStore} = await import("@/stores/user")
          const myPubKey = useUserStore.getState().publicKey
          setCanRedeem(lockedPubkey === myPubKey)
        }
      } catch (caughtError) {
        error("❌ Failed to decode cashu token:", caughtError)
        setErrorMessage(
          caughtError instanceof Error ? caughtError.message : "Invalid token"
        )
      } finally {
        setLoading(false)
      }
    }

    decodeToken()
  }, [match])

  const handleRedeem = async () => {
    setRedeeming(true)
    setErrorMessage("")
    try {
      const {getCashuManager} = await import("@/lib/cashu/manager")
      const manager = getCashuManager()

      if (!manager) {
        setErrorMessage("Wallet not initialized")
        return
      }

      const trimmedToken = match.trim()

      // Save metadata BEFORE redeeming so it's available when history entry is created
      const {getPaymentMetadata, savePaymentMetadata} =
        await import("@/stores/paymentMetadata")

      // Check if we have send metadata for this token (means we sent it originally)
      const existingMetadata = await getPaymentMetadata(trimmedToken)

      // Determine sender: if redeeming our own token, use our pubkey
      // Otherwise use event author (or undefined if can't determine)
      const {useUserStore} = await import("@/stores/user")
      const myPubKey = useUserStore.getState().publicKey

      let senderPubkey: string | undefined
      if (existingMetadata?.recipient) {
        // We sent this token originally, now redeeming it ourselves
        senderPubkey = myPubKey
      } else if (event?.pubkey) {
        // Normal receive from someone else (NDKEvent with pubkey)
        senderPubkey = event.pubkey
      } else {
        // Rumor (encrypted DM) - pubkey not directly available
        // For now, leave undefined (could be enhanced with chat context)
        senderPubkey = undefined
      }

      // Extract message from token memo field or event content (fallback)
      let message: string | undefined = memo // Use memo from token

      // Fallback: extract from event content if memo is empty
      if (!message && event?.content) {
        const tokenMatch = event.content.match(/cashu[A-Za-z0-9_-]{20,}/)
        if (tokenMatch) {
          const afterToken = event.content
            .slice(tokenMatch.index! + tokenMatch[0].length)
            .trim()
          if (afterToken) {
            message = afterToken.slice(0, 200) // Limit to 200 chars
          }
        }
      }

      await savePaymentMetadata(
        trimmedToken,
        "dm",
        undefined,
        undefined,
        message,
        undefined,
        senderPubkey
      )

      // Add mint if not already known (allow redeeming from unknown mints)
      if (mintUrl) {
        const isKnown = await manager.mint.isKnownMint(mintUrl)
        if (!isKnown) {
          log("➕ Adding unknown mint before redeeming:", mintUrl)
          await manager.mint.addMint(mintUrl)
        }
      }

      await manager.wallet.receive(trimmedToken)

      // Force balance refresh to update UI immediately
      const {useWalletStore} = await import("@/stores/wallet")
      const updatedBalances = await manager.wallet.getBalances()
      const newTotalBalance = Object.values(updatedBalances).reduce(
        (sum, val) => sum + val,
        0
      )
      useWalletStore.getState().setBalance(newTotalBalance)

      setRedeemed(true)
      setLastCheckStatus(null) // Clear status display after redeeming
    } catch (caughtError) {
      error("Failed to redeem token:", caughtError)
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to redeem"
      )
    } finally {
      setRedeeming(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(match)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCheckStatus = async () => {
    setChecking(true)
    setErrorMessage("")
    try {
      const {getCashuManager} = await import("@/lib/cashu/manager")
      const manager = getCashuManager()

      if (!manager) {
        setErrorMessage("Wallet not initialized")
        return
      }

      const trimmedToken = match.trim()
      const {getDecodedToken} = await import("@cashu/cashu-ts")
      const decoded = getDecodedToken(trimmedToken)

      // Extract all proofs from token
      const proofs: Proof[] = []
      if (decoded.proofs && Array.isArray(decoded.proofs)) {
        proofs.push(...decoded.proofs)
      } else if (decoded.token && Array.isArray(decoded.token)) {
        for (const tokenEntry of decoded.token) {
          if (tokenEntry.proofs && Array.isArray(tokenEntry.proofs)) {
            proofs.push(...tokenEntry.proofs)
          }
        }
      }

      if (proofs.length === 0) {
        setErrorMessage("No proofs found in token")
        return
      }

      // Get cashu-ts wallet instance directly to check states
      const mintUrl = decoded.mint
      const {CashuMint} = await import("@cashu/cashu-ts")
      const mint = new CashuMint(mintUrl)

      // Import wallet keys from manager
      const mintKeys = await mint.getKeys()
      const {CashuWallet} = await import("@cashu/cashu-ts")
      const tempWallet = new CashuWallet(mint, {keys: mintKeys.keysets})

      const states = await tempWallet.checkProofsStates(proofs)

      // Check if any proof is spent
      const anySpent = states.some((state) => state.state === "SPENT")
      setTokenSpent(anySpent)
      setLastCheckStatus(anySpent ? "SPENT" : "UNSPENT")

      if (anySpent) {
        // Update metadata if we haven't already recorded redemption
        const {getPaymentMetadata, savePaymentMetadata} =
          await import("@/stores/paymentMetadata")
        const metadata = await getPaymentMetadata(trimmedToken)
        if (!metadata?.sender) {
          // Token was spent but we don't have receive metadata
          // This means someone else redeemed it
          await savePaymentMetadata(
            trimmedToken,
            "dm",
            undefined,
            undefined,
            memo,
            undefined,
            undefined // no sender = redeemed by someone else
          )
        }
        setRedeemed(true)
      }
    } catch (caughtError) {
      error("Failed to check token status:", caughtError)
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to check status"
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="cashu-token-embed flex flex-col gap-3 p-4 bg-base-200 rounded-lg border border-base-300 my-2 sm:min-w-80">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <RiBitCoinFill className="w-10 h-10 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-base-content/70">
            {loading && "Decoding token..."}
            {errorMessage && <span className="text-error">{errorMessage}</span>}
            {amount !== null && !errorMessage ? (
              <>
                <div className="font-semibold text-base flex items-center gap-2">
                  {amount} bits
                  {p2pkLock && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal bg-base-300 px-2 py-0.5 rounded">
                      <RiLockLine className="w-3 h-3" />
                      P2PK
                    </span>
                  )}
                </div>
                <div className="text-xs text-base-content/60">
                  Ecash token
                  {redeemed && <span className="text-success"> • Redeemed</span>}
                  {!redeemed && (tokenSpent || lastCheckStatus === "SPENT") && (
                    <span className="text-success"> • Redeemed</span>
                  )}
                  {!redeemed && !tokenSpent && lastCheckStatus === "UNSPENT" && (
                    <span> • Not redeemed</span>
                  )}
                </div>
                {mintUrl && (
                  <div className="text-xs text-base-content/60 mt-1">
                    {mintUrl.replace(/^https?:\/\//, "")}
                  </div>
                )}
                {memo && <span className="block text-xs mt-1 italic">{memo}</span>}
              </>
            ) : null}
            {p2pkLock && !canRedeem && !redeemed && (
              <span className="block text-xs text-warning mt-1">
                Locked to another key
              </span>
            )}
          </div>
        </div>
      </div>
      {isOwnEvent ? (
        <div className="flex flex-col gap-2">
          {!redeemed && !tokenSpent && (
            <button
              onClick={handleCheckStatus}
              className="btn btn-primary btn-sm w-full"
              disabled={checking}
            >
              {checking ? "Checking..." : "Check Status"}
            </button>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={handleCopy}
              className="text-xs text-base-content/50 hover:text-base-content/70 underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {canRedeem && (
              <button
                onClick={handleRedeem}
                className="text-xs text-base-content/50 hover:text-base-content/70 underline"
                disabled={
                  loading || !!errorMessage || redeeming || redeemed || tokenSpent
                }
              >
                {redeeming && "Redeeming..."}
                {!redeeming && redeemed && "Redeemed"}
                {!redeeming && !redeemed && "Redeem"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="btn btn-ghost btn-sm flex-1"
            disabled={loading || redeemed}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          {canRedeem ? (
            <button
              onClick={handleRedeem}
              className="btn btn-primary btn-sm flex-1"
              disabled={loading || !!errorMessage || redeeming || redeemed}
            >
              {redeeming ? "Redeeming..." : "Redeem"}
            </button>
          ) : (
            <button
              className="btn btn-disabled btn-sm flex-1"
              disabled
              title="Token is locked to a different public key"
            >
              Locked
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const CashuToken: Embed = {
  regex: /(?<![/.])(?:^|\s)(cashu[A-Za-z0-9_-]{20,})(?:\s|$)/gi,
  component: CashuTokenComponent,
  settingsKey: "cashu",
}

export default CashuToken
