import {NostrEvent} from "nostr-tools"
import {useEffect, useState} from "react"
import Markdown from "markdown-to-jsx"
import {getTagValue} from "@/utils/nostr"

interface LongFormProps {
  event: NostrEvent
  standalone: boolean | undefined
}

function LongForm({event, standalone}: LongFormProps) {
  const [title, setTitle] = useState<string>("")
  const [topics, setTopics] = useState<string>()
  const [textBody, setTextBody] = useState<string>("")
  const [summary, setSummary] = useState<string>("")

  useEffect(() => {
    const title = event.tags.find((tag) => tag[0] === "title")?.[1]
    if (title) setTitle(title)

    const hashtags = getTagValue(event, "t")
    if (hashtags) setTopics(hashtags)

    const textBody = event.content
    setTextBody(textBody)

    const summaryTag = getTagValue(event, "summary")
    if (summaryTag) setSummary(summaryTag)
  }, [event])

  return (
    <div className="flex flex-col gap-2 px-5">
      <h1 className="flex items-center gap-2 text-lg">{title}</h1>
      <Markdown
        className="prose leading-relaxed tracking-wide text-gray-450 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        options={{forceBlock: true}}
      >
        {standalone ? textBody : summary || `${textBody.substring(0, 100)}...`}
      </Markdown>
      {topics && <small className="text-custom-accent">#{topics}</small>}
    </div>
  )
}

export default LongForm
