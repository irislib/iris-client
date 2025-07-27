import {RiArrowLeftSLine, RiArrowRightSLine} from "@remixicon/react"
import FeedItem from "../event/FeedItem/FeedItem"
import {NostrEvent} from "nostr-tools"
import {EmbedEvent} from "../embed/index"
import ProxyImg from "../ProxyImg"
import Icon from "../Icons/Icon"
import Modal from "../ui/Modal"

interface MediaModalProps {
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  mediaUrl: string
  mediaType: "image" | "video"
  showFeedItem?: boolean
  event?: EmbedEvent
  currentIndex?: number
  totalCount?: number
}

function isNostrEvent(event: EmbedEvent): event is NostrEvent {
  return event && typeof (event as NostrEvent).id !== "undefined"
}

function MediaModal({
  onClose,
  onPrev,
  onNext,
  mediaUrl,
  mediaType,
  showFeedItem,
  event,
  currentIndex,
  totalCount,
}: MediaModalProps) {
  return (
    <Modal hasBackground={false} onClose={onClose}>
      <div className="relative flex w-screen h-screen">
        <div className="flex-1 relative bg-base-200/90 select-none">
          <button
            className="btn btn-circle btn-ghost absolute right-2 top-2 focus:outline-none text-white z-10"
            onClick={onClose}
          >
            <Icon name="close" size={12} />
          </button>

          <div
            className="absolute inset-0 flex items-center justify-center"
            onClick={(e) => {
              console.log("MediaModal Clicked:", e.target === e.currentTarget)
              if (e.target === e.currentTarget) {
                onClose()
              }
            }}
          >
            {mediaType === "video" ? (
              <video
                loop
                autoPlay
                src={mediaUrl}
                controls
                className="max-w-full max-h-full"
              />
            ) : (
              <ProxyImg
                src={mediaUrl}
                className="max-w-full max-h-full object-contain"
                onClick={showFeedItem ? undefined : onClose}
                key={mediaUrl}
              />
            )}
          </div>

          {(onPrev || onNext) && (
            <>
              <div className="absolute top-1/2 -translate-y-1/2 left-4 z-10">
                <button
                  onClick={onPrev}
                  disabled={currentIndex === 0}
                  className="btn btn-circle btn-ghost text-white"
                >
                  <RiArrowLeftSLine size={24} />
                </button>
              </div>
              <div className="absolute top-1/2 -translate-y-1/2 right-4 z-10">
                <button
                  onClick={onNext}
                  disabled={currentIndex === (totalCount ?? 0) - 1}
                  className="btn btn-circle btn-ghost text-white"
                >
                  <RiArrowRightSLine size={24} />
                </button>
              </div>
            </>
          )}

          {currentIndex !== undefined && totalCount && (
            <div className="absolute top-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded z-10">
              {currentIndex + 1} / {totalCount}
            </div>
          )}
        </div>

        {showFeedItem && event && (
          <div className="w-[400px] bg-base-100 border-l flex-shrink-0 overflow-y-auto">
            <FeedItem
              key={isNostrEvent(event) ? event.id : undefined}
              event={isNostrEvent(event) ? event : undefined}
              asReply={false}
              showRepliedTo={true}
              showReplies={Infinity}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

export default MediaModal
