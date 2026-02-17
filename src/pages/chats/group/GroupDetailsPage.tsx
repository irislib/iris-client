import {useState} from "react"
import {nip19} from "nostr-tools"
import {
  addGroupMember,
  buildGroupMetadataContent,
  GROUP_METADATA_KIND,
  removeGroupMember,
  updateGroupData,
} from "nostr-double-ratchet"

import {UserRow} from "@/shared/components/user/UserRow"
import {useLocation} from "@/navigation"
import {useGroupsStore} from "@/stores/groups"
import {useUserStore} from "@/stores/user"
import Header from "@/shared/components/header/Header"
import {shouldHideUser} from "@/utils/visibility"
import {getExpirationLabel} from "@/utils/expiration"
import {DisappearingMessagesModal} from "../components/DisappearingMessagesModal"
import {setGroupDisappearingMessages} from "@/utils/disappearingMessages"
import {MemberChip, GroupAvatar} from "./components"
import {sendGroupEvent} from "@/pages/chats/utils/groupMessaging"
import {rotateGroupSenderKey} from "@/utils/groupTransport"
import {useFileUpload} from "@/shared/hooks/useFileUpload"
import {processHashtreeFile} from "@/shared/upload/hashtree"
import {useGroupPictureUrl} from "./components/useGroupPictureUrl"
import MediaModal from "@/shared/components/media/MediaModal"

