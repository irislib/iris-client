import {RiStarFill} from "@remixicon/react"
import {useContactMemory} from "@/shared/hooks/useContactMemory"
import {useContactMemoryStore} from "@/stores/contactMemory"
import {useUserStore} from "@/stores/user"
import {pendingContactName} from "@/utils/contactMemory"

export function ContactMemoryControls({
  pubkey,
  showFavorite = false,
}: {
  pubkey: string
  showFavorite?: boolean
}) {
  const account = useUserStore((state) => state.publicKey)
  const memory = useContactMemory(pubkey)
  const latestName = useContactMemoryStore((state) => state.latestNames[pubkey]?.name)
  const proposedName = memory ? pendingContactName(memory, latestName ?? null) : null

  if (!account || account === pubkey) return null

  return (
    <div className="flex flex-col gap-3 text-sm">
      {showFavorite && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-pressed={memory?.favorite ?? false}
            onClick={() =>
              useContactMemoryStore
                .getState()
                .setFavorite(account, pubkey, !memory?.favorite)
            }
          >
            <RiStarFill
              className={`w-5 h-5 ${memory?.favorite ? "text-warning" : "opacity-40"}`}
            />
            {memory?.favorite ? "Favorited" : "Favorite"}
          </button>
          <span className="text-base-content/60">Only you can see this</span>
        </div>
      )}
      {showFavorite &&
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
