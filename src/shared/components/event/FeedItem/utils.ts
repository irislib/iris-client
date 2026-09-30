import {AppEvent} from "@/lib/nostr"
import {useNavigate} from "@/navigation"
import {nip19} from "nostr-tools"
import {MouseEvent} from "react"
import {KIND_WALLET_CONNECT, KIND_APP_DATA} from "@/utils/constants"

export const TRUNCATE_LENGTH = 300

export const isTextSelected = () => {
  const selection = window.getSelection()
  return selection && selection.toString().length > 0
}

export function onClick(
  e: MouseEvent<HTMLDivElement>,
  event: AppEvent | undefined,
  ReferredEvent: AppEvent | undefined,
  eventId: string | undefined,
  navigate: ReturnType<typeof useNavigate>
) {
  if (
    event?.kind === KIND_WALLET_CONNECT ||
    event?.kind === KIND_APP_DATA ||
    e.target instanceof HTMLAnchorElement ||
    e.target instanceof HTMLImageElement ||
    e.target instanceof HTMLVideoElement ||
    (e.target instanceof HTMLElement && e.target.closest("a")) ||
    (e.target instanceof HTMLElement && e.target.closest("button")) ||
    isTextSelected()
  ) {
    return
  }
  navigate(`/${nip19.noteEncode(ReferredEvent?.id || eventId || event!.id)}`)
  e.stopPropagation()
}
