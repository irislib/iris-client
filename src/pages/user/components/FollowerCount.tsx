import {useMemo, useState, useEffect} from "react"

import {useSocialGraph} from "@/utils/socialGraph.ts"
import {NostrEvent} from "nostr-social-graph"
import {formatAmount} from "@/utils/utils.ts"
import {nostr} from "@/utils/nostrClient"
import {shouldHideUser} from "@/utils/visibility"

import Modal from "@/shared/components/ui/Modal.tsx"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"

import FollowList from "./FollowList.tsx"

const FollowerCount = ({pubKey}: {pubKey: string}) => {
  const socialGraph = useSocialGraph()
  const initialFollowers = useMemo(
    () =>
      Array.from(socialGraph.getFollowersByUser(pubKey)).filter(
        (follower) => !shouldHideUser(follower)
      ),
    [pubKey, socialGraph]
  )
  const [followers, setFollowers] = useState<string[]>(initialFollowers)
  const [showFollowList, setShowFollowList] = useState<boolean>(false)

  useEffect(() => {
    // If no known followers but we have a social graph, query followers from relays
    if (followers.length === 0 && socialGraph.getUsersByFollowDistance(1).size > 0) {
      const filter = {
        kinds: [3],
        ["#p"]: [pubKey],
      }
      const sub = nostr().subscribe(filter)
      sub.on("event", (event) => {
        socialGraph.handleEvent(event as NostrEvent)
        const newFollowers = Array.from(socialGraph.getFollowersByUser(pubKey)).filter(
          (follower) => !shouldHideUser(follower)
        )
        setFollowers(newFollowers)
      })

      return () => {
        sub.stop()
      }
    }
  }, [followers.length, pubKey, socialGraph])

  const handleFollowersClick = () => {
    setShowFollowList(!showFollowList)
  }

  return (
    <>
      <button
        className="text-base-content hover:underline cursor-pointer bg-transparent border-none p-0"
        onClick={handleFollowersClick}
      >
        <span className="font-semibold">{formatAmount(followers.length)}</span>{" "}
        <span className="text-base-content/70">known followers</span>
      </button>
      {showFollowList && (
        <Modal onClose={() => setShowFollowList(false)}>
          <div className="w-full md:w-[400px] h-full flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <Avatar pubKey={pubKey} width={40} showBadge={false} />
              <div className="flex flex-col">
                <span className="text-sm opacity-70">Known followers of</span>
                <Name pubKey={pubKey} className="font-semibold" />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              <FollowList follows={followers} />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default FollowerCount
