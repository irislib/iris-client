import {
  searchDoubleRatchetUsers,
  subscribeToDoubleRatchetUsers,
  DoubleRatchetUser,
  getDoubleRatchetUsersCount,
} from "../utils/doubleRatchetUsers"
import {useState, useRef, useEffect, ChangeEvent, FormEvent} from "react"
import {Invite, serializeSessionState} from "nostr-double-ratchet/src"
import QRCodeButton from "@/shared/components/user/QRCodeButton"
import {acceptInvite} from "@/shared/hooks/useInviteFromUrl"
import {UserRow} from "@/shared/components/user/UserRow"
import {RiInformationLine} from "@remixicon/react"
import {NDKEventFromRawEvent} from "@/utils/nostr"
import {getSessions} from "@/utils/chat/Sessions"
import {nip19, VerifiedEvent} from "nostr-tools"
import {getInvites} from "@/utils/chat/Invites"
import {hexToBytes} from "@noble/hashes/utils"
import {useUserStore} from "@/stores/user"
import {useNavigate} from "react-router"
import {localState} from "irisdb/src"
import {ndk} from "@/utils/ndk"

const PrivateChatCreation = () => {
  const navigate = useNavigate()
  const [invites, setInvites] = useState<Map<string, Invite>>(new Map())
  const [inviteInput, setInviteInput] = useState("")
  const [showPublicInfo, setShowPublicInfo] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [searchResults, setSearchResults] = useState<DoubleRatchetUser[]>([])
  const [doubleRatchetCount, setDoubleRatchetCount] = useState(0)
  const labelInputRef = useRef<HTMLInputElement>(null)

  const myPubKey = useUserStore((state) => state.publicKey)
  const myPrivKey = useUserStore((state) => state.privateKey)

  useEffect(() => {
    subscribeToDoubleRatchetUsers()
    if (getSessions().size === 0) {
      navigate("/chats/new", {replace: true})
    }

    const createPrivateInviteIfNeeded = async () => {
      try {
        const existingInvites = getInvites()
        if (!existingInvites.has("private") && myPubKey) {
          console.log("Creating private invite for test")
          const privateInvite = Invite.createNew(myPubKey, "Private Invite")
          localState.get("invites").get("private").put(privateInvite.serialize())

          const updatedInvites = new Map(existingInvites)
          updatedInvites.set("private", privateInvite)
          setInvites(updatedInvites)
        } else {
          setInvites(existingInvites)
        }
      } catch (error) {
        console.error("Error creating private invite:", error)
      }
    }

    createPrivateInviteIfNeeded()

    const unsubscribe = localState.get("invites").on(() => {
      setInvites(getInvites())
    })

    // Update count periodically
    const interval = setInterval(() => {
      setDoubleRatchetCount(getDoubleRatchetUsersCount())
    }, 1000)

    return () => {
      unsubscribe()
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
    // Navigate to chat with the selected user
    navigate("/chats/chat", {state: {id: `${pubkey}:${myPubKey}`}})
  }

  const handleInviteInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value
    setInviteInput(input)

    if (!input || !input.trim() || !myPubKey) {
      return
    }

    try {
      console.log("Processing invite link:", input)
      const invite = Invite.fromUrl(input)
      console.log("Invite parsed successfully")

      const encrypt = myPrivKey
        ? hexToBytes(myPrivKey)
        : async (plaintext: string, pubkey: string) => {
            if (window.nostr?.nip44) {
              return window.nostr.nip44.encrypt(plaintext, pubkey)
            }
            throw new Error("No nostr extension or private key")
          }

      console.log("Accepting invite...")
      const {session, event} = await invite.accept(
        (filter, onEvent) => {
          const sub = ndk().subscribe(filter)
          sub.on("event", (e) => onEvent(e as unknown as VerifiedEvent))
          return () => sub.stop()
        },
        myPubKey,
        encrypt
      )
      console.log("Invite accepted successfully")

      // Publish the event
      const e = NDKEventFromRawEvent(event)
      await e
        .publish()
        .then((res) => console.log("published", res))
        .catch((e) => console.warn("Error publishing event:", e))
      console.log("published event", event)

      const sessionId = `${invite.inviter}:${session.name}`
      console.log("Session ID:", sessionId)

      // Save the session
      try {
        localState
          .get(`sessions/${sessionId}/state`)
          .put(serializeSessionState(session.state))
        console.log("Session saved to localState using direct path")

        localState
          .get("sessions")
          .get(sessionId)
          .get("state")
          .put(serializeSessionState(session.state))
        console.log("Session also saved using nested approach")

        await new Promise((resolve) => setTimeout(resolve, 1000))

        const savedSessions = getSessions()
        console.log("Current sessions:", Array.from(savedSessions.keys()))

        // Navigate to the new chat
        console.log("Navigating to chat with session ID:", sessionId)
        navigate("/chats/chat", {state: {id: sessionId}})
      } catch (error) {
        console.error("Error saving session:", error)
      }
    } catch (error) {
      console.error("Invalid invite link:", error)
    }
  }

  const createInvite = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const privateInvite = Invite.createNew(myPubKey, "Private Invite")
    localState.get("invites/private").put(privateInvite.serialize())

    if (labelInputRef.current) {
      const label = labelInputRef.current.value.trim() || "New Invite Link"
      const newLink = Invite.createNew(myPubKey, label)
      const id = crypto.randomUUID()
      localState.get(`invites/${id}`).put(newLink.serialize())

      const updatedInvites = new Map(invites)
      updatedInvites.set("private", privateInvite)
      updatedInvites.set(id, newLink)
      setInvites(updatedInvites)

      labelInputRef.current.value = "" // Clear the input after creating
    } else {
      const updatedInvites = new Map(invites)
      updatedInvites.set("private", privateInvite)
      setInvites(updatedInvites)
    }
  }

  const deleteInvite = (id: string) => {
    localState.get(`invites/${id}`).put(null)
    invites.delete(id)
    setInvites(new Map(invites))
  }

  const onScanSuccess = (data: string) => {
    acceptInvite(data, myPubKey, myPrivKey, navigate)
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

  const inviteList: [string, Invite][] = Array.from(invites).sort(([idA], [idB]) => {
    if (idA === "public") return -1
    if (idB === "public") return 1
    return 0
  })

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

        <div className="divider">OR</div>

        <div>
          <h2 className="text-xl font-semibold mb-4">Have someone&apos;s invite link?</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              className="input input-bordered w-full md:w-96"
              placeholder="Paste invite link"
              value={inviteInput}
              onChange={handleInviteInput}
            />
            <QRCodeButton
              data=""
              showQRCode={false}
              onScanSuccess={(data) =>
                handleInviteInput({
                  target: {value: data},
                } as ChangeEvent<HTMLInputElement>)
              }
              icon="qr"
            />
          </div>
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-4">Share your invite link</h2>
          <form
            onSubmit={createInvite}
            className="flex flex-wrap items-center gap-2 mb-4"
          >
            <input
              ref={labelInputRef}
              type="text"
              placeholder="Label (optional)"
              className="input input-bordered w-full md:w-64"
            />
            <button type="submit" className="btn btn-primary whitespace-nowrap">
              Create Invite Link
            </button>
          </form>
          <div className="space-y-3">
            {inviteList.map(([id, link]) => (
              <div
                key={id}
                className={`flex flex-col md:flex-row md:items-center justify-between gap-2 px-4 ${
                  id === "public" ? "bg-base-200 py-4 rounded-lg" : ""
                }`}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span>{id === "private" ? "Private Invite" : link.label}</span>
                    {id === "public" && (
                      <button
                        onClick={() => setShowPublicInfo(!showPublicInfo)}
                        className="btn btn-ghost btn-sm md:btn-xs"
                      >
                        <RiInformationLine className="w-5 h-5 md:w-4 md:h-4" />
                      </button>
                    )}
                  </div>
                  {id === "public" && showPublicInfo && (
                    <span className="text-sm text-base-content/70 pr-2">
                      This invite is shown on your profile and lets others start a chat
                      with you. Messages and sender identities are end-to-end encrypted.
                      However, it&apos;s still possible to see that a chat has been
                      initiated with you.
                    </span>
                  )}
                </div>
                <div className="flex gap-4 items-center">
                  <QRCodeButton
                    npub={myPubKey && nip19.npubEncode(myPubKey)}
                    data={link.getUrl()}
                    onScanSuccess={onScanSuccess}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(link.getUrl())}
                    className="btn btn-sm btn-outline"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => deleteInvite(id)}
                    className="btn btn-sm btn-error"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
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
