import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useEffect, useState} from "react"
import {nip19} from "nostr-tools"

import {unmuteUser} from "@/shared/services/Mute.tsx"

import Reactions from "@/shared/components/event/reactions/Reactions.tsx"
import Dropdown from "@/shared/components/ui/Dropdown.tsx"
import Modal from "@/shared/components/ui/Modal.tsx"
import ReportUser from "../ReportUser.tsx"
import {usePublicKey} from "@/stores/user"
import MuteUser from "../MuteUser.tsx"
import RawJSON from "../RawJSON.tsx"
import RelayList from "./RelayList.tsx"
import {useNavigate} from "react-router"

type FeedItemDropdownProps = {
  event: NDKEvent
  onClose: () => void
}

function FeedItemDropdown({event, onClose}: FeedItemDropdownProps) {
  const myPubKey = usePublicKey()
  const navigate = useNavigate()

  const [showReactions, setShowReactions] = useState(false)
  const [showRawJSON, setShowRawJSON] = useState(false)
  const [muted, setMuted] = useState(false)
  const [muting, setMuting] = useState(false)
  const [reporting, setReporting] = useState(false)

  const mutedList: string[] = []

  useEffect(() => {
    setMuted(mutedList.includes(event.pubkey))
  }, [mutedList, event])

  const handleCopyText = () => {
    navigator.clipboard.writeText(event.content)
    onClose()
  }
  const handleCopyLink = () => {
    const irisUrl = `https://iris.to/${nip19.noteEncode(event.id)}`
    navigator.clipboard.writeText(irisUrl)
    onClose()
  }
  const handleCopyNoteID = () => {
    navigator.clipboard.writeText(event.encode())
    onClose()
  }
  const handleMute = async () => {
    if (muted) {
      await unmuteUser(event.pubkey)
    } else {
      setMuting(true)
    }
  }

  const handleShowRawJson = () => {
    setShowRawJSON(!showRawJSON)
  }

  const handleDeletionRequest = async () => {
    if (event.pubkey === myPubKey) {
      try {
        await event.delete()
        onClose()
      } catch (error) {
        console.warn("Event could not be deleted: ", error)
      }
    }
  }

  const handleReporting = () => {
    setReporting(true)
  }

  return (
    <div className="z-40">
      <Dropdown onClose={onClose}>
        {showReactions && (
          <div onClick={(e) => e.stopPropagation()}>
            <Modal onClose={() => setShowReactions(false)}>
              <Reactions event={event} />
            </Modal>
          </div>
        )}
        {reporting && (
          <div onClick={(e) => e.stopPropagation()}>
            <Modal onClose={() => setReporting(false)}>
              <ReportUser user={event.id} event={event} />
            </Modal>
          </div>
        )}
        {muting && (
          <div onClick={(e) => e.stopPropagation()}>
            <Modal onClose={() => setMuting(false)}>
              <MuteUser
                muteState={muted}
                user={event.pubkey}
                setMuting={setMuting}
                setMutedState={setMuted}
              />
            </Modal>
          </div>
        )}
        {showRawJSON && (
          <div onClick={(e) => e.stopPropagation()}>
            <Modal onClose={() => setShowRawJSON(false)}>
              <RawJSON event={event} />
            </Modal>
          </div>
        )}
        <ul
          tabIndex={0}
          className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52"
        >
          <li>
            <button onClick={() => setShowReactions(!showReactions)}>
              Show reactions
            </button>
          </li>
          <li>
            <button onClick={handleCopyText}>Copy Note Content</button>
          </li>
          <li>
            <button onClick={handleShowRawJson}>Show Raw Data</button>
          </li>
          <li>
            <button onClick={handleCopyLink}>Copy link</button>
          </li>
          <li>
            <button onClick={handleCopyNoteID}>Copy Event ID</button>
          </li>
          {myPubKey !== event.pubkey && event.kind !== 9735 && (
            <>
              <li>
                <button onClick={handleMute}>
                  {muted ? "Unmute User" : "Mute User"}
                </button>
              </li>
              <li>
                <button onClick={handleReporting}>Report</button>
              </li>
            </>
          )}
          {event.pubkey === myPubKey && (
            <li>
              <button onClick={handleDeletionRequest}>Request deletion</button>
            </li>
          )}
          <li onClick={() => navigate("/settings/network")}>
            <RelayList relays={event.onRelays} />
          </li>
        </ul>
      </Dropdown>
    </div>
  )
}

export default FeedItemDropdown
