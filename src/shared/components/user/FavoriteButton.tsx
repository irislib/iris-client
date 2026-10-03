import {RiStarFill} from "@remixicon/react"
import {useState} from "react"
import {useContactMemory} from "@/shared/hooks/useContactMemory"
import {useUserStore} from "@/stores/user"
import {editPrivateContact} from "@/utils/privateContactSync"

export function FavoriteButton({pubkey}: {pubkey: string}) {
  const account = useUserStore((state) => state.publicKey)
  const memory = useContactMemory(pubkey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  if (!account || account === pubkey) return null

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="btn btn-circle btn-neutral"
        aria-label={memory?.favorite ? "Favorited" : "Favorite"}
        aria-pressed={memory?.favorite ?? false}
        title="Favorite · Only you can see this"
        disabled={saving}
        onClick={async () => {
          setSaving(true)
          setError("")
          try {
            await editPrivateContact(pubkey, {favorite: !memory?.favorite})
          } catch {
            setError("Could not save. Try again.")
          } finally {
            setSaving(false)
          }
        }}
      >
        <RiStarFill
          aria-hidden="true"
          className={`w-5 h-5 ${memory?.favorite ? "text-warning" : "opacity-40"}`}
        />
      </button>
      {error && (
        <p
          role="alert"
          className="absolute top-full left-0 z-10 mt-2 w-48 rounded bg-base-100 p-2 text-sm text-error shadow"
        >
          {error}
        </p>
      )}
    </div>
  )
}
