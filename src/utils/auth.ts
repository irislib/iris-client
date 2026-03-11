import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"

type WriteAccessState = {
  privateKey?: string
  nip07Login?: boolean
  linkedDevice?: boolean
  publicKey?: string
}

export function hasWriteAccessForState(state: WriteAccessState): boolean {
  return !!(state.privateKey || state.nip07Login || state.linkedDevice)
}

/**
 * Check if user has write access (can sign events)
 * Returns true if user has private key or NIP-07 extension
 */
export function hasWriteAccess(): boolean {
  return hasWriteAccessForState(useUserStore.getState())
}

export function shouldStartPrivateMessagingOnAuthChange(
  state: WriteAccessState,
  prevState: WriteAccessState
): boolean {
  return !!(
    state.publicKey &&
    !hasWriteAccessForState(prevState) &&
    hasWriteAccessForState(state)
  )
}

/**
 * Check if user is in readonly mode
 * Returns true if user is logged in but cannot sign events
 */
export function isReadOnlyMode(): boolean {
  const {publicKey} = useUserStore.getState()
  return !!publicKey && !ndk().signer
}
