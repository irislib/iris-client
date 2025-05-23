import Icon from "@/shared/components/Icons/Icon.tsx"
import useFollows from "@/shared/hooks/useFollows.ts"
import Modal from "@/shared/components/ui/Modal"
import socialGraph from "@/utils/socialGraph"
import {formatAmount} from "@/utils/utils.ts"
import FollowsList from "./FollowList.tsx"
import {usePublicKey} from "@/stores/user"
import {useState, useMemo} from "react"

interface FollowsCountProps {
  pubKey: string
}

function FollowsCount({pubKey}: FollowsCountProps) {
  const f = useFollows(pubKey) // to query from relays and trigger update
  const follows = useMemo(
    () => Array.from(socialGraph().getFollowedByUser(pubKey)),
    [pubKey, f]
  )
  const myPubKey = usePublicKey()
  const [showFollowsList, setShowFollowsList] = useState<boolean>(false)

  const handleFollowsClick = () => {
    setShowFollowsList(!showFollowsList)
  }

  return (
    <>
      <button className="btn btn-sm btn-neutral" onClick={handleFollowsClick}>
        <Icon name="stars" /> <span>Follows </span>{" "}
        <span className="badge">{formatAmount(follows.length)}</span>
      </button>
      {follows?.includes(myPubKey) && (
        <span className="badge badge-neutral">Follows you</span>
      )}
      {showFollowsList && (
        <Modal onClose={() => setShowFollowsList(false)}>
          <div className=" w-[400px] max-w-full">
            <h3 className="text-xl font-semibold mb-4">Follows</h3>
          </div>
          <div className="overflow-y-auto max-h-[50vh]">
            <FollowsList follows={follows} />
          </div>
        </Modal>
      )}
    </>
  )
}

export default FollowsCount
