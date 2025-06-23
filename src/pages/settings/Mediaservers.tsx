import {useSubscriptionStatus} from "@/shared/hooks/useSubscriptionStatus"
import {ChangeEvent, useState, useEffect} from "react"
import {useUserStore} from "@/stores/user"

const BLOSSOM_IRIS_TO = "https://blossom.iris.to"

function getDefaultServers(isSubscriber: boolean) {
  const defaults: {url: string; protocol: "blossom" | "nip96"; isDefault: boolean}[] =
    isSubscriber
      ? [
          {
            url: BLOSSOM_IRIS_TO,
            protocol: "blossom",
            isDefault: true,
          },
        ]
      : [
          {
            url: "https://nostr.build/api/v2/nip96/upload",
            protocol: "nip96",
            isDefault: true,
          },
        ]
  defaults.push({
    url: "https://cdn.nostrcheck.me",
    protocol: "nip96",
    isDefault: true,
  })
  return defaults
}

function stripHttps(url: string) {
  return url.replace(/^https?:\/\//, "")
}

function MediaServers() {
  const {
    mediaservers,
    defaultMediaserver,
    setDefaultMediaserver,
    addMediaserver,
    removeMediaserver,
    setMediaservers,
    ensureDefaultMediaserver,
    publicKey,
  } = useUserStore()
  const [newServer, setNewServer] = useState("")
  const [newProtocol, setNewProtocol] = useState<"blossom" | "nip96">("blossom")
  const {isSubscriber, isLoading} = useSubscriptionStatus(publicKey)

  useEffect(() => {
    if (!isLoading) {
      ensureDefaultMediaserver(isSubscriber)
    }
  }, [isSubscriber, isLoading, ensureDefaultMediaserver])

  function handleDefaultServerChange(e: ChangeEvent<HTMLSelectElement>) {
    const selectedServer = mediaservers.find((s) => s.url === e.target.value)
    if (selectedServer) {
      setDefaultMediaserver(selectedServer)
    }
  }

  function handleAddServer() {
    if (newServer && !mediaservers.some((s) => s.url === newServer)) {
      const serverUrl = newServer.startsWith("http") ? newServer : `https://${newServer}`
      addMediaserver({
        url: serverUrl,
        protocol: newProtocol,
        isDefault: false,
      })
      setNewServer("")
    }
  }

  function handleRemoveServer(url: string) {
    removeMediaserver(url)
    if (defaultMediaserver?.url === url) {
      // Set default to first available server or nostr.build
      const remainingServers = mediaservers.filter((s) => s.url !== url)
      setDefaultMediaserver(remainingServers[0] || getDefaultServers(isSubscriber)[0])
    }
  }

  function handleRestoreDefaults() {
    const defaults = getDefaultServers(isSubscriber)
    setMediaservers(defaults)
    setDefaultMediaserver(defaults[0])
  }

  return (
    <div>
      <h1 className="text-2xl mb-4">Media Servers</h1>
      <div className="flex flex-col gap-4">
        <div>
          <p>Select default media server</p>
          <select
            aria-label="Select default server"
            className="select select-primary mt-2"
            value={defaultMediaserver?.url || ""}
            onChange={handleDefaultServerChange}
          >
            {mediaservers.map((server) => (
              <option key={server.url} value={server.url}>
                {stripHttps(server.url)} ({server.protocol})
              </option>
            ))}
          </select>
        </div>

        <div>
          <p>Add new media server</p>
          <div className="flex gap-2 mt-2">
            <input
              type="url"
              className="input input-bordered flex-1"
              placeholder="server.example.com"
              value={newServer}
              onChange={(e) => setNewServer(e.target.value)}
            />
            <select
              className="select select-bordered"
              value={newProtocol}
              onChange={(e) => setNewProtocol(e.target.value as "blossom" | "nip96")}
            >
              <option value="blossom">Blossom</option>
              <option value="nip96">NIP-96</option>
            </select>
            <button
              className="btn btn-primary"
              onClick={handleAddServer}
              disabled={!newServer}
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <p>Configured media servers</p>
            <button className="btn btn-sm btn-outline" onClick={handleRestoreDefaults}>
              Restore Defaults
            </button>
          </div>
          <div className="flex flex-col gap-2 mt-2">
            {mediaservers.map((server) => (
              <div key={server.url} className="flex items-center gap-2">
                <a
                  href={server.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 link"
                >
                  {stripHttps(server.url)} ({server.protocol})
                </a>
                <button
                  className="btn btn-sm btn-error"
                  onClick={() => handleRemoveServer(server.url)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="text-sm text-gray-500">
          <p>
            <a
              href="https://github.com/hzrd149/blossom"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              Blossom
            </a>{" "}
            is a specification for storing content addressed files on media servers.
          </p>
          <p className="mt-2">
            <a
              href="https://github.com/nostr-protocol/nips/blob/master/96.md"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              NIP-96
            </a>{" "}
            is a Nostr protocol extension for file uploads.
          </p>
        </div>
      </div>
    </div>
  )
}

export default MediaServers
