import {RiCheckDoubleLine, RiCheckLine} from "@remixicon/react"
import type {ReceiptType} from "nostr-double-ratchet"
import classNames from "classnames"

type MessageStatusProps = {
  status?: ReceiptType
  sentToRelays?: boolean
  className?: string
}

const MessageStatus = ({status, sentToRelays, className}: MessageStatusProps) => {
  if (status === "seen") {
    return (
      <RiCheckDoubleLine
        className={classNames("w-4 h-4 opacity-80 text-success", className)}
      />
    )
  }
  if (status === "delivered") {
    // Inherit parent text color so this works in both chat list and message bubble contexts.
    return <RiCheckDoubleLine className={classNames("w-4 h-4 opacity-50", className)} />
  }
  if (sentToRelays) {
    return <RiCheckLine className={classNames("w-4 h-4 opacity-50", className)} />
  }
  // Reserve space so timestamps don't shift when delivery/read receipts arrive.
  return (
    <span className={classNames("inline-block w-4 h-4", className)} aria-hidden="true" />
  )
}

export default MessageStatus
