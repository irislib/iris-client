import {getEventHash} from "nostr-tools"
import type {OnEventMeta, Rumor} from "nostr-double-ratchet"
import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"
import {getNdrRuntime} from "@/shared/services/PrivateChats"
const getPubkey = () => useUserStore.getState().publicKey
const deviceState = () => useDevicesStore.getState()
import {
  PRIVATE_CONTACT_CONTROL_KIND,
  buildPrivateContactControl,
  buildPrivateContactRequest,
  parsePrivateContactControl,
  type PrivateContactDocument,
  type PrivateContactControl,
} from "nostr-social-graph/privateContactSyncV2"
import {sendPrivateDeviceLabels} from "./privateDeviceLabels"
import {mergePrivateContacts, queuePrivateContacts} from "./privateContactSync"
export {PRIVATE_CONTACT_CONTROL_KIND}
const replayed = new Map<string, number>()
const replaying = new Map<string, Promise<void>>()
function canSend(owner: string) {
  const state = deviceState()
  return (
    getPubkey() === owner &&
    state.isCurrentDeviceRegistered &&
    state.canSendPrivateMessages &&
    !state.privateMessagingBlocked
  )
}
async function send(owner: string, payload: PrivateContactControl): Promise<boolean> {
  if (!canSend(owner)) return false
  const runtime = getNdrRuntime()
  if (!canSend(owner)) return false
  const event = {
    kind: PRIVATE_CONTACT_CONTROL_KIND,
    pubkey: owner,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", owner]],
    content: JSON.stringify(payload),
  }
  const rumor = {...event, id: getEventHash(event)}
  const accepted = await runtime.sendEvent(owner, rumor)
  return canSend(owner) && accepted?.id === rumor.id
}
/** The shared controller keeps pending documents until this durable NDR handoff succeeds. */
export function sendPrivateContactDocument(
  owner: string,
  document: PrivateContactDocument
): Promise<boolean> {
  return send(owner, buildPrivateContactControl(document))
}
export async function requestPrivateContactSync(owner: string): Promise<void> {
  if (!canSend(owner)) return
  await queuePrivateContacts(owner)
  await sendPrivateDeviceLabels(owner)
  if (!(await send(owner, buildPrivateContactRequest(owner))))
    throw new Error("Private device sync is not ready")
}
export async function receivePrivateContactControl(
  rumor: Rumor,
  meta?: OnEventMeta
): Promise<void> {
  const owner = getPubkey(),
    state = deviceState()
  const sender = meta?.senderDevicePubkey || meta?.fromDeviceId
  if (
    rumor.kind === PRIVATE_CONTACT_CONTROL_KIND &&
    owner &&
    meta?.senderOwnerPubkey === owner &&
    (!state.sessionManagerReady ||
      !state.appKeysManagerReady ||
      (!state.hasLocalAppKeys && state.lastEventTimestamp <= 0))
  )
    throw new Error("Device list is not ready")
  if (
    rumor.kind !== PRIVATE_CONTACT_CONTROL_KIND ||
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
  let payload: PrivateContactControl
  try {
    payload = parsePrivateContactControl(JSON.parse(rumor.content), owner)
  } catch {
    return
  }
  if (payload.type === "private-contact-sync") {
    await mergePrivateContacts(owner, [payload.document])
    return
  }
  const key = `${owner}:${sender}`
  const active = replaying.get(key)
  if (active) {
    await active
    return
  }
  if (Date.now() - (replayed.get(key) ?? 0) < 30_000) return
  const replay = queuePrivateContacts(owner)
    .then(() => sendPrivateDeviceLabels(owner))
    .then(() => {
      replayed.set(key, Date.now())
    })
    .finally(() => {
      replaying.delete(key)
    })
  replaying.set(key, replay)
  await replay
}

let started = false
export function startPrivateContactBridge() {
  if (started) return
  started = true
  let last = ""
  const reconcile = () => {
    const account = getPubkey(),
      state = deviceState()
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
    } else if (!roster) {
      last = ""
    }
  }
  useDevicesStore.subscribe(reconcile)
  useUserStore.subscribe(reconcile)
  window.addEventListener("online", reconcile)
  const timer = setInterval(reconcile, 5000)
  window.addEventListener("pagehide", () => clearInterval(timer), {once: true})
  reconcile()
}
