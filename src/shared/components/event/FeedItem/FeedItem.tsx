import {eventsByIdCache} from "@/utils/memcache.ts"
import {useEffect, useMemo, useState, useRef, memo} from "react"
import {NDKEvent, NDKSubscription} from "@nostr-dev-kit/ndk"
import classNames from "classnames"

import {
  getEventReplyingTo,
  getEventRoot,
  isRepost,
  getZappingUser,
} from "@/utils/nostr.ts"
import {getEventIdHex, handleEventContent} from "@/shared/components/event/utils.ts"
import RepostHeader from "@/shared/components/event/RepostHeader.tsx"
import FeedItemActions from "../reactions/FeedItemActions.tsx"
import ZapsBar from "../reactions/ZapsBar.tsx"
import ReactionsBar from "../reactions/ReactionsBar.tsx"
import {useSettingsStore} from "@/stores/settings"
import FeedItemPlaceholder from "./FeedItemPlaceholder.tsx"
import ErrorBoundary from "../../ui/ErrorBoundary.tsx"
import Feed from "@/shared/components/feed/Feed.tsx"
import FeedItemContent from "./FeedItemContent.tsx"
import {onClick, TRUNCATE_LENGTH} from "./utils.ts"
import FeedItemHeader from "./FeedItemHeader.tsx"
import FeedItemTitle from "./FeedItemTitle.tsx"
import {GeohashLocation} from "./GeohashLocation.tsx"
import {ExpirationDisplay} from "./ExpirationDisplay.tsx"
import {Link, useNavigate} from "@/navigation"
import LikeHeader from "../LikeHeader"
import ZapReceiptHeader from "../ZapReceiptHeader"
import ReplyHeader from "../ReplyHeader"
import {nip19} from "nostr-tools"
import {ndk} from "@/utils/ndk"
import {KIND_TEXT_NOTE, KIND_REACTION, KIND_ZAP_RECEIPT} from "@/utils/constants"
import InlineNoteCreator from "@/shared/components/create/InlineNoteCreator"
import {usePublicKey} from "@/stores/user"

type FeedItemProps = {
  event?: NDKEvent
  eventId?: string
  authorHints?: string[]
  truncate?: number
  standalone?: boolean
  showReplies?: number
  showRepliedTo?: boolean
  showActions?: boolean
  asEmbed?: boolean
  asRepliedTo?: boolean
  asReply?: boolean
  onEvent?: (event: NDKEvent) => void
  borderTop?: boolean
  highlightAsNew?: boolean
}

