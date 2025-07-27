import {RiExternalLinkLine} from "@remixicon/react"
import {NostrEvent} from "nostr-tools"
import {useEffect, useState} from "react"
import HyperText from "../HyperText"
import {getTagValue} from "@/utils/nostr"

interface HighlightProps {
  event: NostrEvent
}

function Highlight({event}: HighlightProps) {
  const [link, setLink] = useState<string>("")

  useEffect(() => {
    const rTag = getTagValue(event, "r")
    // todo: clean URL from trackers
    if (rTag) setLink(rTag)
  }, [event])

  return (
    <div className="flex flex-col gap-1 px-4">
      {event.content && (
        <div className="border-l-4 p-2 border-purple-500">
          <HyperText event={event}>{event.content}</HyperText>
        </div>
      )}
      {link && (
        <div className="flex items-center gap-4 p-1 rounded-lg">
          <RiExternalLinkLine />
          <HyperText event={event} truncate={10}>
            {link}
          </HyperText>
        </div>
      )}
    </div>
  )
}

export default Highlight
