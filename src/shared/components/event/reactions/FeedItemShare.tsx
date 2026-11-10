import {useId, useRef} from "react"
import {nip19} from "nostr-tools"
import {RiLink, RiShareForwardFill} from "@remixicon/react"
import {AppEvent} from "@/lib/nostr"
import {useToastStore} from "@/stores/toast"

const FeedItemShare = ({event}: {event: AppEvent}) => {
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const url = `https://iris.to/${nip19.noteEncode(event.id)}`
  const canShare =
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({url}))
  const toast = useToastStore.getState().addToast

  async function copyLink() {
    menu.current?.hidePopover()
    try {
      await navigator.clipboard.writeText(url)
      toast("Link copied", "success")
    } catch {
      window.prompt("Copy post link", url)
    }
  }
  async function shareVia() {
    menu.current?.hidePopover()
    try {
      await navigator.share({url})
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      toast("Could not share this post", "error")
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="shareButton cursor-pointer hover:text-info"
        title="Share"
        aria-label="Share"
        popoverTarget={canShare ? menuId : undefined}
        onClick={canShare ? undefined : copyLink}
      >
        <RiShareForwardFill size={18} />
      </button>
      {canShare && (
        <div
          id={menuId}
          ref={menu}
          popover="auto"
          role="group"
          aria-label="Share post"
          className="fixed inset-auto m-0 rounded-box bg-base-100 text-base-content shadow-lg"
          onToggle={(e) => {
            if (e.newState !== "open" || !trigger.current) return
            const panel = e.currentTarget
            const bounds = trigger.current.getBoundingClientRect()
            panel.style.left =
              Math.max(8, Math.min(bounds.left, innerWidth - panel.offsetWidth - 8)) +
              "px"
            const below = bounds.bottom + 6
            panel.style.top =
              (below + panel.offsetHeight <= innerHeight - 8
                ? below
                : Math.max(8, bounds.top - panel.offsetHeight - 6)) + "px"
            panel.querySelector("button")?.focus({preventScroll: true})
          }}
        >
          <ul className="menu w-40 p-1">
            <li>
              <button type="button" onClick={copyLink}>
                <RiLink size={16} />
                Copy link
              </button>
            </li>
            <li>
              <button type="button" onClick={shareVia}>
                <RiShareForwardFill size={16} />
                Share via…
              </button>
            </li>
          </ul>
        </div>
      )}
    </>
  )
}

export default FeedItemShare
