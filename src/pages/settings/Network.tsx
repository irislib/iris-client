import {FormEvent, useEffect, useMemo, useState} from "react"
import {RiDeleteBinLine} from "@remixicon/react"
import {Link} from "react-router"

import {DEFAULT_RELAYS} from "@/utils/applesauce"
import {useUserStore} from "@/stores/user"

export function Network() {
  const [connectToRelayUrls, setConnectToRelayUrls] = useState<string[]>([])
  const {relays, setRelays} = useUserStore()

  useEffect(() => {
    if (relays && relays.length > 0) {
      setConnectToRelayUrls(relays)
    } else {
      setConnectToRelayUrls(DEFAULT_RELAYS)
    }
  }, [relays])
  const [newRelayUrl, setNewRelayUrl] = useState("")

  const addRelay = (e: FormEvent) => {
    e.preventDefault()
    let url = newRelayUrl.trim()
    if (!url) return
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
      url = `wss://${url}`
    }
    const newRelays = [...(connectToRelayUrls || []), url]
    setConnectToRelayUrls(newRelays)
    setRelays(newRelays)
    setNewRelayUrl("")
  }

  const removeRelay = (url: string) => {
    const newRelays = connectToRelayUrls.filter((u) => u !== url)
    setConnectToRelayUrls(newRelays)
    setRelays(newRelays)
  }

  const resetDefaults = () => {
    setConnectToRelayUrls(DEFAULT_RELAYS)
    setRelays(DEFAULT_RELAYS)
  }

  const hasDefaultRelays = useMemo(
    () =>
      connectToRelayUrls?.every((url) => DEFAULT_RELAYS.includes(url)) &&
      connectToRelayUrls?.length === DEFAULT_RELAYS.length,
    [connectToRelayUrls]
  )

  return (
    <div>
      <h2 className="text-2xl mb-4">Network</h2>
      <div className="divide-y divide-base-300">
        {connectToRelayUrls?.map((url) => {
          return (
            <div key={url} className="py-2 flex justify-between items-center">
              <Link
                to={`/relay/${url.replace("wss://", "").replace("ws://", "").replace(/\/$/, "")}`}
                className="text-lg font-medium text-primary hover:underline"
              >
                {url.replace("wss://", "").replace(/\/$/, "")}
              </Link>
              <div className="flex items-center gap-4">
                <RiDeleteBinLine
                  className="cursor-pointer"
                  onClick={() => removeRelay(url)}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-4">
        <form onSubmit={addRelay}>
          <input
            type="text"
            placeholder="Add relay"
            className="input input-bordered w-full max-w-xs"
            value={newRelayUrl}
            onChange={(e) => setNewRelayUrl(e.target.value)}
          />
          <button className="btn btn-primary ml-2">Add Relay</button>
        </form>
      </div>
      {!hasDefaultRelays && (
        <div className="mt-4">
          <button className="btn btn-secondary" onClick={resetDefaults}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  )
}
