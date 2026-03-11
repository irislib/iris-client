import {nip19} from "nostr-tools"

export const formatManagedDevicePubkey = (devicePubkey: string) => {
  if (devicePubkey.startsWith("npub")) {
    return devicePubkey
  }

  try {
    return nip19.npubEncode(devicePubkey)
  } catch {
    return devicePubkey
  }
}
