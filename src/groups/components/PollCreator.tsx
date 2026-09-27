import {useRef, useState, type FormEvent} from "react"
import type {NDKEvent} from "@/lib/ndk"
import Modal from "@/shared/components/ui/Modal"
import {Avatar} from "@/shared/components/user/Avatar"
import {ProfileLink} from "@/shared/components/user/ProfileLink"
import {usePublicKey} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {groupAddress, verifyGroupElectorateEvidence, type GroupRef} from "../model"
import {
  assertPollSize,
  buildPollElectorateTags,
  buildPollEvidenceTags,
  buildPollTags,
  KIND_POLL,
  pollRelayUrls,
  type PollElectorate,
} from "../polls"
import {publishGroupEvent} from "../publish"
import {useGroupEvents} from "../useGroupEvents"

interface PollCreatorProps {
  group: GroupRef
  electorate: PollElectorate | null
  snapshotLoading?: boolean
  snapshotError?: string
  onClose: () => void
  onPublished: (event: NDKEvent) => void
}

export default function PollCreator({
  group,
  electorate,
  snapshotLoading = false,
  snapshotError,
  onClose,
  onPublished,
}: PollCreatorProps) {
  const publicKey = usePublicKey()
  const [proofRevision, setProofRevision] = useState(0)
  const evidence = useGroupEvents(
    electorate
      ? [{ids: electorate.evidenceEventIds, limit: electorate.evidenceEventIds.length}]
      : [],
    electorate?.evidenceEventIds.length ?? 1,
    {refreshKey: proofRevision}
  )
  const proofsReady =
    !!electorate &&
    !evidence.loading &&
    electorate.evidenceEventIds.every((id) =>
      evidence.events.some((event) => event.id === id)
    )
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
      if (snapshotLoading || snapshotError || !electorate)
        throw new Error(snapshotError || "Wait for the group voter snapshot to load.")
      if (
        electorate.rootPubkey !== group.creator ||
        !electorate.memberPubkeys.includes(publicKey)
      ) {
        throw new Error(
          "Polls use the group creator's membership view. You are not included in that snapshot."
        )
      }
      if (!proofsReady)
        throw new Error("Wait for all signed voter proofs before posting the poll.")
      const verification = verifyGroupElectorateEvidence(
        group,
        electorate,
        evidence.events,
        Math.floor(Date.now() / 1000)
      )
      if (!verification.valid)
        throw new Error(
          verification.reason || "The voter snapshot could not be verified."
        )
      const relays = pollRelayUrls(ndk().explicitRelayUrls)
      if (!relays.length) throw new Error("Connect to a relay before creating a poll.")
      const draft = {
        kind: KIND_POLL,
        content: question.trim(),
        tags: [
          ["h", group.id],
          ["a", groupAddress(group)],
          ...buildPollElectorateTags(electorate),
          ...buildPollEvidenceTags(electorate, evidence.events),
          ...buildPollTags({
            options,
            endsAt: Math.floor(Date.now() / 1000) + duration,
            relays,
          }),
        ],
      }
      assertPollSize(draft)
      const event = await publishGroupEvent(draft, relays)
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
              Votes are public. Choose one option.
            </p>
            {electorate && !snapshotLoading && (
              <p className="text-xs text-base-content/60">
                Fixed at posting: {electorate.memberPubkeys.length} observed members ·{" "}
                {electorate.authorityPubkeys.length} trusted voters. Trusted voters are
                the creator and eligible direct contacts in the observed group view.
              </p>
            )}
            {electorate?.memberSnapshotLimited && (
              <p className="text-xs text-base-content/60">
                The member snapshot is partial. Trusted voting authority is fixed
                separately.
              </p>
            )}
            {snapshotLoading && (
              <p role="status" className="text-xs text-base-content/60">
                Loading the observed voter snapshot…
              </p>
            )}
            {electorate && !proofsReady && !snapshotLoading && (
              <p role="status" className="text-xs text-base-content/60">
                Loading signed voter proofs…
              </p>
            )}
            {evidence.error && (
              <p role="alert" className="text-sm text-error">
                {evidence.error}
              </p>
            )}
            {electorate && !proofsReady && !evidence.loading && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setProofRevision((value) => value + 1)}
              >
                Retry voter proofs
              </button>
            )}
            {snapshotError && (
              <p role="alert" className="text-sm text-error">
                {snapshotError}
              </p>
            )}
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
                  snapshotLoading ||
                  !!snapshotError ||
                  !electorate ||
                  !proofsReady ||
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