function FeedItem({
  event: initialEvent,
  eventId,
  authorHints,
  standalone,
  showReplies = 0,
  truncate = standalone ? 0 : TRUNCATE_LENGTH,
  showRepliedTo = standalone,
  showActions = true,
  asEmbed = false,
  asRepliedTo = false,
  asReply = false,
  onEvent,
  borderTop,
  highlightAsNew = false,
}: FeedItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [hasActualReplies, setHasActualReplies] = useState(false)
  const navigate = useNavigate()
  const subscriptionRef = useRef<NDKSubscription | null>(null)
  const {content} = useSettingsStore()
  const myPubKey = usePublicKey()

  // Handle highlight animation with lightning-like flash
  useEffect(() => {
    if (highlightAsNew && feedItemRef.current) {
      // Quick flash in (lightning-like)
      feedItemRef.current.style.transition = "background-color 0.05s ease-in"
      feedItemRef.current.style.backgroundColor = "rgba(59, 130, 246, 0.15)" // more transparent blue flash

      setTimeout(() => {
        if (feedItemRef.current) {
          // Slower fade out
          feedItemRef.current.style.transition = "background-color 1.5s ease-out"
          feedItemRef.current.style.backgroundColor = ""
        }
      }, 200)
    }
  }, [highlightAsNew])

  if ((!initialEvent || !initialEvent.id) && !eventId) {
    throw new Error(
      `FeedItem requires either an event or an eventId. Debug info: ${JSON.stringify(
        {
          hasInitialEvent: !!initialEvent,
          initialEventType: initialEvent?.constructor?.name,
          initialEventKeys: initialEvent ? Object.keys(initialEvent) : [],
          eventId,
          eventIdType: typeof eventId,
          eventIdValue: initialEvent?.id,
          eventKind: initialEvent?.kind,
          eventContent: initialEvent?.content,
          eventTags: initialEvent?.tags,
        },
        null,
        2
      )}`
    )
  }

  const eventIdHex = useMemo(() => {
    return getEventIdHex(initialEvent || eventId)
  }, [initialEvent, eventId])

  const [event, setEvent] = useState<NDKEvent | undefined>(initialEvent)
  const [loadingEvent, setLoadingEvent] = useState<boolean>(!initialEvent && !!eventId)
  const [referredEvent, setReferredEvent] = useState<NDKEvent | undefined>()

  const repliedToEventId = useMemo(() => event && getEventReplyingTo(event), [event])
  const rootId = useMemo(() => event && getEventRoot(event), [event])
  const showThreadRoot =
    standalone && rootId && rootId !== eventIdHex && rootId !== repliedToEventId

  const feedItemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (event) {
      onEvent?.(event)
    }
  }, [event, onEvent])

  useEffect(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.stop()
      subscriptionRef.current = null
    }

    if (!event && eventIdHex) {
      const cached = eventsByIdCache.get(eventIdHex)
      if (cached) {
        setEvent(cached)
        setLoadingEvent(false)
      } else {
        const sub = ndk().subscribe(
          {ids: [eventIdHex], authors: authorHints},
          {closeOnEose: true}
        )
        subscriptionRef.current = sub

        sub.on("event", (fetchedEvent: NDKEvent) => {
          if (fetchedEvent && fetchedEvent.id) {
            setEvent(fetchedEvent)
            setLoadingEvent(false)
            eventsByIdCache.set(eventIdHex, fetchedEvent)
          }
        })
      }
    } else {
      setLoadingEvent(false)
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.stop()
        subscriptionRef.current = null
      }
    }
  }, [event, eventIdHex, authorHints])

  useEffect(() => {
    if (event) {
      const cleanup = handleEventContent(event, (referred) => {
        setReferredEvent(referred)
        if (eventIdHex) eventsByIdCache.set(eventIdHex, referred)
      })

      return cleanup
    }
  }, [event, eventIdHex])

  const wrapperClasses = classNames("relative max-w-[100vw]", {
    "h-[200px] overflow-hidden": asEmbed && !expanded,
  })

  const expandOverlay = asEmbed && !expanded && (
    <>
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-base-100 to-transparent" />
      <button
        className="absolute bottom-2 left-1/2 -translate-x-1/2 text-sm text-primary hover:underline"
        onClick={(e) => {
          e.stopPropagation()
          setExpanded(true)
        }}
      >
        Show More
      </button>
    </>
  )

  if (!event && loadingEvent && eventIdHex) {
    return (
      <div className={wrapperClasses}>
        <FeedItemPlaceholder
          standalone={standalone}
          asEmbed={asEmbed}
          eventIdHex={eventIdHex}
          onClick={(e) => onClick(e, event, referredEvent, eventId, navigate)}
        />
        {expandOverlay}
      </div>
    )
  }

  if (!event) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-base-content/50">
        <div className="text-sm">Event not found</div>
      </div>
    )
  }

  // Hide zap receipts if we can't get the zapping user
  if (event.kind === KIND_ZAP_RECEIPT && !getZappingUser(event, false)) {
    return null
  }

  return (
    <ErrorBoundary>
      {showThreadRoot && (
        <div className="px-4 py-2 text-sm text-base-content/70">
          <Link
            to={`/${nip19.noteEncode(rootId)}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            View thread root →
          </Link>
        </div>
      )}
      {event.kind === KIND_TEXT_NOTE && showRepliedTo && repliedToEventId && (
        <>
          <FeedItem
            borderTop={borderTop}
            asRepliedTo={true}
            eventId={repliedToEventId}
            truncate={truncate}
            onEvent={onEvent}
          />
        </>
      )}
      <div className={wrapperClasses}>
        <div
          ref={feedItemRef}
          className={classNames(
            "flex flex-col border-custom pt-3 pb-0 transition-colors duration-200 ease-in-out relative",
            {
              "cursor-pointer": !standalone,
              "border-b": !asRepliedTo && !asEmbed && !(asReply && hasActualReplies),
              "border-t":
                !asReply &&
                borderTop &&
                (asRepliedTo || !(showRepliedTo && repliedToEventId)),
              "border pt-3 pb-3 my-2 rounded": asEmbed,
              "hover:bg-[var(--note-hover-color)]": !standalone,
            }
          )}
          data-testid="feed-item"
          data-event-id={event.id}
          onClick={(e) =>
            !standalone && onClick(e, event, referredEvent, eventId, navigate)
          }
        >
          {asRepliedTo && (
            <div className="h-full w-0.5 bg-base-300 absolute top-12 left-9" />
          )}
          {asReply && hasActualReplies && (
            <div className="h-full w-0.5 bg-base-300 absolute top-12 left-9" />
          )}
          {isRepost(event) && (
            <div className="flex flex-row select-none mb-2 px-4">
              <RepostHeader event={event} />
            </div>
          )}
          {event.kind === KIND_REACTION && (
            <div className="flex flex-row select-none mb-2 px-4">
              <LikeHeader event={event} />
            </div>
          )}
          {event.kind === KIND_ZAP_RECEIPT && referredEvent && (
            <div className="flex flex-row select-none mb-2 px-4">
              <ZapReceiptHeader event={event} />
            </div>
          )}
          {event.kind === KIND_TEXT_NOTE &&
            !standalone &&
            !asReply &&
            repliedToEventId &&
            !(showRepliedTo && repliedToEventId) && (
              <div className="flex flex-row select-none mb-2 px-4">
                <ReplyHeader repliedToEventId={repliedToEventId} />
              </div>
            )}
          <div className={classNames("flex-1 w-full", {"text-lg": standalone})}>
            <FeedItemHeader
              event={event}
              referredEvent={referredEvent}
              tight={asReply || asRepliedTo}
            />
            {(() => {
              const targetEvent = referredEvent || event
              const hasGeohash = targetEvent.tags.some((tag) => tag[0] === "g" && tag[1])
              const hasLocation = targetEvent.tags.some(
                (tag) => tag[0] === "location" && tag[1]
              )
              const hasExpiration = targetEvent.tags.some(
                (tag) => tag[0] === "expiration" && tag[1]
              )

              if (!hasGeohash && !hasLocation && !hasExpiration) return null

              return (
                <div
                  className={classNames(
                    "flex items-center justify-between px-4 -mt-1 mb-2",
                    {
                      "pl-16": asReply || asRepliedTo,
                    }
                  )}
                >
                  {hasGeohash || hasLocation ? (
                    <GeohashLocation event={targetEvent} className="" />
                  ) : (
                    <div />
                  )}
                  <ExpirationDisplay event={targetEvent} className="" />
                </div>
              )
            })()}
            <div className={classNames({"pl-12": asReply || asRepliedTo})}>
              <FeedItemContent
                event={event}
                referredEvent={referredEvent}
                standalone={standalone}
                truncate={truncate}
              />
            </div>
          </div>
          <div
            className={classNames("px-4", {
              "pl-14": asRepliedTo || asReply,
            })}
          >
            {showActions &&
              ((event.kind !== KIND_REACTION &&
                event.kind !== KIND_ZAP_RECEIPT &&
                !isRepost(event)) ||
                referredEvent) && (
                <>
                  {standalone && content.showReactionsBar && (
                    <>
                      {content.showZaps && !content.hideZapsBarInStandalone && (
                        <ZapsBar event={referredEvent || event} />
                      )}
                      {content.showLikes && !content.hideReactionsBarInStandalone && (
                        <ReactionsBar event={referredEvent || event} />
                      )}
                    </>
                  )}
                  <FeedItemActions
                    feedItemRef={feedItemRef}
                    event={referredEvent ? undefined : event}
                    eventId={referredEvent?.id}
                    standalone={standalone}
                  />
                </>
              )}
          </div>
        </div>
        {expandOverlay}
      </div>
      {showReplies > 0 && (eventId || event?.id) && (
        <div className="flex flex-col justify-center">
          {standalone && myPubKey && event && (
            <InlineNoteCreator repliedEvent={event} placeholder="Reply to this post..." />
          )}
          <Feed
            asReply={true}
            feedConfig={{
              name: "Replies",
              id: `replies-${event.id}`,
              repliesTo: event.id,
              sortType: "followDistance",
              showRepliedTo: false,
              filter: {kinds: [KIND_TEXT_NOTE], "#e": eventIdHex ? [eventIdHex] : []},
              followDistance:
                useSettingsStore.getState().content.maxFollowDistanceForReplies,
            }}
            onEvent={(e) => {
              onEvent?.(e)
              setHasActualReplies(true)
            }}
            borderTopFirst={false}
            emptyPlaceholder={null}
            showReplies={showReplies}
            showDisplayAsSelector={false}
            displayAs="list"
          />
          <FeedItemTitle event={event} />
        </div>
      )}
    </ErrorBoundary>
  )
}

export default memo(FeedItem)
