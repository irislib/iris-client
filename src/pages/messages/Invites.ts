import {Channel, Invite, serializeChannelState} from "nostr-double-ratchet"
import {subscribeToAuthorDMNotifications} from "@/utils/notifications"
import {NDKEventFromRawEvent, RawEvent} from "@/utils/nostr"
import SnortApi, {Subscription} from "@/utils/SnortApi"
import {Filter, VerifiedEvent} from "nostr-tools"
import {hexToBytes} from "@noble/hashes/utils"
import {localState, Unsubscribe} from "irisdb"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"

const inviteLinks = new Map<string, Invite>()
const subscriptions = new Map<string, Unsubscribe>()

let user: {publicKey?: string; privateKey?: string} | null = null

export function getInvites(
  callback: (id: string, inviteLink: Invite) => void
): Unsubscribe {
  inviteLinks.clear() // Clear the existing map before repopulating

  return localState.get("inviteLinks").forEach((link, path) => {
    const id = path.split("/").pop()!
    if (link && typeof link === "string") {
      try {
        const inviteLink = Invite.deserialize(link)
        callback(id, inviteLink)
      } catch (e) {
        console.error(e)
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
  if (user?.publicKey) {
    for (const id of inviteLinks.keys()) {
      if (!subscriptions.has(id)) {
        const inviteLink = inviteLinks.get(id)!
        const decrypt = user.privateKey
          ? hexToBytes(user.privateKey)
          : async (cipherText: string, pubkey: string) => {
              if (window.nostr?.nip44) {
                const result = window.nostr.nip44.decrypt(pubkey, cipherText)
                if (!result || typeof result !== "string") {
                  throw new Error("Failed to decrypt")
                }
                return result as string
              }
              throw new Error("No nostr extension or private key")
            }
        const unsubscribe = inviteLink.listen(
          decrypt,
          nostrSubscribe,
          (channel: Channel, identity?: string) => {
            const channelId = `${identity}:${channel.name}`
            try {
              subscribeToAuthorDMNotifications([channel.state.theirNostrPublicKey])
            } catch (e) {
              console.error("Error subscribing to author DM notifications", e)
            }

            localState
              .get("channels")
              .get(channelId)
              .get("state")
              .put(serializeChannelState(channel.state))
          }
        )
        subscriptions.set(id, unsubscribe)
      }
    }
  }
}, 100)

const subscribeInviteNotifications = debounce(async () => {
  console.log("Checking for missing subscriptions", {
    size: inviteLinks.size,
    links: Array.from(inviteLinks.entries()),
  })

  if (inviteLinks.size === 0) return

  try {
    const subscriptions = await new SnortApi().getSubscriptions()

    const missing = Array.from(inviteLinks.values()).filter(
      (link) =>
        !Object.values(subscriptions).find(
          (sub: Subscription) =>
            sub.filter.kinds?.includes(4) &&
            (sub.filter as any)["#p"]?.includes(link.inviterSessionPublicKey)
        )
    )

    console.log("Processing subscriptions:", {
      inviteLinks: Array.from(inviteLinks.entries()),
      subscriptions,
      missing,
    })

    if (missing.length) {
      const dmSubscription = Object.entries(subscriptions).find(
        ([, sub]) => sub.filter.kinds?.length === 1 && sub.filter.kinds[0] === 4
      )

      if (dmSubscription) {
        const [id, sub] = dmSubscription
        await new SnortApi().updateSubscription(id, {
          filter: {
            ...sub.filter,
            "#p": [
              ...new Set([
                ...((sub.filter as any)["#p"] || []),
                ...missing.map((l) => l.inviterSessionPublicKey),
              ]),
            ],
          },
        })
      } else {
        await new SnortApi().createSubscription({
          kinds: [4],
          "#p": missing.map((l) => l.inviterSessionPublicKey),
        })
      }
    }
  } catch (e) {
    console.error("Error in subscribeInviteNotifications:", e)
  }
}, 100)

getInvites((id, inviteLink) => {
  if (!inviteLinks.has(id)) {
    inviteLinks.set(id, inviteLink)
    listen()
    setTimeout(() => {
      console.log("Triggering subscription check with size:", inviteLinks.size)
      subscribeInviteNotifications()
    }, 0)
  }
})

const publish = debounce(async (invite: Invite) => {
  const event = invite.getEvent() as RawEvent
  await NDKEventFromRawEvent(event).publish()
}, 100)

localState.get("user").on(async (u) => {
  if (u) {
    user = u as {publicKey?: string; privateKey?: string}
    if (!user.publicKey) return
    listen()
    const publicInvite = await localState
      .get("inviteLinks")
      .get("public")
      .once(undefined, true)
    if (publicInvite && typeof publicInvite === "string") {
      const invite = Invite.deserialize(publicInvite)
      setTimeout(() => {
        publish(invite)
      }, 1000)
    } else {
      console.log("Creating public invite")
      const invite = Invite.createNew(user.publicKey, "Public Invite")
      localState.get("inviteLinks").get("public").put(invite.serialize())
      publish(invite)
      console.log("Published public invite", invite)
    }
  }
})
