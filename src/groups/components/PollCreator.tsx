import {useRef, useState, type FormEvent} from "react"
import type {NDKEvent} from "@/lib/ndk"
import Modal from "@/shared/components/ui/Modal"
import {Avatar} from "@/shared/components/user/Avatar"
import {ProfileLink} from "@/shared/components/user/ProfileLink"
import {usePublicKey} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {groupAddress, type GroupRef} from "../model"
import {buildPollTags, KIND_POLL, pollRelayUrls} from "../polls"
import {publishGroupEvent} from "../publish"

interface PollCreatorProps {
  group: GroupRef
  onClose: () => void
  onPublished: (event: NDKEvent) => void
}

export default function PollCreator({group, onClose, onPublished}: PollCreatorProps) {
  const publicKey = usePublicKey()
  const [question, setQuestion] = useState("")
  const [options, setOptions] = useState(["", ""])
  const [duration, setDuration] = useState(86400)
  const [publishing, setPublishing] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState("")

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy.current || !publicKey) return
    busy.current = true
    setPublishing(true)
    setError("")
    try {
      if (!question.trim()) throw new Error("Add a question.")
      const relays = pollRelayUrls(ndk().explicitRelayUrls)
      if (!relays.length) throw new Error("Connect to a relay before creating a poll.")
      const event = await publishGroupEvent(
        {
          kind: KIND_POLL,
          content: question.trim(),
          tags: [
            ["h", group.id],
            ["a", groupAddress(group)],
            ...buildPollTags({
              options,
              endsAt: Math.floor(Date.now() / 1000) + duration,
              relays,
            }),
          ],
        },
        relays
      )
      onPublished(event)
      onClose()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not publish the poll. Try again."
      )
    } finally {
      busy.current = false
      setPublishing(false)
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
        className="mx-auto flex max-w-xl flex-col gap-4"
        aria-label="Create poll"
      >
        <h2 className="text-xl font-semibold pr-10">Create poll</h2>
        <div className="flex gap-3">
          {publicKey && (
            <ProfileLink pubKey={publicKey} className="shrink-0">
              <Avatar pubKey={publicKey} width={40} showBadge={false} />
            </ProfileLink>
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <textarea
              autoFocus
              required
              maxLength={1000}
              aria-label="Poll question"
              placeholder="Ask the group a question"
              className="textarea w-full resize-none bg-transparent text-base min-h-24"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={publishing}
            />
            {options.map((option, index) => (
              <div className="flex items-center gap-2" key={index}>
                <input
                  required
                  maxLength={150}
                  aria-label={`Choice ${index + 1}`}
                  placeholder={`Choice ${index + 1}`}
                  className="input input-bordered w-full"
                  value={option}
                  disabled={publishing}
                  onChange={(e) =>
                    setOptions((values) =>
                      values.map((value, i) => (i === index ? e.target.value : value))
                    )
                  }
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove choice ${index + 1}`}
                    disabled={publishing}
                    onClick={() =>
                      setOptions((values) => values.filter((_, i) => i !== index))
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={publishing}
                onClick={() => setOptions((values) => [...values, ""])}
              >
                Add choice
              </button>
            )}
            <label className="flex items-center justify-between gap-4 text-sm">
              Poll duration
              <select
                className="select select-bordered select-sm"
                value={duration}
                disabled={publishing}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                <option value={3600}>1 hour</option>
                <option value={86400}>1 day</option>
                <option value={259200}>3 days</option>
                <option value={604800}>7 days</option>
              </select>
            </label>
            <p className="text-xs text-base-content/60">
              Votes are public. Eligible members can choose one option.
            </p>
            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                className="btn btn-primary rounded-full"
                disabled={
                  publishing ||
                  !publicKey ||
                  !question.trim() ||
                  options.some((option) => !option.trim())
                }
              >
                {publishing ? "Publishing…" : "Post poll"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  )
}
