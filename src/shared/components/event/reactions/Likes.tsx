import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {ReactionContent} from "./ReactionContent"
import {useSocialGraph} from "@/utils/socialGraph"
import {NDKEvent} from "@/lib/ndk"
import {useReactionsByAuthor} from "@/shared/hooks/useReactions"

export default function Likes({event}: {event: NDKEvent}) {
  const socialGraph = useSocialGraph()
  const reactions = useReactionsByAuthor(event.id)

  return (
    <div className="flex flex-col gap-4">
      {reactions.size === 0 && <p>No reactions yet</p>}
      {Array.from(reactions.values())
        .sort((a, b) => {
          return (
            socialGraph.getFollowDistance(a.pubkey) -
            socialGraph.getFollowDistance(b.pubkey)
          )
        })
        .map((reactionEvent) => (
          <UserRow
            showHoverCard={true}
            key={reactionEvent.id}
            pubKey={reactionEvent.pubkey}
            description={
              <ReactionContent content={reactionEvent.content} event={reactionEvent} />
            }
          />
        ))}
    </div>
  )
}
