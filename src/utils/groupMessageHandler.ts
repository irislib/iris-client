import {getEventHash} from "nostr-tools"

import {SenderKeyState, OneToManyChannel} from "nostr-double-ratchet"

import {ndk} from "@/utils/ndk"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {getTag} from "@/utils/tagUtils"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useUserStore} from "@/stores/user"
import {useGroupSenderKeysStore} from "@/stores/groupSenderKeys"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let unsubscribeOuterMessages: (() => void) | null = null
let unsubscribeSenderStore: (() => void) | null = null
let activeAuthorsKey = ""

const channel = OneToManyChannel.default()
const senderQueues = new Map<string, Promise<void>>()

type OuterLike = {
  pubkey?: unknown
  content?: unknown
  tags?: unknown
}

type RumorLike = {
  content?: unknown
  kind?: unknown
  created_at?: unknown
  pubkey?: unknown
  tags?: unknown
  id?: unknown
}

const stopOuterSubscription = () => {
  unsubscribeOuterMessages?.()
  unsubscribeOuterMessages = null
  activeAuthorsKey = ""
}

const ensurePlaceholderGroup = (groupId: string, myPubkey: string) => {
  if (!groupId) return
  const {groups, addGroup} = useGroupsStore.getState()
  if (groups[groupId]) return
  addGroup({
    id: groupId,
    name: `Group ${groupId.slice(0, 8)}`,
    description: "",
    picture: "",
    members: [myPubkey],
    admins: [myPubkey],
    createdAt: Date.now(),
    accepted: true,
  })
}

const handleOuterEvent = async (outer: unknown) => {
  try {
    if (!outer || typeof outer !== "object") return
    const outerObj = outer as OuterLike

    const senderEventPubkey = outerObj.pubkey
    const content = outerObj.content
    if (typeof senderEventPubkey !== "string" || typeof content !== "string") return

    const record = useGroupSenderKeysStore.getState().senders[senderEventPubkey]
    if (!record) return

    // Safety: ignore 1:1 double-ratchet wrapper events (they contain a "header" tag).
    if (
      Array.isArray(outerObj.tags) &&
      outerObj.tags.some((t) => Array.isArray(t) && t[0] === "header")
    ) {
      return
    }

    const parsed = channel.parseOuterContent(content)
    const keyIdStr = String(parsed.keyId >>> 0)
    const stateJson = record.keys[keyIdStr]
    if (!stateJson) return

    const senderKeyState = SenderKeyState.fromJSON(stateJson)

    let plaintext: string
    try {
      plaintext = parsed.decrypt(senderKeyState)
    } catch (e) {
      // Expected in duplicate/out-of-order edge cases; keep noise down.
      return
    }

    let rumor: unknown
    try {
      rumor = JSON.parse(plaintext)
    } catch {
      return
    }

    if (!rumor || typeof rumor !== "object") return
    const rumorObj = rumor as RumorLike
    if (typeof rumorObj.content !== "string") return
    if (typeof rumorObj.kind !== "number" || !Number.isFinite(rumorObj.kind)) return
    if (
      typeof rumorObj.created_at !== "number" ||
      !Number.isFinite(rumorObj.created_at)
    ) {
      return
    }
    if (typeof rumorObj.pubkey !== "string") return
    if (!Array.isArray(rumorObj.tags)) return

    // Trustless: recompute derived ID.
    const rumorEvent = rumorObj as unknown as {
      content: string
      kind: number
      created_at: number
      tags: string[][]
      pubkey: string
      id: string
    }
    rumorEvent.id = getEventHash(rumorEvent)

    const myPubkey = useUserStore.getState().publicKey
    if (!myPubkey) return

    const groupId = getTag("l", rumorEvent.tags) || record.groupId
    if (!groupId) return

    ensurePlaceholderGroup(groupId, myPubkey)

    await usePrivateMessagesStore.getState().upsert(groupId, myPubkey, {
      ...rumorEvent,
      ownerPubkey: rumorEvent.pubkey,
    })

    // Persist updated sender key state.
    useGroupSenderKeysStore
      .getState()
      .updateRemoteSenderState(senderEventPubkey, parsed.keyId, senderKeyState.toJSON())
  } catch (e) {
    error("Failed to handle group outer event:", e)
  }
}

const enqueueOuterEvent = (outer: unknown) => {
  const senderEventPubkey =
    outer && typeof outer === "object"
      ? (outer as Record<string, unknown>).pubkey
      : undefined
  if (typeof senderEventPubkey !== "string") return

  const prev = senderQueues.get(senderEventPubkey) ?? Promise.resolve()
  const next = prev
    .then(() => handleOuterEvent(outer))
    .catch(() => {})
    .finally(() => {
      if (senderQueues.get(senderEventPubkey) === next) {
        senderQueues.delete(senderEventPubkey)
      }
    })

  senderQueues.set(senderEventPubkey, next)
}

const startOuterSubscription = () => {
  const authors = Object.keys(useGroupSenderKeysStore.getState().senders).sort()
  const nextKey = authors.join(",")
  if (nextKey === activeAuthorsKey) return

  stopOuterSubscription()
  if (authors.length === 0) return

  activeAuthorsKey = nextKey
  log("Subscribing to group sender-key outer events:", authors.length)

  const sub = ndk().subscribe({
    kinds: [channel.outerEventKind()],
    authors,
  })

  sub.on("event", (event: unknown) => {
    enqueueOuterEvent(event)
  })

  unsubscribeOuterMessages = () => sub.stop()
}

export const cleanupGroupMessageListener = () => {
  stopOuterSubscription()
  unsubscribeSenderStore?.()
  unsubscribeSenderStore = null
}

export const attachGroupMessageListener = () => {
  if (unsubscribeSenderStore) return

  // Keep the outer subscription in sync with sender key distributions received via 1:1 sessions.
  unsubscribeSenderStore = useGroupSenderKeysStore.subscribe(() => {
    startOuterSubscription()
  })

  startOuterSubscription()
}
