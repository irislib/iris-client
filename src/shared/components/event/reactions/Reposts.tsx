import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {shouldHideUser} from "@/utils/visibility"
import {useSocialGraph} from "@/utils/socialGraph"
import {NDKEvent} from "@/lib/ndk"
import {useEffect, useMemo, useState} from "react"
import {ndk} from "@/utils/ndk"
import {KIND_REPOST} from "@/utils/constants"
import {useGroupAccess} from "@/groups/GroupContext"
import {isAuthenticGroupActivity, isVisibleGroupActivity} from "@/groups/activity"

export default function Reposts({event}: {event: NDKEvent}) {
  const group = useGroupAccess()
  const socialGraph = useSocialGraph()
  const [reactions, setReactions] = useState<Map<string, NDKEvent>>(new Map())

  useEffect(() => {
    try {
      setReactions(new Map())
      const filter = {
        kinds: [KIND_REPOST, 16],
        ["#e"]: [event.id],
      }
      const sub = ndk().subscribe(filter)

      sub?.on("event", (event: NDKEvent) => {
        if (shouldHideUser(event.pubkey)) return
        if (group && !isAuthenticGroupActivity(event, group.ref)) return
        setReactions((prev) => {
          const existing = prev.get(event.pubkey)
          if (existing) {
            if (existing.created_at! < event.created_at!) {
              prev.set(event.pubkey, event)
            }
          } else {
            prev.set(event.pubkey, event)
          }
          return new Map(prev)
        })
      })
      return () => {
        sub.stop()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [event.id, group?.ref.id, group?.ref.creator])

  const visibleReactions = useMemo(
    () =>
      [...reactions.values()].filter((reaction) =>
        isVisibleGroupActivity(reaction, group)
      ),
    [reactions, group]
  )

  return (
    <div className="flex flex-col gap-4">
      {visibleReactions.length === 0 && <p>No reposts yet</p>}
      {visibleReactions
        .sort((a, b) => {
          return (
            socialGraph.getFollowDistance(a.pubkey) -
            socialGraph.getFollowDistance(b.pubkey)
          )
        })
        .map((event) => (
          <UserRow showHoverCard={true} key={event.id} pubKey={event.pubkey} />
        ))}
    </div>
  )
}
