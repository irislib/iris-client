import {useEffect, useState, useId} from "react"
import {
  editPrivateContact,
  resumePrivateContactSync,
  usePrivateContactSyncStatus,
} from "@/utils/privateContactSync"

export function PrivateContactDetails({
  pubkey,
  nickname,
  note,
}: {
  pubkey: string
  nickname?: string | null
  note?: string | null
}) {
  const nameId = useId(),
    noteId = useId()
  const [nameInput, setNameInput] = useState(nickname ?? "")
  const [noteInput, setNoteInput] = useState(note ?? "")
  const [nameDirty, setNameDirty] = useState(false)
  const [noteDirty, setNoteDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const {status, needsSigner} = usePrivateContactSyncStatus()
  useEffect(() => {
    if (!nameDirty) setNameInput(nickname ?? "")
  }, [nickname, nameDirty])
  useEffect(() => {
    if (!noteDirty) setNoteInput(note ?? "")
  }, [note, noteDirty])
  async function save() {
    setSaving(true)
    setError("")
    try {
      const name = nameInput.trim().replace(/\s+/g, " "),
        text = noteInput.replace(/\r\n?/g, "\n").trim()
      if ([...name].length > 80 || [...text].length > 240)
        throw new Error("Use up to 80 characters for a nickname and 240 for a note.")
      await editPrivateContact(pubkey, {
        ...(nameDirty ? {nickname: name || null} : {}),
        ...(noteDirty ? {note: text || null} : {}),
      })
      setNameDirty(false)
      setNoteDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save. Try again.")
    } finally {
      setSaving(false)
    }
  }
  return (
    <details className="text-sm" data-testid="private-contact-details">
      <summary className="cursor-pointer text-base-content/60">Private details</summary>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId}>Nickname</label>
          <input
            id={nameId}
            className="input input-bordered w-full"
            value={nameInput}
            disabled={saving}
            onChange={(event) => {
              setNameDirty(true)
              setNameInput(event.target.value)
            }}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={noteId}>Note</label>
          <textarea
            id={noteId}
            className="textarea textarea-bordered w-full"
            value={noteInput}
            disabled={saving}
            onChange={(event) => {
              setNoteDirty(true)
              setNoteInput(event.target.value)
            }}
            rows={3}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-sm"
            type="submit"
            disabled={saving || (!nameDirty && !noteDirty)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {["error", "pending", "loading", "syncing"].includes(status) && (
            <span className="text-xs text-base-content/60">Waiting to sync</span>
          )}
          {needsSigner && (
            <button
              type="button"
              className="underline"
              onClick={resumePrivateContactSync}
            >
              Retry sync
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
      </form>
    </details>
  )
}
