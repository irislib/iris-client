import {useRef, useState, type FormEvent} from "react"
import Modal from "@/shared/components/ui/Modal"
import {usePublicKey} from "@/stores/user"
import {createGroupDraft, DEFAULT_GROUP_POLICY, type Group} from "../model"
import {publishGroupEvent} from "../publish"
import {useSavedGroups} from "../savedGroups"
import {groupPath} from "../useGroup"
import {useNavigate} from "@/navigation"

export default function GroupForm({
  onClose,
  group,
}: {
  onClose: () => void
  group?: Group
}) {
  const publicKey = usePublicKey()
  const navigate = useNavigate()
  const [name, setName] = useState(group?.name ?? "")
  const [description, setDescription] = useState(group?.description ?? "")
  const policy = group?.policy ?? DEFAULT_GROUP_POLICY
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const id = useRef(group?.id ?? crypto.randomUUID())
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!publicKey || busy.current) return
    busy.current = true
    setSaving(true)
    setError("")
    try {
      if (group && publicKey !== group.creator)
        throw new Error("Switch back to the group’s creator account to edit it.")
      const ref = {id: id.current, creator: publicKey}
      await publishGroupEvent(createGroupDraft({...ref, name, description, policy}))
      useSavedGroups.getState().remember(publicKey, ref)
      navigate(groupPath(ref))
      onClose()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save the group. Try again."
      )
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  return (
    <Modal
      onClose={() => {
        if (!busy.current) onClose()
      }}
    >
      <form
        onSubmit={submit}
        className="mx-auto max-w-xl flex flex-col gap-5"
        aria-label={group ? "Edit group" : "Create group"}
      >
        <h2 className="text-2xl font-semibold pr-10">
          {group ? "Edit group" : "Create a group"}
        </h2>
        <label className="form-control gap-2">
          <span className="font-medium">Name</span>
          <input
            autoFocus
            required
            maxLength={80}
            className="input input-bordered w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your group’s name"
          />
        </label>
        <label className="form-control gap-2">
          <span className="font-medium">About & membership</span>
          <textarea
            required
            maxLength={2000}
            rows={4}
            className="textarea textarea-bordered text-base"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What brings you together, and who can join?"
          />
        </label>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={saving || !name.trim() || !description.trim()}
          className="btn btn-primary self-end"
        >
          {saving ? "Saving…" : group ? "Save changes" : "Create group"}
        </button>
      </form>
    </Modal>
  )
}
