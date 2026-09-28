import {useEffect, useMemo, useRef, useState} from "react"
import {NDKEvent} from "@/lib/ndk"
import TextNote from "@/shared/components/event/TextNote"
import {usePublicKey} from "@/stores/user"
import {groupAddress, type GroupRef} from "../model"
import {
  buildPollResponseTags,
  KIND_POLL_RESPONSE,
  parsePoll,
  isPollVoter,
  tallyPollResponses,
  tallyPollElectorate,
} from "../polls"
import {publishGroupEvent} from "../publish"
import usePollResponses from "./usePollResponses"
import usePollAuthority from "./usePollAuthority"

interface PollCardProps {
  event: NDKEvent
  group?: GroupRef
  canVote: boolean
  isEligible: (pubkey: string) => boolean
  policyLabel: string
}

/** Poll body for Iris's shared FeedItem, including standalone event views. */
export default function PollCard({
  event,
  group,
  canVote,
  isEligible,
  policyLabel,
}: PollCardProps) {
  const publicKey = usePublicKey()
  const poll = useMemo(() => parsePoll(event), [event])
  const authority = usePollAuthority(poll)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [selected, setSelected] = useState<string[] | null>(null)
  const [confirmed, setConfirmed] = useState<NDKEvent | null>(null)
  const [publishing, setPublishing] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [resultView, setResultView] = useState<"trusted" | "members">("trusted")
  const closed = poll?.endsAt !== undefined && now > poll.endsAt
  const {
    responses,
    loading,
    limited,
    error: queryError,
    refresh,
  } = usePollResponses(poll, closed)
  const allResponses = useMemo(
    () => (confirmed ? [...responses, confirmed] : responses),
    [responses, confirmed]
  )
  const totals = useMemo(() => {
    if (!poll) return null
    const currentTime = Math.floor(Date.now() / 1000)
    if (poll.electorate) return tallyPollElectorate(poll, allResponses, currentTime)
    return {
      members: tallyPollResponses(poll, allResponses, {isEligible, now: currentTime}),
      trusted: null,
    }
  }, [poll, allResponses, isEligible, now])
  const tally = totals?.members
  const trusted = authority.valid ? totals?.trusted : null
  const mine = useMemo(
    () =>
      poll && publicKey
        ? tallyPollResponses(poll, allResponses, {
            isEligible: (key) => key === publicKey,
            now: Math.floor(Date.now() / 1000),
          }).responsesByPubkey.get(publicKey)
        : undefined,
    [poll, publicKey, allResponses, now]
  )
  const choices = selected ?? mine?.selections ?? []
  const snapshotReady = !poll?.electorate || authority.valid
  const eligibleToVote =
    !!poll &&
    isPollVoter(
      poll,
      publicKey,
      authority.valid,
      Boolean(canVote && publicKey && isEligible(publicKey))
    )

  useEffect(() => {
    setSelected(null)
    setConfirmed(null)
    setError("")
    setMessage("")
  }, [event.id, publicKey])

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000))
    if (poll?.endsAt === undefined) return
    const delay = (poll.endsAt + 1) * 1000 - Date.now()
    if (delay <= 0) return
    const timer = setTimeout(
      () => setNow(Math.floor(Date.now() / 1000)),
      Math.min(delay, 2_147_483_647)
    )
    return () => clearTimeout(timer)
  }, [poll?.endsAt, now])

  const submit = async () => {
    if (!poll || !eligibleToVote || busy.current) return
    const timestamp = Math.floor(Date.now() / 1000)
    setNow(timestamp)
    if (poll.endsAt !== undefined && timestamp > poll.endsAt) {
      setError("This poll has closed.")
      return
    }
    busy.current = true
    setPublishing(true)
    setError("")
    setMessage("")
    try {
      const vote = await publishGroupEvent(
        {
          kind: KIND_POLL_RESPONSE,
          content: "",
          tags: [
            ...buildPollResponseTags(poll, choices),
            ...(group
              ? [
                  ["h", group.id],
                  ["a", groupAddress(group)],
                ]
              : []),
          ],
        },
        poll.relays.length ? poll.relays.slice(0, 8) : undefined,
        {afterTimestamp: mine?.event.created_at, beforeTimestamp: poll.endsAt}
      )
      setConfirmed(vote)
      setNow(Math.floor(Date.now() / 1000))
      setSelected(null)
      setMessage("Vote confirmed")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? `Vote not confirmed: ${reason.message}`
          : "Vote not confirmed. Try again."
      )
    } finally {
      busy.current = false
      setPublishing(false)
    }
  }

  if (!poll || !tally)
    return (
      <div className="space-y-2 px-4">
        <div className="-mx-4">
          <TextNote event={event} />
        </div>
        <p className="text-sm text-base-content/60">
          This poll has invalid choices or settings.
        </p>
      </div>
    )

  const changed =
    choices.length > 0 &&
    (!mine ||
      choices.length !== mine.selections.length ||
      choices.some((id) => !mine.selections.includes(id)))
  const deadline =
    poll.endsAt !== undefined
      ? new Date(poll.endsAt * 1000).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : ""

  const displayed = resultView === "trusted" && trusted ? trusted : tally
  const frozenMember = !!publicKey && !!poll.electorate?.memberPubkeys.includes(publicKey)
  const frozenAuthority =
    !!publicKey && !!poll.electorate?.authorityPubkeys.includes(publicKey)
  const participationLabel = frozenMember
    ? "Your vote appears under Member ballots."
    : "You’re not on this poll’s voter list."
  const voteLabel = mine ? "Update vote" : "Vote"
  const endLabel = deadline ? `Ends ${deadline}` : "No deadline"

  return (
    <section
      className="space-y-3 px-4"
      aria-label="Poll"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="-mx-4">
        <TextNote event={event} />
      </div>
      {poll.electorate && (
        <div className="flex flex-wrap gap-2" aria-label="Poll result views">
          <button
            type="button"
            aria-pressed={resultView === "trusted" && !!trusted}
            disabled={!trusted}
            className={`btn btn-sm rounded-full ${resultView === "trusted" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setResultView("trusted")}
          >
            Trusted votes · {trusted ? trusted.total : "unavailable"}
          </button>
          <button
            type="button"
            aria-pressed={(resultView === "members" || !trusted) && snapshotReady}
            disabled={!snapshotReady}
            className={`btn btn-sm rounded-full ${resultView === "members" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setResultView("members")}
          >
            Member ballots · {snapshotReady ? tally.total : "unavailable"}
          </button>
        </div>
      )}
      {poll.electorate && !authority.valid && (
        <p className="text-xs text-base-content/70" role="status">
          {authority.loading ? "Checking who can vote…" : "Couldn’t verify who can vote."}
        </p>
      )}
      {poll.electorate && authority.valid && publicKey && !frozenAuthority && !closed && (
        <p className="text-xs text-base-content/70">{participationLabel}</p>
      )}
      <fieldset className="space-y-2" disabled={!eligibleToVote || closed || publishing}>
        <legend className="sr-only">
          {poll.type === "multiplechoice"
            ? "Choose one or more options"
            : "Choose one option"}
        </legend>
        {poll.options.map((option) => {
          const count = snapshotReady ? displayed.counts[option.id] : 0
          const percent = displayed.total
            ? Math.round((count / displayed.total) * 100)
            : 0
          const chosen = choices.includes(option.id)
          return (
            <label
              key={option.id}
              className={`relative flex min-h-11 items-center gap-3 overflow-hidden rounded-lg border px-3 py-2 ${chosen ? "border-primary" : "border-custom"} ${eligibleToVote && !closed ? "cursor-pointer" : ""}`}
            >
              <span
                className="absolute inset-y-0 left-0 bg-primary/10 transition-[width]"
                style={{width: `${percent}%`}}
                aria-hidden="true"
              />
              <input
                type={poll.type === "multiplechoice" ? "checkbox" : "radio"}
                name={`poll-${event.id}`}
                value={option.id}
                className={`${poll.type === "multiplechoice" ? "checkbox checkbox-sm" : "radio radio-sm"} relative shrink-0`}
                checked={chosen}
                onChange={() => {
                  if (poll.type === "singlechoice") setSelected([option.id])
                  else
                    setSelected(
                      chosen
                        ? choices.filter((id) => id !== option.id)
                        : [...choices, option.id]
                    )
                }}
              />
              <span className="relative min-w-0 flex-1 break-words">{option.label}</span>
              <span
                className="relative shrink-0 text-sm tabular-nums"
                aria-label={
                  snapshotReady
                    ? `${count} votes, ${percent} percent`
                    : "Results unavailable"
                }
              >
                {snapshotReady ? (
                  <>
                    {percent}% <span className="text-base-content/50">({count})</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
            </label>
          )
        })}
      </fieldset>
      {eligibleToVote && !closed && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-primary btn-sm rounded-full"
            disabled={publishing || !changed}
            onClick={submit}
          >
            {publishing ? "Submitting…" : voteLabel}
          </button>
          {poll.type === "multiplechoice" && (
            <span className="text-xs text-base-content/60">Choose one or more</span>
          )}
        </div>
      )}
      <div className="space-y-1 text-xs text-base-content/60">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {!poll.electorate && (
              <>
                {tally.total} {tally.total === 1 ? "vote" : "votes"} ·{" "}
              </>
            )}
            {closed ? "Voting closed" : endLabel}
          </span>
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              refresh()
              authority.refresh()
            }}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh results"}
          </button>
        </div>
        <details>
          <summary className="cursor-pointer">Poll details</summary>
          {poll.electorate ? (
            <>
              <p className="mt-1">
                {poll.electorate.memberPubkeys.length} members ·{" "}
                {poll.electorate.authorityPubkeys.length} trusted voters at opening.
              </p>
              <p className="mt-1">
                Trusted voters are the creator and eligible direct contacts observed by
                the poll author. Joining or gaining membership confirmations does not
                grant a trusted vote in this poll. One response per public key, not per
                person.
              </p>
              {authority.trustListCreatedAt !== undefined && (
                <p className="mt-1">
                  Creator contact list signed{" "}
                  {new Date(authority.trustListCreatedAt * 1000).toLocaleString()}.
                </p>
              )}
              <p className="mt-1">
                Advisory results from observed votes. Missing or backdated votes can
                change totals after closing.
              </p>
              {authority.reason && <p className="mt-1">{authority.reason}</p>}
              {authority.valid && authority.warning && (
                <p className="mt-1">{authority.warning}</p>
              )}
            </>
          ) : (
            <p className="mt-1">
              Current view · {policyLabel}. One response per public key.
            </p>
          )}
          {poll.electorate?.memberSnapshotLimited && (
            <p className="mt-1">Some members may be missing from this poll.</p>
          )}
          {limited && <p className="mt-1">Some votes may be missing.</p>}
        </details>
        {!eligibleToVote && !closed && !poll.electorate && (
          <p>{publicKey ? "Only eligible members can vote." : "Sign in to vote."}</p>
        )}
        {!publicKey && poll.electorate && !closed && <p>Sign in to vote.</p>}
        {queryError && <p role="status">{queryError}</p>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
    </section>
  )
}
