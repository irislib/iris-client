import {NostrEvent} from "nostr-tools"
// import {useWebLNProvider} from "@/shared/hooks/useWebLNProvider" // Temporarily disabled
import {useOnlineStatus} from "@/shared/hooks/useOnlineStatus"
import {RefObject, useEffect, useState, useRef} from "react"
import useProfile from "@/shared/hooks/useProfile.ts"
import {getZappingUser} from "@/utils/nostr.ts"
import {LRUCache} from "typescript-lru-cache"
import {formatAmount} from "@/utils/utils.ts"
import {decode} from "light-bolt11-decoder"
import {usePublicKey} from "@/stores/user"
import {useZapStore} from "@/stores/zap"
import Icon from "../../Icons/Icon.tsx"
import ZapModal from "../ZapModal.tsx"
import debounce from "lodash/debounce"
import {subscribe} from "@/utils/applesauce"
import {getTagValue} from "@/utils/nostr"
import {useSettingsStore} from "@/stores/settings"

const zapsByEventCache = new LRUCache<string, Map<string, NostrEvent[]>>({
  maxSize: 100,
})

interface FeedItemZapProps {
  event: NostrEvent
  feedItemRef: RefObject<HTMLDivElement | null>
}

function FeedItemZap({event, feedItemRef}: FeedItemZapProps) {
  const {content} = useSettingsStore()
  const myPubKey = usePublicKey()
  const {defaultZapAmount} = useZapStore()
  // Temporarily disabled for NDK migration
  // const [isZapping, setIsZapping] = useState(false)
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [isLongPress, setIsLongPress] = useState(false)
  // const provider = useWebLNProvider()

  const profile = useProfile(event.pubkey)

  const [showZapModal, setShowZapModal] = useState(false)

  const [zapsByAuthor, setZapsByAuthor] = useState<Map<string, NostrEvent[]>>(
    zapsByEventCache.get(event.id) || new Map()
  )

  const canQuickZap = !!defaultZapAmount

  const calculateZappedAmount = async (
    zaps: Map<string, NostrEvent[]>
  ): Promise<number> => {
    return Array.from(zaps.values())
      .flat()
      .reduce((sum, zap) => {
        const invoice = getTagValue(zap, "bolt11")
        if (invoice) {
          const decodedInvoice = decode(invoice)
          const amountSection = decodedInvoice.sections.find(
            (section) => section.name === "amount"
          )
          if (amountSection && "value" in amountSection) {
            return sum + Math.floor(parseInt(amountSection.value) / 1000)
          }
        }
        return sum
      }, 0)
  }

  const [zappedAmount, setZappedAmount] = useState<number>(0)

  const flashElement = () => {
    if (feedItemRef.current) {
      // Quick flash in
      feedItemRef.current.style.transition = "background-color 0.05s ease-in"
      feedItemRef.current.style.backgroundColor = "rgba(234, 88, 12, 0.3)" // slightly more intense orange
      setTimeout(() => {
        if (feedItemRef.current) {
          // Slower fade out
          feedItemRef.current.style.transition = "background-color 1.5s ease-out"
          feedItemRef.current.style.backgroundColor = ""
        }
      }, 800) // Let it linger a bit longer
    }
  }

  const handleZapClick = async () => {
    if (canQuickZap) {
      await handleOneClickZap()
    } else {
      setShowZapModal(true)
    }
  }

  const handleOneClickZap = async () => {
    console.warn("Zapping functionality temporarily disabled - NDK replacement needed")
    // TODO: Implement zapping with applesauce
    /*
    try {
      setIsZapping(true)
      flashElement()
      const amount = Number(defaultZapAmount) * 1000

      // NDK-specific code temporarily removed
      // const lnPay: LnPayCb = async ({
      //   pr,
      // }): Promise<NDKPaymentConfirmationLN | undefined> => {
      //   if (provider) {
      //     await provider.sendPayment(pr)
      //     setShowZapModal(false)
      //     return {preimage: ""} // TODO: Get actual preimage from provider
      //   }
      //   return undefined
      // }

      // const zapper = new NDKZapper(event, amount, "msat", {
      //   comment: "",
      //   ndk: ndk(),
      //   lnPay,
      //   tags: [["e", event.id]],
      // })

      // await zapper.zap()
    } catch (error) {
      console.warn("Unable to one-click zap:", error)
    } finally {
      setIsZapping(false)
    }
    */
  }

  const handleMouseDown = () => {
    setIsLongPress(false)
    longPressTimeout.current = setTimeout(() => {
      setIsLongPress(true)
      setShowZapModal(true)
    }, 500)
  }

  const handleMouseUp = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current)
    }
  }

  const handleClick = () => {
    if (!isLongPress) {
      handleZapClick()
    }
  }

  useEffect(() => {
    if (!content.showReactionCounts) return

    const filter = {
      kinds: [9735],
      ["#e"]: [event.id],
    }

    try {
      const sub = subscribe(filter)
      const debouncedUpdateAmount = debounce(async (zapsByAuthor) => {
        const amount = await calculateZappedAmount(zapsByAuthor)
        setZappedAmount(amount)
      }, 300)

      sub?.on("event", async (zapEvent: NostrEvent) => {
        // if (shouldHideEvent(zapEvent)) return // blah. disabling this check enables fake receipts but what can we do
        const invoice = getTagValue(zapEvent, "bolt11")
        if (invoice) {
          const decodedInvoice = decode(invoice)
          const amountSection = decodedInvoice.sections.find(
            (section) => section.name === "amount"
          )
          if (amountSection && "value" in amountSection) {
            setZapsByAuthor((prev) => {
              const zappingUser = getZappingUser(zapEvent)
              const newMap = new Map(prev)
              const authorZaps = newMap.get(zappingUser) ?? []
              if (!authorZaps.some((e) => e.id === zapEvent.id)) {
                authorZaps.push(zapEvent)
              }
              newMap.set(zappingUser, authorZaps)
              zapsByEventCache.set(event.id, newMap)
              debouncedUpdateAmount(newMap)
              return newMap
            })
          }
        }
      })

      return () => {
        debouncedUpdateAmount.cancel()
        sub.stop()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [content.showReactionCounts])

  useEffect(() => {
    calculateZappedAmount(zapsByAuthor).then(setZappedAmount)
  }, [])

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
          onClose={() => setShowZapModal(false)}
          event={event}
          setZapped={() => {
            flashElement()
          }}
        />
      )}
      <button
        title="Zap"
        className={`${
          zapped ? "cursor-pointer text-accent" : "cursor-pointer hover:text-accent"
        } flex flex-row items-center gap-1 transition duration-200 ease-in-out min-w-[50px] md:min-w-[80px]`}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
      >
        {false ? ( // isZapping temporarily disabled
          <div className="loading loading-spinner loading-xs" />
        ) : (
          <Icon name={iconName} size={16} />
        )}
        <span>{content.showReactionCounts ? formatAmount(zappedAmount) : ""}</span>
      </button>
    </>
  )
}

export default FeedItemZap
