import {useUserStore} from "@/stores/user"
import {ChangeEvent} from "react"

function MediaServers() {
  const {mediaserver: selectedServer, setMediaserver: setSelectedServer} = useUserStore()

  function handleServerChange(e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) {
    setSelectedServer(e.target.value)
  }

  return (
    <div>
      <h1 className="text-2xl mb-4">Media Servers</h1>
      <div className="flex flex-col gap-4">
        <div>
          <p>Select a NIP96 media provider</p>
          <select
            aria-label="Select a server"
            className="select select-primary mt-2"
            value={selectedServer}
            onChange={handleServerChange}
          >
            <option value="https://nostr.build/api/v2/nip96/upload">
              https://nostr.build
            </option>
            <option value="https://cdn.nostrcheck.me">https://nostrcheck.me</option>
          </select>
        </div>
        <div>
          <p>Server URL</p>
          <input
            type="url"
            required
            className="input input-bordered mt-2 text-lg w-full"
            placeholder="https://cdn.nostrcheck.me"
            value={selectedServer}
            onChange={handleServerChange}
          />
          <p className="text-sm text-gray-500 mt-1">
            You can specify a custom mediaserver URL, see{" "}
            <a
              href="https://github.com/aljazceru/awesome-nostr?tab=readme-ov-file#nip-96-file-storage-servers"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              here
            </a>{" "}
            for more info.
          </p>
        </div>
      </div>
    </div>
  )
}

export default MediaServers
