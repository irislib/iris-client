import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"
import {getNdrRuntime} from "@/shared/services/PrivateChats"
const getPubkey = () => useUserStore.getState().publicKey
const deviceState = () => useDevicesStore.getState()
import {AppKeys, type OnEventMeta, type Rumor} from "nostr-double-ratchet"
import {getEventHash} from "nostr-tools"
import {
  DEVICE_LABEL_CONTROL_KIND,
  validPrivateDeviceLabel,
  portableLabel,
  compareDeviceLabel,
  type PrivateDeviceLabel,
} from "./privateDeviceLabelProtocol"
export {DEVICE_LABEL_CONTROL_KIND}
export type {PrivateDeviceLabel}
export function getPrivateDeviceLabels(owner: string): PrivateDeviceLabel[] {
  if (getPubkey() !== owner) return []
  const snapshot = getNdrRuntime()
    .getKnownAppKeysSnapshots()
    .find((item) => item.ownerPubkey === owner)
  if (!snapshot) return []
  return snapshot.appKeys
    .getAllDeviceLabels()
    .filter((item) => snapshot.appKeys.getDevice(item.identityPubkey))
    .map((item) => ({
      type: "device-labels",
      v: 2,
      owner,
      device: item.identityPubkey,
      deviceLabel: portableLabel(item.deviceLabel),
      clientLabel: portableLabel(item.clientLabel),
      updatedAtSecs: item.updatedAt,
    }))
}
export async function mergePrivateDeviceLabels(
  owner: string,
  values: PrivateDeviceLabel[]
): Promise<void> {
  if (getPubkey() !== owner || !deviceState().isCurrentDeviceRegistered)
    throw new Error("Device sync is not ready")
  const runtime = getNdrRuntime()
  const snapshot = runtime
    .getKnownAppKeysSnapshots()
    .find((item) => item.ownerPubkey === owner)
  if (!snapshot) throw new Error("Device list is not ready")
  const appKeys = new AppKeys(
    snapshot.appKeys.getAllDevices(),
    snapshot.appKeys.getAllDeviceLabels()
  )
  let changed = false
  for (const value of values) {
    if (!validPrivateDeviceLabel(value, owner) || !appKeys.getDevice(value.device))
      continue
    const current = appKeys.getDeviceLabels(value.device)
    const order =
      value.updatedAtSecs - (current?.updatedAt ?? -1) ||
      compareDeviceLabel(value.deviceLabel, portableLabel(current?.deviceLabel)) ||
      compareDeviceLabel(value.clientLabel, portableLabel(current?.clientLabel))
    if (order <= 0) continue
    appKeys.setDeviceLabels(
      value.device,
      {
        deviceLabel: value.deviceLabel ?? undefined,
        clientLabel: value.clientLabel ?? undefined,
      },
      value.updatedAtSecs
    )
    changed = true
  }
  if (changed) await runtime.applyTrustedAppKeysSnapshot({...snapshot, appKeys})
}
export async function sendPrivateDeviceLabels(owner: string): Promise<void> {
  const runtime = getNdrRuntime()
  for (const value of getPrivateDeviceLabels(owner)) {
    if (getPubkey() !== owner || !deviceState().isCurrentDeviceRegistered)
      throw new Error("Account changed")
    const event = {
      kind: DEVICE_LABEL_CONTROL_KIND,
      pubkey: owner,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", owner]],
      content: JSON.stringify(value),
    }
    const rumor = {...event, id: getEventHash(event)}
    const accepted = await runtime.sendEvent(owner, rumor)
    if (accepted?.id !== rumor.id) throw new Error("Device name was not queued")
  }
}
export async function receivePrivateDeviceLabel(
  rumor: Rumor,
  meta?: OnEventMeta
): Promise<void> {
  const owner = getPubkey(),
    state = deviceState(),
    sender = meta?.senderDevicePubkey || meta?.fromDeviceId
  if (
    rumor.kind === DEVICE_LABEL_CONTROL_KIND &&
    owner &&
    meta?.senderOwnerPubkey === owner &&
    (!state.sessionManagerReady ||
      !state.appKeysManagerReady ||
      (!state.hasLocalAppKeys && state.lastEventTimestamp <= 0))
  )
    throw new Error("Device list is not ready")
  if (
    !owner ||
    rumor.kind !== DEVICE_LABEL_CONTROL_KIND ||
    meta?.senderOwnerPubkey !== owner ||
    !sender ||
    sender === state.identityPubkey ||
    !state.isCurrentDeviceRegistered ||
    !state.registeredDevices.some((device) => device.identityPubkey === sender) ||
    (rumor.pubkey !== owner && rumor.pubkey !== sender) ||
    rumor.content.length > 2048
  )
    return
  let value: unknown
  try {
    value = JSON.parse(rumor.content)
  } catch {
    return
  }
  if (validPrivateDeviceLabel(value, owner))
    await mergePrivateDeviceLabels(owner, [value])
}
