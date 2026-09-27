import {useGroupAccess} from "../GroupContext"
import {usePublicKey} from "@/stores/user"
import type {NDKEvent} from "@/lib/ndk"
import PollCard from "./PollCard"

const allAccounts = () => true

export default function GroupPoll({event}: {event: NDKEvent}) {
  const access = useGroupAccess()
  const publicKey = usePublicKey()
  return (
    <PollCard
      event={event}
      group={access?.ref}
      canVote={access ? access.canParticipate : !!publicKey}
      isEligible={access?.isEligible ?? allAccounts}
      policyLabel={access?.policyLabel ?? "All accounts"}
    />
  )
}
