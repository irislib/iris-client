import {Session, Invite, serializeSessionState} from "nostr-double-ratchet/src"
import {subscribeToDMNotifications} from "@/utils/notifications"
import {NDKEventFromRawEvent, RawEvent} from "@/utils/nostr"
import {localState, Unsubscribe} from "irisdb/src"
import {Filter, VerifiedEvent} from "nostr-tools"
import {hexToBytes} from "@noble/hashes/utils"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"

const invites = new Map<string, Invite>()
const subscriptions = new Map<string, Unsubscribe>()

let publicKey = ""
let privateKey = ""

export function loadInvites(): Unsubscribe {
  console.log("Loading invites")
  invites.clear() // Clear the existing map before repopulating

  listen()

  localState.get("invites").put({}) // Ensure the invites object exists
  localState.get("invites").on(() => subscribeToDMNotifications())
  return localState.get("invites").forEach((link, path) => {
    const id = path.split("/").pop()!
    if (link && typeof link === "string") {
      try {
        if (!invites.has(id)) {
          const invite = Invite.deserialize(link)
          invites.set(id, invite)
          listen()
        }
      } catch (e) {
        console.error("Failed to deserialize invite:", e)
      }
    }
  })
}

const nostrSubscribe = (filter: Filter, onEvent: (e: VerifiedEvent) => void) => {
  const sub = ndk().subscribe(filter)
  sub.on("event", (event) => {
    onEvent(event as unknown as VerifiedEvent)
  })
  return () => sub.stop()
}

const listen = debounce(() => {
  if (!publicKey) return

  for (const id of invites.keys()) {
    if (!subscriptions.has(id)) {
      const invite = invites.get(id)!
      const decrypt = privateKey
        ? hexToBytes(privateKey)
        : async (cipherText: string, pubkey: string) => {
            if (window.nostr?.nip44) {
              try {
                const result = await window.nostr.nip44.decrypt(pubkey, cipherText)
                if (!result || typeof result !== "string") {
                  throw new Error("Failed to decrypt")
                }
                return result
              } catch (error) {
                console.error("NIP-44 decryption failed:", error)
                throw new Error("Failed to decrypt message")
              }
            }
            throw new Error("No nostr extension or private key")
          }
      const unsubscribe = invite.listen(
        decrypt,
        nostrSubscribe,
        async (session: Session, identity?: string) => {
          const sessionId = `${identity}:${session.name}`
          const existing = await localState
            .get("sessions")
            .get(sessionId)
            .once(undefined, true)
          if (existing) return
          localState
            .get("sessions")
            .get(sessionId)
            .get("state")
            .put(serializeSessionState(session.state))
          subscribeToDMNotifications()
        }
      )
      subscriptions.set(id, unsubscribe)
    }
  }
}, 100)

const publish = debounce(async (invite: Invite) => {
  const event = invite.getEvent() as RawEvent
  await NDKEventFromRawEvent(event).publish()
}, 100)

localState.get("user/privateKey").on(async (pk) => {
  if (pk && typeof pk === "string" && pk !== privateKey) {
    privateKey = pk
  }
})

localState.get("user/publicKey").on(async (pk) => {
  if (pk && typeof pk === "string" && pk !== publicKey) {
    publicKey = pk
    listen()

    // Handle public invite
    const existingPublicInvite = await localState
      .get("invites")
      .get("public")
      .once(undefined, true)
    await maybeCreateInvite(existingPublicInvite, "Public", true)

    // Handle private invite
    const existingPrivateInvite = await localState
      .get("invites")
      .get("private")
      .once(undefined, true)
    await maybeCreateInvite(existingPrivateInvite, "Private", false)

    subscribeToDMNotifications()
  }
})

async function maybeCreateInvite(
  existingInvite: unknown,
  type: "Public" | "Private",
  shouldPublish: boolean
) {
  if (!publicKey) {
    console.error("Cannot create invite: user public key is missing")
    return
  }

  if (
    existingInvite &&
    typeof existingInvite === "string" &&
    existingInvite.includes("sharedSecret")
  ) {
    console.log(`Found existing ${type} invite`)
    try {
      const invite = Invite.deserialize(existingInvite)
      invites.set(type.toLowerCase(), invite)
      if (shouldPublish) {
        setTimeout(() => {
          publish(invite)
        }, 1000)
      }
    } catch (error) {
      console.error(`Failed to deserialize existing ${type} invite:`, error)
      createNewInvite(type, shouldPublish)
    }
  } else {
    createNewInvite(type, shouldPublish)
  }
}

function createNewInvite(type: "Public" | "Private", shouldPublish: boolean) {
  console.log(`Creating ${type} invite with publicKey:`, publicKey ? publicKey.substring(0, 8) + "..." : "none")
  
  if (!publicKey) {
    console.error(`Cannot create ${type} invite: publicKey is missing`)
    return
  }
  
  try {
    const invite = Invite.createNew(publicKey, `${type} Invite`)
    console.log(`Successfully created ${type} invite object`)
    
    // Store in localState
    localState.get("invites").get(type.toLowerCase()).put(invite.serialize())
    console.log(`Stored ${type} invite in localState`)
    
    invites.set(type.toLowerCase(), invite)
    
    if (shouldPublish) {
      publish(invite)
      console.log(`Published ${type} invite`)
    }
  } catch (error) {
    console.error(`Error creating ${type} invite:`, error)
  }
}

export const getInvites = () => invites
