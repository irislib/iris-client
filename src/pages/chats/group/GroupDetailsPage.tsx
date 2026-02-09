import {UserRow} from "@/shared/components/user/UserRow"
import {useLocation} from "@/navigation"
import {useGroupsStore} from "@/stores/groups"
import {useUserStore} from "@/stores/user"
import Header from "@/shared/components/header/Header"
import {shouldHideUser} from "@/utils/visibility"
import {getExpirationLabel} from "@/utils/expiration"
import {DisappearingMessagesModal} from "../components/DisappearingMessagesModal"
import {setGroupDisappearingMessages} from "@/utils/disappearingMessages"
import {useState} from "react"

const GroupDetailsPage = () => {
  const location = useLocation()
  // Extract group ID from pathname: /chats/group/:id/details
  const pathSegments = location.pathname.split("/").filter(Boolean)
  const id = pathSegments[2] || ""

  const {groups} = useGroupsStore()
  const myPubKey = useUserStore((state) => state.publicKey)
  const [showDisappearingMessages, setShowDisappearingMessages] = useState(false)
  const group = id ? groups[id] : undefined

  if (!id || !group) {
    return <div className="p-4">Group not found</div>
  }

  return (
    <>
      <Header title="Group Details" showBack />
      <div className="w-full mx-auto p-6 text-left pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-6 md:pb-6">
        <div className="flex items-center gap-4 mb-6">
          {group.picture ? (
            <img src={group.picture} alt="Group" className="w-16 h-16 rounded-full" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-base-300 flex items-center justify-center">
              <span className="text-2xl">👥</span>
            </div>
          )}
          <div>
            <div className="text-2xl font-bold">{group.name}</div>
            <div className="text-base-content/70 mt-1">{group.description}</div>
          </div>
        </div>
        <DisappearingMessagesSetting
          group={group}
          myPubKey={myPubKey}
          onEdit={() => setShowDisappearingMessages(true)}
        />
        <div>
          <div className="font-semibold mb-4">Members</div>
          <ul className="space-y-4">
            {group.members
              .filter((pubkey) => !shouldHideUser(pubkey))
              .map((pubkey) => (
                <li key={pubkey}>
                  <UserRow pubKey={pubkey} avatarWidth={32} />
                </li>
              ))}
          </ul>
        </div>
      </div>

      {showDisappearingMessages && (
        <DisappearingMessagesModal
          currentTtlSeconds={group.messageTtlSeconds ?? null}
          onClose={() => setShowDisappearingMessages(false)}
          onSelect={(ttl) => {
            setShowDisappearingMessages(false)
            setGroupDisappearingMessages(id, ttl).catch(console.error)
          }}
        />
      )}
    </>
  )
}

function DisappearingMessagesSetting({
  group,
  myPubKey,
  onEdit,
}: {
  group: {admins?: string[]; messageTtlSeconds?: number | null}
  myPubKey: string
  onEdit: () => void
}) {
  const canEdit = !!myPubKey && (!group.admins?.length || group.admins.includes(myPubKey))
  const ttl = group.messageTtlSeconds
  const label = ttl && ttl > 0 ? getExpirationLabel(ttl) : "Off"

  return (
    <div className="mb-6">
      <div className="font-semibold mb-2">Disappearing messages</div>
      <div className="flex items-center justify-between">
        <span className="text-base-content/70">{label}</span>
        {canEdit && (
          <button className="btn btn-sm btn-ghost" onClick={onEdit}>
            Change
          </button>
        )}
      </div>
    </div>
  )
}

export default GroupDetailsPage
