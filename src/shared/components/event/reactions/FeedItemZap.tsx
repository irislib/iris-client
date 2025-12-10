import {NDKEvent} from "@/lib/ndk"
import {useWalletProviderStore} from "@/stores/walletProvider"
import {useOnlineStatus} from "@/shared/hooks/useOnlineStatus"
import {MouseEvent, RefObject, useEffect, useState} from "react"
import useProfile from "@/shared/hooks/useProfile.ts"
import {parseZapReceipt, calculateTotalZapAmount, type ZapInfo} from "@/utils/nostr.ts"
import {LRUCache} from "typescript-lru-cache"
import {formatAmount} from "@/utils/utils.ts"
import {usePublicKey, useUserStore} from "@/stores/user"
import {useScrollAwareLongPress} from "@/shared/hooks/useScrollAwareLongPress"
import Icon from "../../Icons/Icon.tsx"
import ZapModal from "../ZapModal"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"
import {KIND_ZAP_RECEIPT} from "@/utils/constants"

const zapsByEventCache = new LRUCache<string, Map<string, ZapInfo[]>>({
  maxSize: 100,
})

interface FeedItemZapProps {
  event: NDKEvent
  feedItemRef: RefObject<HTMLDivElement | null>
  showReactionCounts?: boolean
}

function FeedItemZap({event, feedItemRef, showReactionCounts = true}: FeedItemZapProps) {
  const myPubKey = usePublicKey()
  const {
    defaultZapAmount,
    defaultZapComment,
    zapDonationEnabled,
    zapDonationRecipients,
    zapDonationMinAmount,
  } = useUserStore()
  const {activeProviderType, sendPayment: walletProviderSendPayment} =
    useWalletProviderStore()
  const {
    handleMouseDown: handleLongPressDown,
    handleMouseMove: handleLongPressMove,
    handleMouseUp: handleLongPressUp,
    isLongPress,
  } = useScrollAwareLongPress({
    onLongPress: () => setShowZapModal(true),
  })

  const profile = useProfile(event.pubkey)

  const [showZapModal, setShowZapModal] = useState(false)
  const [failedInvoice, setFailedInvoice] = useState<string>("")

  const [zapsByAuthor, setZapsByAuthor] = useState<Map<string, ZapInfo[]>>(
    zapsByEventCache.get(event.id) || new Map()
  )

  // Quick zap is only enabled if there's a default zap amount AND a wallet is available
  const hasWallet = activeProviderType !== "disabled" && activeProviderType !== undefined
  const canQuickZap = !!defaultZapAmount && defaultZapAmount > 0 && hasWallet

  const calculateZappedAmount = async (zaps: Map<string, ZapInfo[]>): Promise<number> => {
    const total = calculateTotalZapAmount(zaps)
    return total
  }

  const [zappedAmount, setZappedAmount] = useState<number>(0)

  const flashElement = () => {
    if (!feedItemRef.current) return

    const element = feedItemRef.current

    // Reset to baseline (use setProperty with !important to override hover states)
    element.style.setProperty("transition", "none", "important")
    element.style.setProperty("background-color", "transparent", "important")

    requestAnimationFrame(() => {
      // Set transition for fade in
      element.style.setProperty(
        "transition",
        "background-color 0.05s ease-in",
        "important"
      )

      requestAnimationFrame(() => {
        // Apply orange color
        element.style.setProperty(
          "background-color",
          "rgba(234, 88, 12, 0.3)",
          "important"
        )

        // After delay, fade out
        setTimeout(() => {
          if (feedItemRef.current) {
            element.style.setProperty(
              "transition",
              "background-color 1.5s ease-out",
              "important"
            )
            element.style.setProperty("background-color", "transparent", "important")

            // Restore original styles after fade completes
            setTimeout(() => {
              if (feedItemRef.current) {
                element.style.removeProperty("transition")
                element.style.removeProperty("background-color")
              }
            }, 1500)
          }
        }, 800)
      })
    })
  }

  const handleZapClick = async () => {
    if (canQuickZap) {
      await handleOneClickZap()
    } else {
      // Clear any previous failed state when opening modal normally
      setFailedInvoice("")
      setShowZapModal(true)
    }
  }

  const handleOneClickZap = async () => {
    const amount = Number(defaultZapAmount) * 1000

    // Check if profile has lightning address
    if (!profile?.lud16 && !profile?.lud06) {
      console.warn("Quick zap: No lightning address found")
      setShowZapModal(true)
      return
    }

    const ndkInstance = ndk()
    const signer = ndkInstance.signer
    if (!signer) {
      console.warn("Quick zap: No signer available")
      setShowZapModal(true)
      return
    }

    // Optimistic update: immediately add zap and flash
    const optimisticZapId = `optimistic-${Date.now()}`
    const optimisticZap: ZapInfo = {
      id: optimisticZapId,
      amount: amount / 1000, // Store in sats
      pubkey: myPubKey || "",
      comment: defaultZapComment || "",
      event: event as NDKEvent,
    }

    setZapsByAuthor((prev) => {
      const newMap = new Map(prev)
      const myZaps = newMap.get(myPubKey || "") || []
      newMap.set(myPubKey || "", [...myZaps, optimisticZap])
      zapsByEventCache.set(event.id, newMap)
      // Immediately update amount display
      const newTotal = calculateTotalZapAmount(newMap)
      setZappedAmount(newTotal)
      return newMap
    })

    // Flash immediately
    flashElement()

    // Fire off payment in background
    ;(async () => {
      try {
        // Use the shared function that publishes the zap request
        const {createAndPublishZapInvoice} = await import("@/utils/nostr")
        const invoice = await createAndPublishZapInvoice(
          event,
          amount,
          defaultZapComment || "",
          profile.lud16 || profile.lud06!,
          signer
        )

        // Update optimistic zap with invoice for deduplication
        setZapsByAuthor((prev) => {
          const newMap = new Map(prev)
          const myZaps = newMap.get(myPubKey || "") || []
          const updatedZaps = myZaps.map((z) =>
            z.id === optimisticZapId ? {...z, bolt11: invoice} : z
          )
          newMap.set(myPubKey || "", updatedZaps)
          zapsByEventCache.set(event.id, newMap)
          return newMap
        })

        // Save zap metadata before payment
        if (hasWallet) {
          try {
            const {savePaymentMetadata} = await import("@/stores/paymentMetadata")
            await savePaymentMetadata(invoice, "zap", event.pubkey, event.id)
          } catch (err) {
            console.warn("Failed to save quick zap metadata:", err)
          }
        }

        // Try to pay with wallet
        await walletProviderSendPayment(invoice)
        // Payment succeeded - optimistic zap stays

        // Send donation zaps if enabled
        if (zapDonationEnabled && zapDonationRecipients.length > 0) {
          try {
            const {calculateMultiRecipientDonations, sendDonationZaps} = await import(
              "@/utils/nostr"
            )
            const donations = calculateMultiRecipientDonations(
              amount / 1000,
              zapDonationRecipients,
              zapDonationMinAmount
            )

            await sendDonationZaps(donations, signer, event, walletProviderSendPayment)
          } catch (donationError) {
            console.warn("Donation zaps failed (non-fatal):", donationError)
          }
        }
      } catch (error) {
        console.warn("Quick zap payment failed:", error)

        // Remove optimistic zap and revert amount
        setZapsByAuthor((prev) => {
          const newMap = new Map(prev)
          const myZaps = newMap.get(myPubKey || "") || []
          const filteredZaps = myZaps.filter((z) => z.id !== optimisticZapId)

          if (filteredZaps.length > 0) {
            newMap.set(myPubKey || "", filteredZaps)
          } else {
            newMap.delete(myPubKey || "") // Remove key if no zaps left
          }

          zapsByEventCache.set(event.id, newMap)
          // Revert amount display
          const newTotal = calculateTotalZapAmount(newMap)
          setZappedAmount(newTotal)
          return newMap
        })

        // Show error toast with link to event
        const {useToastStore} = await import("@/stores/toast")
        const {nip19} = await import("nostr-tools")
        const errorMsg = error instanceof Error ? error.message : "Payment failed"
        const noteId = nip19.noteEncode(event.id)
        const recipientName =
          profile?.name || profile?.displayName || event.pubkey.slice(0, 8)
        const message = `Zap to ${recipientName} (${amount / 1000} bits) failed. ${errorMsg}`
        useToastStore.getState().addToast(message, "error", 10000, `/${noteId}`)
      }
    })()
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!isLongPress) {
      e.currentTarget.blur()
      handleZapClick()
    }
  }

  useEffect(() => {
    if (!showReactionCounts) return

    const filter = {
      kinds: [KIND_ZAP_RECEIPT],
      ["#e"]: [event.id],
    }

    try {
      // Closed on eose because NDK will otherwise send too many concurrent REQs for all the feed item reaction subscriptions
      const sub = ndk().subscribe(filter, {closeOnEose: true})
      const debouncedUpdateAmount = debounce(async (zapsByAuthor) => {
        const amount = await calculateZappedAmount(zapsByAuthor)
        setZappedAmount(amount)
      }, 300)

      sub?.on("event", async (zapEvent: NDKEvent) => {
        // if (shouldHideEvent(zapEvent)) return // blah. disabling this check enables fake receipts but what can we do
        const zapInfo = parseZapReceipt(zapEvent)
        if (zapInfo) {
          setZapsByAuthor((prev) => {
            const newMap = new Map(prev)
            const authorZaps = newMap.get(zapInfo.pubkey) ?? []

            // Check for duplicates by event ID OR bolt11 (handles optimistic zaps)
            const isDuplicate = authorZaps.some(
              (e) =>
                e.id === zapEvent.id || (zapInfo.bolt11 && e.bolt11 === zapInfo.bolt11)
            )

            if (!isDuplicate) {
              authorZaps.push(zapInfo)
              newMap.set(zapInfo.pubkey, authorZaps)
              zapsByEventCache.set(event.id, newMap)
              debouncedUpdateAmount(newMap)
            }

            return newMap
          })
        }
      })

      return () => {
        debouncedUpdateAmount.cancel()
        sub.stop()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [showReactionCounts])

  useEffect(() => {
    calculateZappedAmount(zapsByAuthor).then((amount) => {
      setZappedAmount(amount)
    })
  }, [zapsByAuthor])

  const zapped = zapsByAuthor.has(myPubKey)

  const isOnline = useOnlineStatus()

  if (!(profile?.lud16 || profile?.lud06) || !isOnline) {
    return null
  }

  let iconName = ""
  if (canQuickZap) {
    iconName = "zapFast"
  } else if (zapped) {
    iconName = "zap-solid"
  } else {
    iconName = "zap"
  }

  return (
    <>
      {showZapModal && (
        <ZapModal
          onClose={() => {
            setShowZapModal(false)
            setFailedInvoice("")
          }}
          event={event}
          profile={profile}
          setZapped={() => {
            flashElement()
          }}
          initialInvoice={failedInvoice}
          initialAmount={failedInvoice ? defaultZapAmount.toString() : undefined}
          paymentFailed={!!failedInvoice}
        />
      )}
      <button
        title="Zap"
        className={`${
          zapped ? "cursor-pointer text-accent" : "cursor-pointer hover:text-accent"
        } flex flex-row items-center gap-1 transition duration-200 ease-in-out min-w-[50px] md:min-w-[80px]`}
        onClick={handleClick}
        onMouseDown={handleLongPressDown}
        onMouseMove={handleLongPressMove}
        onMouseUp={handleLongPressUp}
        onMouseLeave={handleLongPressUp}
        onTouchStart={handleLongPressDown}
        onTouchMove={handleLongPressMove}
        onTouchEnd={handleLongPressUp}
      >
        <Icon name={iconName} size={16} />
        <span>{showReactionCounts ? formatAmount(zappedAmount) : ""}</span>
      </button>
    </>
  )
}

export default FeedItemZap
