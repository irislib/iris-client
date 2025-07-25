import {useState} from "react"
import {nip19} from "nostr-tools"

import {unmuteUser} from "@/shared/services/Mute.tsx"
import {useUserStore} from "@/stores/user"
import socialGraph from "@/utils/socialGraph.ts"
import Dropdown from "@/shared/components/ui/Dropdown.tsx"
import Modal from "@/shared/components/ui/Modal.tsx"
import MuteUser from "@/shared/components/event/MuteUser.tsx"
import Icon from "@/shared/components/Icons/Icon"

type ProfileDropdownProps = {
  pubKey: string
  onClose: () => void
}

function ProfileDropdown({pubKey, onClose}: ProfileDropdownProps) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const setPublicKey = useUserStore((state) => state.setPublicKey)
  const [muting, setMuting] = useState(false)

  const isLoggedIn = !!myPubKey
  const isOwnProfile = myPubKey === pubKey
  const isMuted = isLoggedIn && socialGraph().getMutedByUser(myPubKey).has(pubKey)

  const handleViewAs = () => {
    setPublicKey(pubKey)
    onClose()
  }

  const handleMute = async () => {
    if (isMuted) {
      await unmuteUser(pubKey)
      onClose()
    } else {
      setMuting(true)
    }
  }

  const handleCopyNpub = () => {
    const npub = nip19.npubEncode(pubKey)
    navigator.clipboard.writeText(npub)
    onClose()
  }

  const handleCopyHex = () => {
    navigator.clipboard.writeText(pubKey)
    onClose()
  }

  return (
    <div className="z-40">
      <Dropdown onClose={onClose}>
        {muting && (
          <div onClick={(e) => e.stopPropagation()}>
            <Modal onClose={() => setMuting(false)}>
              <MuteUser
                muteState={isMuted}
                user={pubKey}
                setMuting={setMuting}
                setMutedState={() => {}}
              />
            </Modal>
          </div>
        )}
        <ul
          tabIndex={0}
          className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52"
        >
          {!isLoggedIn && (
            <li>
              <button onClick={handleViewAs}>
                <Icon name="eye" className="w-4 h-4" />
                View as
              </button>
            </li>
          )}
          {isLoggedIn && !isOwnProfile && (
            <li>
              <button onClick={handleMute}>
                <Icon name={isMuted ? "volume-up" : "volume-off"} className="w-4 h-4" />
                {isMuted ? "Unmute" : "Mute"}
              </button>
            </li>
          )}
          <li>
            <button onClick={handleCopyNpub}>
              <Icon name="copy" className="w-4 h-4" />
              Copy npub
            </button>
          </li>
          <li>
            <button onClick={handleCopyHex}>
              <Icon name="copy" className="w-4 h-4" />
              Copy hex
            </button>
          </li>
        </ul>
      </Dropdown>
    </div>
  )
}

export default ProfileDropdown
