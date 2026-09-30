import {Dispatch, SetStateAction, useEffect, useState} from "react"
import {Hexpubkey, AppEvent, EventTag} from "@/lib/nostr"

import {muteUser, unmuteUser} from "@/shared/services/Mute.tsx"
import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {useSocialGraph} from "@/utils/socialGraph.ts"
import {nostr} from "@/utils/nostrClient"
import {getMuteLabel, getMutedLabel, getUnmuteLabel} from "@/utils/muteLabels"

interface MuteUserProps {
  setMuting: Dispatch<SetStateAction<boolean>>
  user: Hexpubkey
  event?: AppEvent
  muteState: boolean
  setMutedState: Dispatch<SetStateAction<boolean>>
}

function MuteUser({user, setMuting, muteState, setMutedState}: MuteUserProps) {
  const socialGraph = useSocialGraph()
  const [publishingError, setPublishingError] = useState<boolean>(false)

  // Get current mute status directly from socialGraph
  const myKey = socialGraph.getRoot()
  const isMuted = myKey ? socialGraph.getMutedByUser(myKey).has(user) : muteState
  const [muted, setMuted] = useState<boolean>(isMuted)

  useEffect(() => {
    const currentlyMuted = myKey ? socialGraph.getMutedByUser(myKey).has(user) : muteState
    setMuted(currentlyMuted)
  }, [muteState, user, myKey])

  const handleClose = () => {
    setMuting(false)
  }

  const handleMuteUser = async () => {
    try {
      const followDistance = socialGraph.getFollowDistance(user)
      if (followDistance === 1) {
        // Unfollow the user if they are being followed
        const event = new AppEvent(nostr())
        event.kind = 3
        const followedUsers = socialGraph.getFollowedByUser(socialGraph.getRoot())
        followedUsers.delete(user)
        event.tags = Array.from(followedUsers).map((pubKey) => ["p", pubKey]) as EventTag[]
        event.publish().catch((e) => console.warn("Error publishing unfollow event:", e))
      }

      await muteUser(user)
      setMuted(true)
      setMutedState(true)
      setPublishingError(false)
    } catch (error) {
      console.error("Error muting user:", error)
      setPublishingError(true)
    }
  }

  const handleUnmuteUser = async () => {
    try {
      await unmuteUser(user)
      setMuted(false)
      setMutedState(false)
      setPublishingError(false)
      handleClose()
    } catch (error) {
      console.error("Error unmuting user:", error)
      setPublishingError(true)
    }
  }

  const muteLabel = getMuteLabel()
  const mutedLabel = getMutedLabel()

  return (
    <div className="flex flex-col gap-4 w-80 min-w-80">
      <div>
        <h1 className="text-lg font-bold mb-4">
          {muted ? `User ${mutedLabel}` : `${muteLabel} User`}
        </h1>
        {publishingError && (
          <div className="alert alert-error mb-4">
            <span>Error updating {muteLabel.toLowerCase()} list. Please try again.</span>
          </div>
        )}
        <div className="min-h-32">
          {muted ? (
            <div className="flex flex-col items-center justify-center h-full">
              <button onClick={handleUnmuteUser} className="btn btn-primary">
                {getUnmuteLabel()}
              </button>
            </div>
          ) : (
            <>
              <div>
                <p>Are you sure you want to {muteLabel.toLowerCase()}:</p>
                <div className="flex items-center mt-4 mb-4">
                  <UserRow pubKey={user} />
                </div>
              </div>
              <div className="flex justify-center gap-2">
                <button onClick={handleClose} className="btn btn-neutral">
                  No
                </button>
                <button onClick={handleMuteUser} className="btn btn-primary">
                  Yes
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default MuteUser
