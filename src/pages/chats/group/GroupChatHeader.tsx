import Header from "@/shared/components/header/Header"
import {useGroupsStore} from "@/stores/groups"
import {Navigate} from "@/shared/components/Navigate"
import {useNavigate} from "@/navigation"
import {useState} from "react"
import {RiMoreLine} from "@remixicon/react"
import Dropdown from "@/shared/components/ui/Dropdown"
import {confirm} from "@/utils/utils"
import MediaModal from "@/shared/components/media/MediaModal"
import {GroupAvatar} from "./components"
import {useGroupPictureUrl} from "./components/useGroupPictureUrl"

const GroupChatHeader = ({groupId}: {groupId: string}) => {
  const {groups, removeGroup} = useGroupsStore()
  const group = groups[groupId]
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showPictureModal, setShowPictureModal] = useState(false)
  const resolvedPictureUrl = useGroupPictureUrl(group?.picture)

  if (!group) return null

  const handleDeleteGroup = async () => {
    if (groupId && (await confirm("Delete this group?"))) {
      removeGroup(groupId)
      navigate("/chats")
    }
  }

  return (
    <>
      <Header showNotifications={false} scrollDown={true} slideUp={false} bold={false}>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center flex-1 min-w-0">
            <button
              type="button"
              aria-label="Open group picture"
              className={`rounded-full leading-none${resolvedPictureUrl ? " cursor-zoom-in" : ""}`}
              onClick={() => {
                if (resolvedPictureUrl) setShowPictureModal(true)
              }}
              disabled={!resolvedPictureUrl}
            >
              <GroupAvatar picture={group.picture} size={32} />
            </button>
            <Navigate
              className="flex items-center flex-1 min-w-0 ml-2"
              to={`/chats/group/${groupId}/details`}
            >
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-base">{group.name}</span>
                <span className="text-xs text-base-content/70">{group.description}</span>
              </div>
            </Navigate>
          </div>
          <div className="relative">
            <button
              className="btn btn-ghost btn-circle btn-sm ml-auto"
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <RiMoreLine size={20} />
            </button>
            {dropdownOpen && (
              <Dropdown onClose={() => setDropdownOpen(false)}>
                <ul className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                  <li>
                    <button onClick={handleDeleteGroup} className="text-error">
                      Delete Group
                    </button>
                  </li>
                </ul>
              </Dropdown>
            )}
          </div>
        </div>
      </Header>
      {showPictureModal && resolvedPictureUrl && (
        <MediaModal
          onClose={() => setShowPictureModal(false)}
          mediaUrl={resolvedPictureUrl}
          mediaType="image"
          showFeedItem={false}
        />
      )}
    </>
  )
}

export default GroupChatHeader
