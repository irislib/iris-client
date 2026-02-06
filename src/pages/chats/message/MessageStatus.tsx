import {RiCheckDoubleLine, RiCheckLine} from "@remixicon/react"
import type {ReceiptType} from "nostr-double-ratchet/src"
import classNames from "classnames"

type MessageStatusProps = {
  status?: ReceiptType
  className?: string
}

const MessageStatus = ({status, className}: MessageStatusProps) => {
  if (status === "seen") {
    return (
      <RiCheckDoubleLine className={classNames("w-4 h-4 opacity-80 text-info", className)} />
    )
  }
  if (status === "delivered") {
    // Inherit parent text color so this works in both chat list and message bubble contexts.
    return <RiCheckLine className={classNames("w-4 h-4 opacity-50", className)} />
  }
  return null
}

export default MessageStatus
