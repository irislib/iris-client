import {LnPayCb, NDKEvent, NDKZapper, NDKPaymentConfirmationLN} from "@nostr-dev-kit/ndk"
import {sharedSubscriptionManager} from "@/utils/sharedSubscriptions"
import {useWebLNProvider} from "@/shared/hooks/useWebLNProvider"
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
import {ndk} from "@/utils/ndk"

const zapsByEventCache = new LRUCache<string, Map<string, NDKEvent[]>>({
  maxSize: 100,
})

interface FeedItemZapProps {
  event: NDKEvent
  feedItemRef: RefObject<HTMLDivElement | null>
}

function FeedItemZap({event, feedItemRef}: FeedItemZapProps) {
  const myPubKey = usePublicKey()
  const {defaultZapAmount} = useZapStore()
  const [isZapping, setIsZapping] = useState(false)
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [isLongPress, setIsLongPress] = useState(false)
  const provider = useWebLNProvider()

  const profile = useProfile(event.pubkey)

  const [showZapModal, setShowZapModal] = useState(false)

  const [zapsByAuthor, setZapsByAuthor] = useState<Map<string, NDKEvent[]>>(
    zapsByEventCache.get(event.id) || new Map()
  )

  const canQuickZap = !!defaultZapAmount

  const calculateZappedAmount = async (
    zaps: Map<string, NDKEvent[]>
  ): Promise<number> => {
    return Array.from(zaps.values())
      .flat()
      .reduce((sum, zap) => {
        const invoice = zap.tagValue("bolt11")
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
    try {
      setIsZapping(true)
      flashElement()
      const amount = Number(defaultZapAmount) * 1000

      const lnPay: LnPayCb = async ({
        pr,
      }): Promise<NDKPaymentConfirmationLN | undefined> => {
        if (provider) {
          await provider.sendPayment(pr)
          setShowZapModal(false)
          return {preimage: ""} // TODO: Get actual preimage from provider
        }
        return undefined
      }

      const zapper = new NDKZapper(event, amount, "msat", {
        comment: "",
        ndk: ndk(),
        lnPay,
        tags: [["e", event.id]],
      })

      await zapper.zap()
    } catch (error) {
      console.warn("Unable to one-click zap:", error)
    } finally {
      setIsZapping(false)
    }
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
    const filter = {
      kinds: [9735],
      ["#e"]: [event.id],
    }

    try {
      const debouncedUpdateAmount = debounce(async (zapsByAuthor) => {
        const amount = await calculateZappedAmount(zapsByAuthor)
        setZappedAmount(amount)
      }, 50)

      const unsubscribe = sharedSubscriptionManager.subscribe(
        filter,
        async (zapEvent: NDKEvent) => {
          const invoice = zapEvent.tagValue("bolt11")
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
        }
      )

      return () => {
        debouncedUpdateAmount.cancel()
        unsubscribe()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [])

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
        {isZapping ? (
          <div className="loading loading-spinner loading-xs" />
        ) : (
          <Icon name={iconName} size={16} />
        )}
        <span>{formatAmount(zappedAmount)}</span>
      </button>
    </>
  )
}

export default FeedItemZap
