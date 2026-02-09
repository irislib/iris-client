import {DoubleRatchetUser} from "../utils/doubleRatchetUsers"
import {MemberSelection, GroupDetailsStep} from "./components"
import useHistoryState from "@/shared/hooks/useHistoryState"
import {useState, useEffect, FormEvent} from "react"
import {useGroupsStore} from "@/stores/groups"
import {useUserStore} from "@/stores/user"
import {useNavigate} from "@/navigation"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import {GroupDetails} from "./types"
import {KIND_CHANNEL_CREATE} from "@/utils/constants"
import {sendGroupEvent} from "../utils/groupMessaging"
import {buildGroupMetadataContent, createGroupData} from "nostr-double-ratchet"

const GroupChatCreation = () => {
  const navigate = useNavigate()
  const isTopOfStack = useIsTopOfStack()
  const [currentStep, setCurrentStep] = useState<"members" | "details">("members")
  const [groupDetails, setGroupDetails] = useState<GroupDetails>({
    name: "",
    description: "",
    picture: "",
  })
  const [selectedMembers, setSelectedMembers] = useHistoryState<string[]>(
    [],
    "groupChatMembers"
  )
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const myPubKey = useUserStore((state) => state.publicKey)
  const addGroup = useGroupsStore((state) => state.addGroup)

  // Handle browser back button
  useEffect(() => {
    if (!isTopOfStack) return

    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.step === "details") {
        setCurrentStep("details")
      } else {
        setCurrentStep("members")
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [isTopOfStack])

  const handleAddMember = (user: DoubleRatchetUser) => {
    const isAlreadySelected = selectedMembers.includes(user.pubkey)
    if (!isAlreadySelected) {
      setSelectedMembers((prev: string[]) => [...prev, user.pubkey])
    }
  }

  const handleRemoveMember = (pubkey: string) => {
    setSelectedMembers((prev: string[]) =>
      prev.filter((member: string) => member !== pubkey)
    )
  }

  const handleNextStep = () => {
    setCreateError(null)
    setCurrentStep("details")
    // Push a new history entry for the details step
    window.history.pushState({step: "details"}, "", window.location.pathname)
  }

  const handleBackToMembers = () => {
    setCurrentStep("members")
    // Go back in history
    window.history.back()
  }

  const handleCreateGroup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!groupDetails.name.trim()) {
      setCreateError("Group name is required")
      return
    }

    if (!myPubKey) {
      setCreateError("You need to be logged in to create a group")
      return
    }

    try {
      setIsCreating(true)
      setCreateError(null)

      const group = createGroupData(groupDetails.name, myPubKey, selectedMembers)
      if (groupDetails.description.trim())
        group.description = groupDetails.description.trim()
      if (groupDetails.picture.trim()) group.picture = groupDetails.picture.trim()
      addGroup(group)

      // Send group metadata as first message to the group
      await sendGroupEvent({
        groupId: group.id,
        groupMembers: group.members,
        senderPubKey: myPubKey,
        content: buildGroupMetadataContent(group),
        kind: KIND_CHANNEL_CREATE,
      })

      navigate(`/chats/group/${group.id}`)
    } catch (err) {
      console.error("Error creating group:", err)
      setCreateError("Failed to create group")
    } finally {
      setIsCreating(false)
    }
  }

  if (!myPubKey) {
    return (
      <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100">
        <p className="text-center text-base-content/70">
          Please sign in to create group chats
        </p>
      </div>
    )
  }

  if (currentStep === "members") {
    return (
      <MemberSelection
        selectedMembers={selectedMembers}
        onAddMember={handleAddMember}
        onRemoveMember={handleRemoveMember}
        onNext={handleNextStep}
        error={createError}
        myPubKey={myPubKey}
      />
    )
  }

  return (
    <GroupDetailsStep
      selectedMembers={selectedMembers}
      groupDetails={groupDetails}
      onGroupDetailsChange={setGroupDetails}
      onBack={handleBackToMembers}
      onSubmit={handleCreateGroup}
      error={createError}
      isCreating={isCreating}
      myPubKey={myPubKey}
    />
  )
}

export default GroupChatCreation
