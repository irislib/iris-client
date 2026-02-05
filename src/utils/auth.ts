import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"

/**
 * Check if user has write access (can sign events)
 * Returns true if user has private key or NIP-07 extension
 */
export function hasWriteAccess(): boolean {
  const {privateKey, nip07Login, linkedDevice} = useUserStore.getState()
  return !!(privateKey || nip07Login || linkedDevice)
}

/**
 * Check if user is in readonly mode
 * Returns true if user is logged in but cannot sign events
 */
export function isReadOnlyMode(): boolean {
  const {publicKey} = useUserStore.getState()
  return !!publicKey && !ndk().signer
}
