import {Avatar} from "@/shared/components/user/Avatar"
import MemberChip from "./MemberChip"
import GroupAvatar from "./GroupAvatar"
import {GroupDetails} from "../types"
import {FormEvent} from "react"
import DoubleRatchetInfo from "./DoubleRatchetInfo"
import {useFileUpload} from "@/shared/hooks/useFileUpload"
import {processHashtreeFile} from "@/shared/upload/hashtree"

interface GroupDetailsProps {
  selectedMembers: string[]
  groupDetails: GroupDetails
  onGroupDetailsChange: (details: GroupDetails) => void
  onBack: () => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  error: string | null
  isCreating: boolean
  myPubKey: string
}

const GroupDetailsStep = ({
  selectedMembers,
  groupDetails,
  onGroupDetailsChange,
  onBack,
  onSubmit,
  error,
  isCreating,
  myPubKey,
}: GroupDetailsProps) => {
  const handleInputChange = (field: keyof GroupDetails, value: string) => {
    onGroupDetailsChange({
      ...groupDetails,
      [field]: value,
    })
  }

  const pictureUpload = useFileUpload({
    onUpload: (url: string) => handleInputChange("picture", url),
    accept: "image/*",
    processFile: processHashtreeFile,
  })

  return (
    <>
      <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100 flex flex-col gap-6">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={onBack} className="btn btn-ghost btn-sm">
            ← Back
          </button>
          <h2 className="text-xl font-semibold">Group Details</h2>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          {/* Selected Members Summary */}
          <div>
            <h3 className="text-lg font-medium mb-3">
              Members (
              {selectedMembers.filter((pubkey) => pubkey !== myPubKey).length + 1})
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedMembers.map((pubkey) => {
                // Don't show the current user as a separate member if they're selected
                if (pubkey === myPubKey) {
                  return null
                }
                return <MemberChip key={pubkey} pubkey={pubkey} />
              })}
              <div className="flex items-center gap-2 bg-primary/20 rounded-full px-3 py-1">
                <Avatar pubKey={myPubKey} width={24} />
                <span className="text-sm font-medium">You</span>
              </div>
            </div>
          </div>

          {/* Group Details Section */}
          <div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label">
                  <span className="label-text">Group Name *</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Enter group name"
                  value={groupDetails.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">
                  <span className="label-text">Description (optional)</span>
                </label>
                <textarea
                  className="textarea textarea-bordered w-full"
                  placeholder="Enter group description"
                  value={groupDetails.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                  rows={3}
                />
              </div>
              <div>
                <label className="label">
                  <span className="label-text">Group Picture (optional)</span>
                </label>
                <div className="flex items-center gap-3">
                  {groupDetails.picture && (
                    <GroupAvatar picture={groupDetails.picture} size={48} />
                  )}
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
                  {groupDetails.picture && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleInputChange("picture", "")}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {pictureUpload.error && (
                  <div className="text-error text-sm mt-1">{pictureUpload.error}</div>
                )}
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="alert alert-error">
              <span>{error}</span>
            </div>
          )}

          {/* Create Button */}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isCreating || !groupDetails.name.trim()}
          >
            Create Group
          </button>
        </form>
      </div>

      <hr className="mx-4 my-6 border-base-300" />
      <div className="px-2">
        <DoubleRatchetInfo />
      </div>
    </>
  )
}

export default GroupDetailsStep
