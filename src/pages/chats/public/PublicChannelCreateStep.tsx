import {AppEvent} from "@/lib/nostr"
import {useUserStore} from "@/stores/user"
import {useNavigate} from "@/navigation"
import {useState, FormEvent} from "react"
import {nostr} from "@/utils/nostrClient"

const PublicChannelCreateStep = () => {
  const navigate = useNavigate()
  const publicKey = useUserStore((state) => state.publicKey)
  const [name, setName] = useState("")
  const [about, setAbout] = useState("")
  const [picture, setPicture] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!name.trim()) {
      setError("Channel name is required")
      return
    }
    if (!publicKey) {
      setError("You need to be logged in to create a channel")
      return
    }
    setIsCreating(true)
    setError(null)
    try {
      const metadata = {
        name,
        about,
        picture,
        relays: [],
      }
      const event = new AppEvent(nostr())
      event.kind = 40
      event.content = JSON.stringify(metadata)
      await event.publish()
      navigate(`/chats/${event.id}`)
    } catch (err) {
      setError("Failed to create channel")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100 flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Create a Public Channel</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="label">
            <span className="label-text">Channel Name</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder="Enter channel name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isCreating}
          />
        </div>
        <div>
          <label className="label">
            <span className="label-text">Description (optional)</span>
          </label>
          <textarea
            className="textarea textarea-bordered w-full"
            placeholder="Enter channel description"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            disabled={isCreating}
          />
        </div>
        <div>
          <label className="label">
            <span className="label-text">Picture URL (optional)</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder="Enter picture URL"
            value={picture}
            onChange={(e) => setPicture(e.target.value)}
            disabled={isCreating}
          />
        </div>
        {error && <div className="text-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={isCreating}>
          {isCreating ? "Creating..." : "Create Channel"}
        </button>
      </form>
    </div>
  )
}

export default PublicChannelCreateStep
