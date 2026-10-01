import {getEventHash} from "nostr-tools"
import type {OnEventMeta, Rumor} from "nostr-double-ratchet"
import {
  validatePrivateContactDocument,
  type PrivateContactDocument,
} from "nostr-social-graph/privateContactSync"
import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"
const getPubkey = () => useUserStore.getState().publicKey
import {getNdrRuntime} from "@/shared/services/PrivateChats"
import {getPrivateContactDocuments, mergePrivateContacts} from "./privateContactSync"

export const PRIVATE_CONTACT_CONTROL_KIND = 10451
const replayed = new Map<string, number>()
const pending = new Map<string, {owner: string; document: PrivateContactDocument}>()
let sending: Promise<void> | undefined
let retry: ReturnType<typeof setTimeout> | undefined

function canSend(owner: string) {
  return (
    getPubkey() === owner &&
    useDevicesStore.getState().canSendPrivateMessages &&
    !useDevicesStore.getState().privateMessagingBlocked
  )
}
async function send(owner: string, payload: object) {
  const runtime = getNdrRuntime()
  if (!canSend(owner)) throw new Error("Private device sync is not ready")
  const event = {
    kind: PRIVATE_CONTACT_CONTROL_KIND,
    pubkey: owner,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", owner]],
    content: JSON.stringify(payload),
  }
  await runtime.sendEvent(owner, {...event, id: getEventHash(event)})
}
function drain(): Promise<void> {
  if (sending) return sending
  const run = (async () => {
    clearTimeout(retry)
    retry = undefined
    try {
      for (const [key, item] of pending) {
        if (getPubkey() !== item.owner) {
          pending.delete(key)
          continue
        }
        await send(item.owner, {
          type: "private-contact-sync",
          v: 1,
          document: item.document,
        })
        if (pending.get(key) === item) pending.delete(key)
      }
    } catch {
      // The core document is already durable; retry until NDR can durably queue its sibling copy.
      retry = setTimeout(() => {
        void drain()
      }, 5000)
    }
  })()
  sending = run.finally(() => {
    sending = undefined
    if (pending.size && !retry)
      retry = setTimeout(() => {
        void drain()
      }, 0)
  })
  return sending
}
export function sendPrivateContactDocument(
  owner: string,
  document: PrivateContactDocument
) {
  pending.set(`${owner}:${document.contact}`, {owner, document})
  return drain()
}
export async function requestPrivateContactSync(owner: string) {
  if (!canSend(owner)) return
  await send(owner, {type: "private-contact-sync", v: 1, request: true})
  for (const document of getPrivateContactDocuments()) {
    if (!canSend(owner)) return
    await sendPrivateContactDocument(owner, document)
  }
}
export async function receivePrivateContactControl(rumor: Rumor, meta?: OnEventMeta) {
  const owner = getPubkey(),
    state = useDevicesStore.getState()
  const sender = meta?.senderDevicePubkey || meta?.fromDeviceId
  if (
    !owner ||
    meta?.senderOwnerPubkey !== owner ||
    !sender ||
    sender === state.identityPubkey ||
    !state.isCurrentDeviceRegistered ||
    !state.registeredDevices.some((device) => device.identityPubkey === sender) ||
    (rumor.pubkey !== owner && rumor.pubkey !== sender) ||
    rumor.content.length > 32_000
  )
    return
  let payload
  try {
    payload = JSON.parse(rumor.content)
  } catch {
    return
  }
  if (payload?.type !== "private-contact-sync" || payload.v !== 1) return
  if (payload.request === true && payload.document === undefined) {
    const key = `${owner}:${sender}`
    if (Date.now() - (replayed.get(key) ?? 0) < 30_000) return
    replayed.set(key, Date.now())
    for (const document of getPrivateContactDocuments()) {
      if (!canSend(owner)) return
      await sendPrivateContactDocument(owner, document)
    }
  } else if (payload.request === undefined && payload.document !== undefined) {
    try {
      validatePrivateContactDocument(payload.document, owner)
    } catch {
      return
    }
    await mergePrivateContacts(owner, [payload.document])
  }
}

let started = false
export function startPrivateContactBridge() {
  if (started) return
  started = true
  let last = ""
  const reconcile = () => {
    const account = getPubkey(),
      state = useDevicesStore.getState()
    const roster = canSend(account)
      ? `${account}:${state.registeredDevices
          .map((device) => device.identityPubkey)
          .sort()
          .join(",")}`
      : ""
    if (roster && roster !== last) {
      last = roster
      void requestPrivateContactSync(account).catch(() => {
        last = ""
      })
    }
    if (!roster) last = ""
  }
  useDevicesStore.subscribe(reconcile)
  useUserStore.subscribe(reconcile)
  reconcile()
}
