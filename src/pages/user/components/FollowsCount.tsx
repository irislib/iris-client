import useFollows from "@/shared/hooks/useFollows.ts"
import Modal from "@/shared/components/ui/Modal"
import {formatAmount} from "@/utils/utils.ts"
import FollowsList from "./FollowList.tsx"
import {usePublicKey} from "@/stores/user"
import {useState} from "react"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"

interface FollowsCountProps {
  pubKey: string
}

function FollowsCount({pubKey}: FollowsCountProps) {
  const follows = useFollows(pubKey)
  const myPubKey = usePublicKey()
  const [showFollowsList, setShowFollowsList] = useState<boolean>(false)

  const handleFollowsClick = () => {
    setShowFollowsList(!showFollowsList)
  }

  return (
    <>
      <button
        className="text-base-content hover:underline cursor-pointer bg-transparent border-none p-0"
        onClick={handleFollowsClick}
      >
        <span className="font-semibold">{formatAmount(follows.length)}</span>{" "}
        <span className="text-base-content/70">follows</span>
      </button>
      {follows?.includes(myPubKey) && (
        <span className="badge badge-neutral">Follows you</span>
      )}
      {showFollowsList && (
        <Modal onClose={() => setShowFollowsList(false)}>
          <div className="w-full md:w-[400px] h-full flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <Avatar pubKey={pubKey} width={40} showBadge={false} />
              <div className="flex flex-col">
                <span className="text-sm opacity-70">Followed by</span>
                <Name pubKey={pubKey} className="font-semibold" />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              <FollowsList follows={follows} pubKey={pubKey} />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default FollowsCount
