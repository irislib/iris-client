import Header from "@/shared/components/header/Header"
import {useGroupsStore} from "@/stores/groups"
import {Navigate} from "@/shared/components/Navigate"
import {useNavigate} from "@/navigation"
import {useState} from "react"
import {RiMoreLine} from "@remixicon/react"
import Dropdown from "@/shared/components/ui/Dropdown"
import {confirm} from "@/utils/utils"
import {useGroupSenderKeysStore} from "@/stores/groupSenderKeys"

const GroupChatHeader = ({groupId}: {groupId: string}) => {
  const {groups, removeGroup} = useGroupsStore()
  const group = groups[groupId]
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  if (!group) return null

  const handleDeleteGroup = async () => {
    if (groupId && (await confirm("Delete this group?"))) {
      removeGroup(groupId)
      useGroupSenderKeysStore.getState().removeGroupData(groupId)
      navigate("/chats")
    }
  }

  return (
    <Header showNotifications={false} scrollDown={true} slideUp={false} bold={false}>
      <div className="flex items-center justify-between w-full">
        <Navigate
          className="flex items-center flex-1"
          to={`/chats/group/${groupId}/details`}
        >
          {group.picture ? (
            <img src={group.picture} alt="Group" className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-base-300 flex items-center justify-center">
              <span className="text-lg">👥</span>
            </div>
          )}
          <div className="flex flex-col ml-2">
            <span className="font-bold text-base">{group.name}</span>
            <span className="text-xs text-base-content/70">{group.description}</span>
          </div>
        </Navigate>
        <div className="relative">
          <button
            className="btn btn-ghost btn-circle btn-sm ml-auto"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <RiMoreLine size={20} />
          </button>
          {dropdownOpen && (
            <div className="dropdown-container">
              <Dropdown onClose={() => setDropdownOpen(false)}>
                <ul className="menu bg-base-100 rounded-box w-52 p-2 shadow">
                  <li>
                    <button onClick={handleDeleteGroup} className="text-error">
                      Delete Group
                    </button>
                  </li>
                </ul>
              </Dropdown>
            </div>
          )}
        </div>
      </div>
    </Header>
  )
}

export default GroupChatHeader
