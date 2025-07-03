import {
  searchDoubleRatchetUsers,
  subscribeToDoubleRatchetUsers,
  DoubleRatchetUser,
  getDoubleRatchetUsersCount,
} from "../utils/doubleRatchetUsers"
import {usePrivateChatsStore} from "@/stores/privateChats"
import {UserRow} from "@/shared/components/user/UserRow"
import {Filter, VerifiedEvent} from "nostr-tools"
import {Invite} from "nostr-double-ratchet/src"
import {useUserStore} from "@/stores/user"
import {useState, useEffect} from "react"
import {useNavigate} from "react-router"
import {ndk} from "@/utils/ndk"

const PrivateChatCreation = () => {
  const navigate = useNavigate()
  const {addChat} = usePrivateChatsStore()
  const [searchInput, setSearchInput] = useState("")
  const [searchResults, setSearchResults] = useState<DoubleRatchetUser[]>([])
  const [doubleRatchetCount, setDoubleRatchetCount] = useState(0)
  const [ourDevices, setOurDevices] = useState<Array<{deviceId: string; invite: Invite}>>(
    []
  )
  const myPubKey = useUserStore((state) => state.publicKey)

  useEffect(() => {
    subscribeToDoubleRatchetUsers()

    const interval = setInterval(() => {
      setDoubleRatchetCount(getDoubleRatchetUsersCount())
    }, 1000)

    // Subscribe to our own invites
    if (myPubKey) {
      const nostrSubscribe = (
        filter: Filter,
        onEvent: (event: VerifiedEvent) => void
      ) => {
        console.log("nostrSubscribed to filter", filter)
        const sub = ndk().subscribe(filter)
        sub.on("event", (e) => {
          console.log("nostrSubscribe got evt", e)
          onEvent(e as unknown as VerifiedEvent)})
        return () => sub.stop()
      }

      const unsubscribe = Invite.fromUser(myPubKey, nostrSubscribe, (inv) => {
        console.log("Found invite from ourself:", inv)
        if (inv.deviceId) {
          setOurDevices((devices) => {
            // Check if device already exists
            const exists = devices.some((device) => device.deviceId === inv.deviceId)
            if (!exists) {
              return [...devices, {deviceId: inv.deviceId!, invite: inv}]
            }
            return devices
          })
        }
      })

      return () => {
        clearInterval(interval)
        unsubscribe()
      }
    }

    return () => {
      clearInterval(interval)
    }
  }, [navigate, myPubKey])

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (!value.trim()) {
      setSearchResults([])
      return
    }
    const results = searchDoubleRatchetUsers(value)
    setSearchResults(results.slice(0, 10))
  }

  const handleStartChat = (pubkey: string) => {
    addChat(pubkey)
    navigate("/chats/chat", {state: {id: pubkey}})
  }

  if (!myPubKey) {
    return (
      <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100">
        <p className="text-center text-base-content/70">
          Please sign in to use private chats
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100 flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold mb-4">Search Users</h2>
          <div className="flex flex-col gap-4">
            <div>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Search for users"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            <p className="text-sm text-base-content/70">
              {doubleRatchetCount} followed users have enabled secure DMs
            </p>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {searchResults.map((user) => (
                <button
                  key={user.pubkey}
                  className="btn btn-ghost justify-start text-left"
                  onClick={() => handleStartChat(user.pubkey)}
                >
                  <UserRow pubKey={user.pubkey} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Our Devices Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Our Devices</h2>
          {ourDevices.length > 0 ? (
            <div className="flex flex-col gap-2">
              {ourDevices.map((device) => (
                <div
                  key={device.deviceId}
                  className="flex items-center justify-between p-3 bg-base-200 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                      <span className="text-primary-content text-sm">📱</span>
                    </div>
                    <div>
                      <p className="font-medium">{device.deviceId}</p>
                      <p className="text-sm text-base-content/70">Device ID</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-base-content/70">
                      {device.invite.maxUses
                        ? `${device.invite.usedBy.length}/${device.invite.maxUses} uses`
                        : "Unlimited uses"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-base-content/70 text-center py-4">
              No devices found. Devices will appear here when they publish their invites.
            </p>
          )}
        </div>
      </div>
      <hr className="mx-4 my-6 border-base-300" />
      <div className="px-2">
        <p className="text-center text-sm text-base-content/70">
          Iris uses Signal-style{" "}
          <a
            href="https://github.com/mmalmi/nostr-double-ratchet"
            target="_blank"
            className="link"
            rel="noreferrer"
          >
            double ratchet encryption
          </a>{" "}
          to keep your private messages safe.
        </p>
        <p className="text-center text-sm text-base-content/70">
          Private chat history is stored locally on this device and cleared when you log
          out.
        </p>
      </div>
    </>
  )
}

export default PrivateChatCreation
