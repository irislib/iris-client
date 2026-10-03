import {useContactMemory} from "@/shared/hooks/useContactMemory"
import {useContactMemoryStore} from "@/stores/contactMemory"
import {useUserStore} from "@/stores/user"
import {pendingContactName} from "@/utils/contactMemory"
import {PrivateContactDetails} from "./PrivateContactDetails"

export function ContactMemoryControls({
  pubkey,
  showDetails = false,
}: {
  pubkey: string
  showDetails?: boolean
}) {
  const account = useUserStore((state) => state.publicKey)
  const memory = useContactMemory(pubkey)
  const latestName = useContactMemoryStore((state) => state.latestNames[pubkey]?.name)
  const proposedName = memory ? pendingContactName(memory, latestName ?? null) : null

  if (!account || account === pubkey) return null

  return (
    <div className="flex flex-col gap-3 text-sm">
      {showDetails && (
        <PrivateContactDetails
          key={`${account}:${pubkey}`}
          pubkey={pubkey}
          nickname={memory?.nickname}
          note={memory?.note}
        />
      )}
      {showDetails &&
        memory?.first_seen_name &&
        memory.first_seen_name !== memory.accepted_name && (
          <p className="text-base-content/60">First known as {memory.first_seen_name}</p>
        )}
      {proposedName && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="contact-name-change"
          role="status"
        >
          <span className="min-w-0 break-words">
            {memory?.accepted_name} now goes by <strong>{proposedName}</strong>.
          </span>
          <button
            type="button"
            className="btn btn-sm btn-neutral"
            onClick={() =>
              useContactMemoryStore.getState().approveName(account, pubkey, proposedName)
            }
          >
            Use new name
          </button>
        </div>
      )}
    </div>
  )
}
