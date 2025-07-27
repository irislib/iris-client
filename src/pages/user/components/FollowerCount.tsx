import {useMemo, useState, useEffect} from "react"

import socialGraph from "@/utils/socialGraph.ts"
import {NostrEvent} from "nostr-social-graph"
import {formatAmount} from "@/utils/utils.ts"
import {getPool, DEFAULT_RELAYS} from "@/utils/applesauce"

import Modal from "@/shared/components/ui/Modal.tsx"

import Icon from "@/shared/components/Icons/Icon.tsx"
import FollowList from "./FollowList.tsx"

const FollowerCount = ({pubKey}: {pubKey: string}) => {
  const initialFollowers = useMemo(
    () => Array.from(socialGraph().getFollowersByUser(pubKey)),
    [pubKey]
  )
  const [followers, setFollowers] = useState<string[]>(initialFollowers)
  const [showFollowList, setShowFollowList] = useState<boolean>(false)

  useEffect(() => {
    // If no known followers but we have a social graph, query followers from relays
    if (followers.length === 0 && socialGraph().getUsersByFollowDistance(1).size > 0) {
      const filter = {
        kinds: [3],
        ["#p"]: [pubKey],
      }

      const pool = getPool()
      const poolSubscription = pool.subscription(DEFAULT_RELAYS, filter)

      const subscription = poolSubscription.subscribe({
        next: (event) => {
          if (typeof event !== "string") {
            socialGraph().handleEvent(event as NostrEvent)
            const newFollowers = Array.from(socialGraph().getFollowersByUser(pubKey))
            setFollowers(newFollowers)
          }
        },
        error: (error) => {
          console.error("Subscription error:", error)
        },
      })

      return () => {
        subscription.unsubscribe()
      }
    }
  }, [followers.length, pubKey])

  const handleFollowersClick = () => {
    setShowFollowList(!showFollowList)
  }

  return (
    <>
      <button className="btn btn-sm btn-neutral" onClick={handleFollowersClick}>
        <Icon name="user-v2" /> <span>Known followers</span>{" "}
        <span className="badge">{formatAmount(followers.length)}</span>
      </button>
      {showFollowList && (
        <Modal onClose={() => setShowFollowList(false)}>
          <div className=" w-[400px] max-w-full">
            <h3 className="text-xl font-semibold mb-4">Known followers</h3>
            <div className="overflow-y-auto max-h-[50vh]">
              <FollowList follows={followers} />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default FollowerCount
