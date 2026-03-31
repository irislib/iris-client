import {useUserStore} from "@/stores/user"
import {isInjectedHtreeChildRuntime} from "@/utils/nativeHtree"

type InjectedNip07State = {
  publicKey?: string
  privateKey?: string
  nip07Login?: boolean
  linkedDevice?: boolean
  setPublicKey: (publicKey: string) => void
  setNip07Login: (nip07Login: boolean) => void
  setLinkedDevice: (linkedDevice: boolean) => void
}

type InjectedNip07Runtime = {
  injectedChildRuntime: boolean
  hasNostr: boolean
}

type MaybeAutoEnableInjectedNip07LoginOptions = {
  getState?: () => InjectedNip07State
  injectedChildRuntime?: boolean
  getPublicKey?: () => Promise<string | null | undefined>
}

function hasAuthState(state: Pick<InjectedNip07State, "publicKey" | "privateKey" | "nip07Login" | "linkedDevice">): boolean {
  return Boolean(
    state.publicKey?.trim() ||
      state.privateKey?.trim() ||
      state.nip07Login ||
      state.linkedDevice
  )
}

export function shouldAutoEnableInjectedNip07Login(
  state: Pick<InjectedNip07State, "publicKey" | "privateKey" | "nip07Login" | "linkedDevice">,
  runtime: InjectedNip07Runtime
): boolean {
  return runtime.injectedChildRuntime && runtime.hasNostr && !hasAuthState(state)
}

export async function maybeAutoEnableInjectedNip07Login(
  options: MaybeAutoEnableInjectedNip07LoginOptions = {}
): Promise<boolean> {
  const getState = options.getState ?? (() => useUserStore.getState())
  const injectedChildRuntime =
    options.injectedChildRuntime ?? isInjectedHtreeChildRuntime()
  const getPublicKey =
    options.getPublicKey ??
    (() =>
      typeof window !== "undefined" && window.nostr?.getPublicKey
        ? window.nostr.getPublicKey()
        : Promise.resolve(null))

  const initialState = getState()
  if (
    !shouldAutoEnableInjectedNip07Login(initialState, {
      injectedChildRuntime,
      hasNostr: typeof getPublicKey === "function",
    })
  ) {
    return false
  }

  const publicKey = (await getPublicKey())?.trim()
  if (!publicKey) return false

  const latestState = getState()
  if (
    !shouldAutoEnableInjectedNip07Login(latestState, {
      injectedChildRuntime,
      hasNostr: true,
    })
  ) {
    return false
  }

  latestState.setPublicKey(publicKey)
  latestState.setNip07Login(true)
  latestState.setLinkedDevice(false)
  return true
}
