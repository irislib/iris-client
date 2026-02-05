import type {DeviceEntry} from "nostr-double-ratchet/src"

export function isOwnDevicePubkey(
  pubkey: string,
  ownerPubkey: string,
  identityPubkey: string | null,
  devices: DeviceEntry[]
): boolean {
  if (!pubkey) return false
  if (pubkey === ownerPubkey) return true
  if (identityPubkey && pubkey === identityPubkey) return true
  return devices.some((device) => device.identityPubkey === pubkey)
}

export function isOwnDeviceEvent(
  eventPubkey: string,
  sessionPubkey: string,
  ownerPubkey: string,
  identityPubkey: string | null,
  devices: DeviceEntry[]
): boolean {
  return (
    isOwnDevicePubkey(eventPubkey, ownerPubkey, identityPubkey, devices) ||
    isOwnDevicePubkey(sessionPubkey, ownerPubkey, identityPubkey, devices)
  )
}
