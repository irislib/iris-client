import {useCallback, useMemo, useRef, useState} from "react"
import {verifyGroupElectorateEvidence} from "../model"
import {useGroupEvents} from "../useGroupEvents"
import {rememberPollRootEvidence, verifyPollAuthority, type Poll} from "../polls"

/** A poll author cannot manufacture trusted votes by merely labeling keys as trusted. */
export default function usePollAuthority(poll: Poll | null) {
  const snapshot = poll?.electorate
  const [revision, setRevision] = useState(0)
  const observedRoot = useRef<{pollId?: string; event?: import("nostr-tools").Event}>({})
  if (observedRoot.current.pollId !== poll?.id) observedRoot.current = {pollId: poll?.id}
  const bundledIds = new Set(poll?.evidenceEvents?.map((event) => event.id) ?? [])
  const missingIds = snapshot?.evidenceEventIds.filter((id) => !bundledIds.has(id)) ?? []
  const evidence = useGroupEvents(
    snapshot
      ? [
          ...(missingIds.length ? [{ids: missingIds, limit: missingIds.length}] : []),
          {
            kinds: [3],
            authors: [snapshot.rootPubkey],
            until: poll!.createdAt - 1,
            limit: 1,
          },
        ]
      : [],
    (snapshot?.evidenceEventIds.length ?? 0) + 2,
    {refreshKey: revision}
  )
  const allEvidence = useMemo(() => {
    if (poll)
      observedRoot.current.event = rememberPollRootEvidence(
        poll,
        observedRoot.current.event,
        evidence.events
      )
    return [
      ...(poll?.evidenceEvents ?? []),
      ...evidence.events,
      ...(observedRoot.current.event ? [observedRoot.current.event] : []),
    ]
  }, [poll, snapshot, evidence.events])
  const proof = useMemo(() => {
    if (!poll || !snapshot) return {valid: false}
    const direct = verifyPollAuthority(poll, allEvidence)
    if (!direct.valid) return direct
    return verifyGroupElectorateEvidence(
      {id: poll.groupId!, creator: snapshot.rootPubkey},
      snapshot,
      allEvidence,
      poll.createdAt
    )
  }, [poll, snapshot, allEvidence])
  // Wait for the latest-known pre-opening list check even if the exact proof arrived first.
  const pending = !!snapshot && evidence.loading
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const embeddedComplete =
    !!snapshot && snapshot.evidenceEventIds.every((id) => bundledIds.has(id))
  return {
    refresh,
    valid:
      proof.valid &&
      !pending &&
      (!evidence.error || embeddedComplete) &&
      !evidence.limited,
    loading: pending,
    reason: proof.reason || evidence.error,
    warning:
      embeddedComplete && evidence.error
        ? "Signed snapshot verified; pre-opening history could not be refreshed."
        : undefined,
    trustListCreatedAt: allEvidence.find(
      (event) => event.id === snapshot?.rootFollowEventId
    )?.created_at,
  }
}
