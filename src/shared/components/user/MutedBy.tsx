import FollowList from "@/pages/user/components/FollowList"
import Modal from "@/shared/components/ui/Modal.tsx"
import {shouldHideSocialGraphUser} from "@/utils/visibility"
import {Fragment, useMemo, useState} from "react"
import {useSocialGraph, useFollowsFromGraph, useGraphSize} from "@/utils/socialGraph"
import {ProfileLink} from "./ProfileLink"
import {Name} from "./Name"
import {useUserStore} from "@/stores/user"

const MAX_MUTED_BY_DISPLAY = 3

export default function MutedBy({pubkey}: {pubkey: string}) {
  const socialGraph = useSocialGraph()
  const myPubKey = useUserStore((state) => state.publicKey)
  const follows = useFollowsFromGraph(myPubKey, true)
  // Subscribe to graph changes to re-render when mute data loads
  const graphSize = useGraphSize()

  const {mutedByArray, totalMutedBy} = useMemo(() => {
    const mutedBy = socialGraph.getUserMutedBy(pubkey)
    return {
      mutedByArray: Array.from(mutedBy).slice(0, MAX_MUTED_BY_DISPLAY),
      totalMutedBy: mutedBy.size,
    }
  }, [pubkey, graphSize, socialGraph])

  const root = socialGraph.getRoot()
  const mutedBy = socialGraph.getUserMutedBy(pubkey)
  const isRootMuted = mutedBy.has(root)

  // Show warning when we have follows data loaded
  const showMutedWarning =
    follows.length > 1 &&
    ((totalMutedBy > 0 && shouldHideSocialGraphUser(pubkey)) || isRootMuted)

  const [showMuterList, setShowMuterList] = useState<boolean>(false)

  const renderMutedByLinks = () => {
    return mutedByArray.map((a, index) => (
      <Fragment key={a}>
        <ProfileLink pubKey={a} className="link">
          <Name pubKey={a} />
        </ProfileLink>
        {index < mutedByArray.length - 1 && ", "}
      </Fragment>
    ))
  }

  return (
    <div className="text-base-content/50">
      {showMutedWarning && totalMutedBy > 0 && (
        <div className="text-warning">
          <span role="img" aria-label="warning" className="text-warning">
            ⚠️
          </span>{" "}
          Muted by {renderMutedByLinks()}
          {totalMutedBy > MAX_MUTED_BY_DISPLAY && (
            <>
              {" and "}
              <span
                className="link cursor-pointer"
                onClick={() => setShowMuterList(true)}
              >
                {totalMutedBy - MAX_MUTED_BY_DISPLAY} others
              </span>
            </>
          )}
        </div>
      )}
      {showMuterList && (
        <Modal onClose={() => setShowMuterList(false)}>
          <div className="w-[400px] max-w-full">
            <h3 className="text-xl font-semibold mb-4">Muters</h3>
            <div className="overflow-y-auto max-h-[50vh]">
              <FollowList follows={Array.from(socialGraph.getUserMutedBy(pubkey))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