const GroupDetailsPage = () => {
  const location = useLocation()
  // Extract group ID from pathname: /chats/group/:id/details
  const pathSegments = location.pathname.split("/").filter(Boolean)
  const id = pathSegments[2] || ""

  const {groups, updateGroup} = useGroupsStore()
  const group = id ? groups[id] : undefined
  const myPubKey = useUserStore((state) => state.publicKey)
  const canEdit = !!myPubKey && !!group?.admins?.includes(myPubKey)

  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [draftPicture, setDraftPicture] = useState("")
  const [draftMembers, setDraftMembers] = useState<string[]>([])
  const [memberInput, setMemberInput] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showDisappearingMessages, setShowDisappearingMessages] = useState(false)
  const [showPictureModal, setShowPictureModal] = useState(false)
  const resolvedPictureUrl = useGroupPictureUrl(group?.picture)

  const pictureUpload = useFileUpload({
    onUpload: (url: string) => setDraftPicture(url),
    accept: "image/*",
    processFile: processHashtreeFile,
  })

  const startEdit = () => {
    if (!group) return
    setSaveError(null)
    setDraftName(group.name ?? "")
    setDraftDescription(group.description ?? "")
    setDraftPicture(group.picture ?? "")
    setDraftMembers(group.members ?? [])
    setMemberInput("")
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setSaveError(null)
    setMemberInput("")
  }

  const normalizeMemberInput = (raw: string): string | null => {
    const trimmed = raw.trim().replace(/^(nostr:|web\\+nostr:)/i, "")
    if (!trimmed) return null
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()

    if (trimmed.startsWith("npub") || trimmed.startsWith("nprofile")) {
      try {
        const decoded = nip19.decode(trimmed)
        if (decoded.type === "npub") return decoded.data
        if (decoded.type === "nprofile") return decoded.data.pubkey
      } catch {
        return null
      }
    }

    return null
  }

  const addMemberToDraft = () => {
    const pubkey = normalizeMemberInput(memberInput)
    if (!pubkey) {
      setSaveError("Enter a valid npub or 64-char hex pubkey")
      return
    }
    if (draftMembers.includes(pubkey)) {
      setMemberInput("")
      return
    }
    setDraftMembers((prev) => [...prev, pubkey])
    setMemberInput("")
  }

  const removeMemberFromDraft = (pubkey: string) => {
    if (pubkey === myPubKey) return
    setDraftMembers((prev) => prev.filter((m) => m !== pubkey))
  }

  const saveEdits = async () => {
    if (!group || !myPubKey) return
    if (!canEdit) return

    setSaveError(null)

    const nextName = draftName.trim()
    if (!nextName) {
      setSaveError("Group name is required")
      return
    }

    const desiredMembers = Array.from(new Set(draftMembers.map((m) => m.trim()))).filter(
      (m) => /^[0-9a-f]{64}$/i.test(m)
    )
    if (!desiredMembers.includes(myPubKey)) {
      desiredMembers.unshift(myPubKey)
    }

    setIsSaving(true)
    try {
      const updatedInfo = updateGroupData(
        group,
        {
          name: nextName,
          description: draftDescription.trim(),
          picture: draftPicture.trim(),
        },
        myPubKey
      )
      if (!updatedInfo) {
        setSaveError("Only group admins can change this")
        return
      }

      const removedMembers = updatedInfo.members.filter(
        (m) => !desiredMembers.includes(m)
      )
      const addedMembers = desiredMembers.filter((m) => !updatedInfo.members.includes(m))

      let updated = updatedInfo
      for (const memberPubKey of removedMembers) {
        const next = removeGroupMember(updated, memberPubKey, myPubKey)
        if (!next) {
          setSaveError("Failed to remove a member (are you trying to remove yourself?)")
          return
        }
        updated = next
      }
      for (const memberPubKey of addedMembers) {
        const next = addGroupMember(updated, memberPubKey, myPubKey)
        if (!next) {
          setSaveError("Failed to add a member")
          return
        }
        updated = next
      }

      const nextGroup = {
        ...group,
        ...updated,
        // Preserve app-specific extensions.
        messageTtlSeconds: group.messageTtlSeconds ?? null,
      }

      updateGroup(id, nextGroup)

      const base = JSON.parse(buildGroupMetadataContent(nextGroup)) as Record<
        string,
        unknown
      >
      base.messageTtlSeconds = nextGroup.messageTtlSeconds ?? null
      base.__irisGroupMetaOp = "edit"

      await sendGroupEvent({
        groupId: id,
        groupMembers: nextGroup.members,
        senderPubKey: myPubKey,
        content: JSON.stringify(base),
        kind: GROUP_METADATA_KIND,
      })

      if (removedMembers.length > 0) {
        const removed = JSON.parse(
          buildGroupMetadataContent(nextGroup, {excludeSecret: true})
        ) as Record<string, unknown>
        removed.messageTtlSeconds = nextGroup.messageTtlSeconds ?? null
        removed.__irisGroupMetaOp = "edit"

        await sendGroupEvent({
          groupId: id,
          groupMembers: removedMembers,
          senderPubKey: myPubKey,
          content: JSON.stringify(removed),
          kind: GROUP_METADATA_KIND,
        })
      }

      if (addedMembers.length > 0) {
        await rotateGroupSenderKey({
          groupId: id,
          groupMembers: nextGroup.members,
          senderPubKey: myPubKey,
        })
      }

      setIsEditing(false)
    } catch (e) {
      console.error("Failed to save group edits:", e)
      setSaveError(e instanceof Error ? e.message : "Failed to save changes")
    } finally {
      setIsSaving(false)
    }
  }

  if (!id || !group) {
    return <div className="p-4">Group not found</div>
  }

  return (
    <>
      <Header title="Group Details" showBack />
      <div className="w-full mx-auto p-6 text-left pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-6 md:pb-6">
        <div className="flex items-start gap-4 mb-6">
          <GroupAvatar
            picture={group.picture}
            size={64}
            onClick={group.picture ? () => setShowPictureModal(true) : undefined}
          />
          <div className="flex-1 min-w-0">
            <div className="text-2xl font-bold">{group.name}</div>
            <div className="text-base-content/70 mt-1">{group.description}</div>
          </div>
          {canEdit && !isEditing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
              Edit group
            </button>
          )}
        </div>
        <DisappearingMessagesSetting
          group={group}
          myPubKey={myPubKey}
          onEdit={() => setShowDisappearingMessages(true)}
        />

        {canEdit && isEditing && (
          <div className="bg-base-100 rounded-lg p-4 mb-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold">Edit Group</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={cancelEdit}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={saveEdits}
                  disabled={isSaving || !draftName.trim()}
                >
                  {isSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>

            <div className="grid gap-4">
              <div>
                <label className="label">
                  <span className="label-text">Group Name *</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Enter group name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Description (optional)</span>
                </label>
                <textarea
                  className="textarea textarea-bordered w-full"
                  placeholder="Enter group description"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Group Picture (optional)</span>
                </label>
                <div className="flex items-center gap-3">
                  {draftPicture && <GroupAvatar picture={draftPicture} size={48} />}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={pictureUpload.triggerUpload}
                    disabled={pictureUpload.uploading}
                  >
                    {pictureUpload.uploading
                      ? `Uploading... ${pictureUpload.progress}%`
                      : "Upload picture"}
                  </button>
                  {draftPicture && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setDraftPicture("")}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {pictureUpload.error && (
                  <div className="text-error text-sm mt-1">{pictureUpload.error}</div>
                )}
              </div>

              <div>
                <div className="font-semibold mb-2">Members</div>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      placeholder="npub1... or hex pubkey"
                      value={memberInput}
                      onChange={(e) => setMemberInput(e.target.value)}
                      disabled={isSaving}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addMemberToDraft()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={addMemberToDraft}
                      disabled={isSaving || !memberInput.trim()}
                    >
                      Add member
                    </button>
                  </div>

                  {draftMembers.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {draftMembers.map((pubkey) => (
                        <MemberChip
                          key={pubkey}
                          pubkey={pubkey}
                          onRemove={
                            pubkey === myPubKey ? undefined : removeMemberFromDraft
                          }
                          variant={pubkey === myPubKey ? "highlight" : "default"}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {saveError && (
                <div className="alert alert-error">
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          </div>
        )}
        <div>
          <div className="font-semibold mb-4">Members</div>
          <ul className="space-y-4">
            {group.members
              // Group members should always be visible, even if they're outside the user's social graph.
              .filter((pubkey) => !shouldHideUser(pubkey, 1, true))
              .map((pubkey) => (
                <li key={pubkey}>
                  <UserRow
                    pubKey={pubkey}
                    avatarWidth={32}
                    description={
                      group.admins.includes(pubkey) ? (
                        <span className="badge badge-neutral badge-sm shrink-0">
                          Admin
                        </span>
                      ) : undefined
                    }
                  />
                </li>
              ))}
          </ul>
        </div>
      </div>

      {showPictureModal && resolvedPictureUrl && (
        <MediaModal
          onClose={() => setShowPictureModal(false)}
          mediaUrl={resolvedPictureUrl}
          mediaType="image"
          showFeedItem={false}
        />
      )}

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
