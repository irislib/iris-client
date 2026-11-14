import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {ReactionContent} from "./ReactionContent"
import {useMemo} from "react"
import {getSocialGraph} from "@/utils/socialGraph"
import {useUserStore} from "@/stores/user"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {createLikeOrder} from "./likeOrder"
import {AppEvent} from "@/lib/nostr"
import {useReactionsByAuthor} from "@/shared/hooks/useReactions"

export default function Likes({event}: {event: AppEvent}) {
  const viewer = useUserStore((state) => state.publicKey)
  const revision = useSocialGraphStore((state) => state.version)
  const ready = useSocialGraphStore((state) => state.isReady)
  const order = useMemo(
    () => createLikeOrder(getSocialGraph(), viewer),
    [viewer, revision, ready]
  )
  const reactions = useReactionsByAuthor(event.id)
  const sorted = useMemo(() => order(reactions.values()), [order, reactions])

  return (
    <div className="flex flex-col gap-4">
      {reactions.size === 0 && <p>No reactions yet</p>}
      {sorted.map((reactionEvent) => (
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
