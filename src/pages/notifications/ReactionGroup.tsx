import {useEffect, useId, useState} from "react"
import {RiArrowDownSLine, RiHeartFill} from "@remixicon/react"
import {nip19} from "nostr-tools"
import type {AppEvent} from "@/lib/nostr"
import {Link} from "@/navigation"
import RelativeTime from "@/shared/components/event/RelativeTime"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"
import {getEventSync} from "@/utils/eventCache"
import type {NotificationRow, ReactionPost} from "@/utils/groupNotifications"
import {isEventUnread} from "@/utils/notifications"
import {nostr} from "@/utils/nostrClient"

type ReadState = {seenAt: number; readEvents?: Record<string, number>}

function ReactionLinks({posts, seenAt, readEvents}: {posts: ReactionPost[]} & ReadState) {
  const [titles, setTitles] = useState<Record<string, string>>({})
  const ids = posts
    .map(({target}) => target)
    .sort()
    .join(",")
  useEffect(() => {
    const sub = nostr().subscribe({ids: ids.split(",")}, {closeOnEose: true})
    sub.on("event", (event: AppEvent) => {
      setTitles((current) => ({...current, [event.id]: event.content.trim()}))
    })
    return () => sub.stop()
  }, [ids])
  return (
    <ul className="mt-2 border-l border-custom pl-3">
      {posts.map(({target, events}) => {
        const note = nip19.noteEncode(target)
        const title =
          titles[target] ||
          getEventSync(target)?.content.trim() ||
          `Post ${note.slice(0, 13)}…`
        const emoji = events[0].content
        const unread = events.some((event) => isEventUnread(event, seenAt, readEvents))
        return (
          <li key={target} className="flex items-center gap-2 py-1">
            <span aria-hidden="true" className="shrink-0 max-w-12 truncate">
              {!emoji || emoji === "+" ? "❤️" : emoji}
            </span>
            <Link to={`/${note}`} className="truncate hover:underline">
              {title}
            </Link>
            {unread && (
              <span
                aria-label="Unread"
                className="rounded-full bg-info w-1.5 h-1.5 shrink-0"
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function ReactionGroup({
  row,
  seenAt,
  readEvents,
}: {
  row: Extract<NotificationRow, {actor: string}>
} & ReadState) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const unread = row.posts.some(({events}) =>
    events.some((event) => isEventUnread(event, seenAt, readEvents))
  )
  return (
    <article
      aria-label="Grouped reactions"
      className={`flex gap-3 p-4 md:px-8 border-b border-custom transition-colors duration-1000 ${unread ? "bg-info/20" : ""}`}
    >
      <RiHeartFill className="w-5 h-5 mt-1 shrink-0 text-pink-500" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            to={`/${nip19.npubEncode(row.actor)}`}
            className="inline-flex items-center gap-2 font-bold hover:underline"
          >
            <Avatar pubKey={row.actor} width={30} />
            <Name pubKey={row.actor} />
          </Link>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((open) => !open)}
            className="inline-flex items-center gap-1 font-bold hover:underline"
          >
            reacted to {row.posts.length} posts
            <RiArrowDownSLine
              aria-hidden="true"
              className={`h-4 w-4 ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        <div id={id}>
          {expanded && (
            <ReactionLinks posts={row.posts} seenAt={seenAt} readEvents={readEvents} />
          )}
        </div>
      </div>
      <span className="text-base-content/50 shrink-0">
        <RelativeTime from={row.time * 1000} />
      </span>
    </article>
  )
}
