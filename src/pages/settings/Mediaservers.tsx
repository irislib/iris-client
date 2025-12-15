import {useSubscriptionStatus} from "@/shared/hooks/useSubscriptionStatus"
import {ChangeEvent, useState, useEffect, useRef} from "react"
import {useUserStore} from "@/stores/user"
import {useSettingsStore} from "@/stores/settings"
import {getDefaultServers, stripHttps} from "./mediaservers-utils"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingsInputItem} from "@/shared/components/settings/SettingsInputItem"
import {DefaultImgProxy} from "@/shared/utils/imgproxy"

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
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <SettingsGroup title="Default Server">
            <SettingsGroupItem isLast>
              <div className="flex justify-between items-center">
                <span>Media Server</span>
                <select
                  aria-label="Select default server"
                  className="select select-sm bg-base-200 border-base-content/20"
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
            </SettingsGroupItem>
          </SettingsGroup>

          <SettingsGroup title="Add Server">
            <SettingsGroupItem>
              <div className="flex flex-col space-y-3">
                <div className="flex gap-2">
                  <input
                    type="url"
                    className="bg-base-200 rounded-lg px-3 py-2 text-sm border border-base-content/20 flex-1"
                    placeholder="server.example.com"
                    value={newServer}
                    onChange={(e) => setNewServer(e.target.value)}
                  />
                  <select
                    className="select select-sm bg-base-200 border-base-content/20"
                    value={newProtocol}
                    onChange={(e) =>
                      setNewProtocol(e.target.value as "blossom" | "nip96")
                    }
                  >
                    <option value="blossom">Blossom</option>
                    <option value="nip96">NIP-96</option>
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleAddServer}
                    disabled={!newServer}
                  >
                    Add
                  </button>
                </div>
              </div>
            </SettingsGroupItem>

            <SettingsGroupItem>
              <div className="text-sm text-base-content/70">
                <a
                  href="https://github.com/hzrd149/blossom"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  Blossom
                </a>{" "}
                is a specification for storing content addressed files on media servers.
              </div>
            </SettingsGroupItem>

            <SettingsGroupItem isLast>
              <div className="text-sm text-base-content/70">
                <a
                  href="https://github.com/nostr-protocol/nips/blob/master/96.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  NIP-96
                </a>{" "}
                is a Nostr protocol extension for file uploads.
              </div>
            </SettingsGroupItem>
          </SettingsGroup>

          <SettingsGroup title="Configured Servers">
            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span className="text-sm text-base-content/70">
                  {mediaservers.length} server{mediaservers.length !== 1 ? "s" : ""}
                </span>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleRestoreDefaults}
                >
                  Restore Defaults
                </button>
              </div>
            </SettingsGroupItem>

            {mediaservers.map((server, index) => (
              <SettingsGroupItem
                key={server.url}
                isLast={index === mediaservers.length - 1}
              >
                <div className="flex items-center justify-between">
                  <a
                    href={server.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 link link-primary"
                  >
                    {stripHttps(server.url)} ({server.protocol})
                  </a>
                  <button
                    className="btn btn-sm btn-error ml-4"
                    onClick={() => handleRemoveServer(server.url)}
                  >
                    Remove
                  </button>
                </div>
              </SettingsGroupItem>
            ))}
          </SettingsGroup>

          <SettingsGroup title="Image Proxy">
            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span>Load images via proxy</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={imgproxy.enabled}
                  onChange={(e) => updateImgproxy({enabled: e.target.checked})}
                />
              </div>
            </SettingsGroupItem>

            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span>Fallback to original source</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={imgproxy.fallbackToOriginal}
                  onChange={(e) => updateImgproxy({fallbackToOriginal: e.target.checked})}
                />
              </div>
            </SettingsGroupItem>

            <SettingsInputItem
              label="Proxy URL"
              value={imgproxy.url}
              placeholder={DefaultImgProxy.url}
              onChange={(value) => updateImgproxy({url: value})}
              type="url"
            />

            <SettingsInputItem
              label="Key"
              value={imgproxy.key}
              placeholder={`Default: ${DefaultImgProxy.key.slice(0, 16)}...`}
              onChange={(value) => updateImgproxy({key: value})}
            />

            <SettingsInputItem
              label="Salt"
              value={imgproxy.salt}
              placeholder={`Default: ${DefaultImgProxy.salt.slice(0, 16)}...`}
              onChange={(value) => updateImgproxy({salt: value})}
            />

            <SettingsGroupItem isLast>
              <div className="text-sm text-base-content/70">
                <a
                  href="https://github.com/imgproxy/imgproxy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  imgproxy
                </a>{" "}
                is a server for resizing and converting remote images.
              </div>
            </SettingsGroupItem>
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default MediaServers
