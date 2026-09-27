import {useMemo} from "react"
import {verifyGroupElectorateEvidence} from "../model"
import {useGroupEvents} from "../useGroupEvents"
import {verifyPollAuthority, type Poll} from "../polls"

/** A poll author cannot manufacture trusted votes by merely labeling keys as trusted. */
export default function usePollAuthority(poll: Poll | null) {
  const snapshot = poll?.electorate
  const evidence = useGroupEvents(
    snapshot
      ? [
          {ids: snapshot.evidenceEventIds, limit: snapshot.evidenceEventIds.length},
          {kinds: [3], authors: [snapshot.rootPubkey], until: poll!.createdAt, limit: 1},
        ]
      : [],
    (snapshot?.evidenceEventIds.length ?? 0) + 2
  )
  const proof = useMemo(() => {
    if (!poll || !snapshot) return {valid: false}
    const direct = verifyPollAuthority(poll, evidence.events)
    if (!direct.valid) return direct
    return verifyGroupElectorateEvidence(
      {id: poll.groupId!, creator: snapshot.rootPubkey},
      snapshot,
      evidence.events,
      poll.createdAt
    )
  }, [poll, snapshot, evidence.events])
  // Wait for the latest-known pre-opening list check even if the exact proof arrived first.
  const pending = !!snapshot && evidence.loading
  return {
    valid: proof.valid && !pending && !evidence.error && !evidence.limited,
    loading: pending,
    reason: evidence.error || proof.reason,
  }
}
