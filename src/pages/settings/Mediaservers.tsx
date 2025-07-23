import {useSubscriptionStatus} from "@/shared/hooks/useSubscriptionStatus"
import {ChangeEvent, useState, useEffect, useRef} from "react"
import {useUserStore} from "@/stores/user"
import {useSettingsStore} from "@/stores/settings"
import {getDefaultServers, stripHttps} from "./mediaservers-utils"

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
  const {imgproxy, updateImgproxy} = useSettingsStore()
  const [newServer, setNewServer] = useState("")
  const [newProtocol, setNewProtocol] = useState<"blossom" | "nip96">("blossom")
  const {isSubscriber, isLoading} = useSubscriptionStatus(publicKey)
  const prevIsSubscriber = useRef(isSubscriber)

  useEffect(() => {
    if (!isLoading) {
      ensureDefaultMediaserver(isSubscriber)
    }
  }, [isSubscriber, isLoading, ensureDefaultMediaserver])

  useEffect(() => {
    if (!isLoading && prevIsSubscriber.current !== isSubscriber) {
      const defaults = getDefaultServers(isSubscriber)
      setMediaservers(defaults)
      setDefaultMediaserver(defaults[0])
      prevIsSubscriber.current = isSubscriber
    }
  }, [isSubscriber, isLoading, setMediaservers, setDefaultMediaserver])

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

        <div className="divider"></div>

        <div>
          <h2 className="text-xl mb-4">Image Proxy Settings</h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={imgproxy.enabled}
                  onChange={(e) => updateImgproxy({enabled: e.target.checked})}
                />
                Load images via proxy (enabled by default)
              </label>
            </div>

            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={imgproxy.fallbackToOriginal}
                  onChange={(e) => updateImgproxy({fallbackToOriginal: e.target.checked})}
                />
                If image proxy fails, load from original source (enabled by default)
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Proxy URL</label>
              <input
                type="url"
                className="input input-bordered w-full"
                placeholder="https://imgproxy.coracle.social"
                value={imgproxy.url}
                onChange={(e) => updateImgproxy({url: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Key (optional)</label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Leave empty for default coracle.social server"
                value={imgproxy.key}
                onChange={(e) => updateImgproxy({key: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Salt (optional)</label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Leave empty for default coracle.social server"
                value={imgproxy.salt}
                onChange={(e) => updateImgproxy({salt: e.target.value})}
              />
            </div>
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
