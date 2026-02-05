import {RiCheckDoubleLine, RiCheckLine} from "@remixicon/react"
import type {ReceiptType} from "nostr-double-ratchet/src"
import classNames from "classnames"

type MessageStatusProps = {
  status?: ReceiptType
  className?: string
}

const MessageStatus = ({status, className}: MessageStatusProps) => {
  if (status === "seen") {
    return <RiCheckDoubleLine className={classNames("w-4 h-4 text-primary/80", className)} />
  }
  if (status === "delivered") {
    return <RiCheckLine className={classNames("w-4 h-4 text-base-content/50", className)} />
  }
  return null
}

export default MessageStatus
