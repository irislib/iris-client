import {hexToBytes} from "@noble/hashes/utils"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  AppKeysManager,
  DelegateManager,
  Invite,
  INVITE_RESPONSE_KIND,
  NdrRuntime,
  decryptInviteResponse,
  type NdrRuntimeState,
  type NostrFetch,
  type NostrPublish,
  type NostrSubscribe,
  type PreparedRegistration,
  type PreparedRevocation,
} from "nostr-double-ratchet"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import type {VerifiedEvent} from "nostr-tools"
import {ndk} from "@/utils/ndk"
import {useUserStore} from "../../stores/user"
import {useDevicesStore} from "../../stores/devices"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {
  attachNdrRuntimeEventListener,
  cleanupNdrRuntimeEventListener,
} from "@/utils/dmEventHandler"
import {
  attachGroupMessageListener,
  cleanupGroupMessageListener,
} from "@/utils/groupMessageHandler"
import {
  getCurrentDeviceRegistrationLabels,
  getLinkedDeviceRegistrationLabels,
} from "./deviceLabels"
import {createRuntimeSubscribe} from "./runtimeSubscribe"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const APP_KEYS_FETCH_TIMEOUT_MS = 10000
const APP_KEYS_FAST_TIMEOUT_MS = 2000
const RUNTIME_USER_SETUP_SYNC_MS = 500

let runtime: NdrRuntime | null = null
let runtimeCleanup: (() => void) | null = null
let runtimeOwnerIdentityKeyHex: string | null = null
let runtimeUserSetupPoller: ReturnType<typeof setInterval> | null = null
let privateMessagingAvailable = true
const runtimeUserSetupInFlight = new Set<string>()

type RuntimeUserRecord =
  ReturnType<NdrRuntime["getSessionUserRecords"]> extends Map<string, infer Record>
    ? Record
    : never

const syncDeviceStoreFromRuntime = (state: NdrRuntimeState): void => {
  const store = useDevicesStore.getState()
  if (state.currentDevicePubkey) {
    store.setIdentityPubkey(state.currentDevicePubkey)
  }
  store.setAppKeysManagerReady(state.appKeysManagerReady)
  store.setSessionManagerReady(state.sessionManagerReady)
  store.setHasLocalAppKeys(state.hasLocalAppKeys)
  store.setRegisteredDevices(state.registeredDevices, state.lastAppKeysCreatedAt)
}

const createSubscribe = (ndkInstance: NDK): NostrSubscribe => {
  return createRuntimeSubscribe(ndkInstance)
}

export const getNostrSubscribe = (): NostrSubscribe => {
  return createSubscribe(ndk())
}

const createFetch = (ndkInstance: NDK): NostrFetch => {
  return async (filter) => {
    const events = await ndkInstance.fetchEvents(filter)
    return Array.from(events).map((event) => event.rawEvent() as VerifiedEvent)
  }
}

const createPublish = (ndkInstance: NDK): NostrPublish => {
  return (async (event, innerEventId) => {
    const e = new NDKEvent(ndkInstance, event)
    await e.publish()

    if (innerEventId) {
      const {events, updateMessage} = usePrivateMessagesStore.getState()
      for (const [chatId, messageMap] of events.entries()) {
        const existing = messageMap.get(innerEventId)
        if (!existing) continue

        const updates: Partial<typeof existing> = {sentToRelays: true}
        if (!existing.nostrEventId) {
          updates.nostrEventId = e.id
        }

        await updateMessage(chatId, innerEventId, updates)
        break
      }
    }

    return event
  }) as NostrPublish
}

const getOwnerIdentityKeyHex = (): string | null => {
  const {privateKey, linkedDevice} = useUserStore.getState()
  if (linkedDevice) {
    return null
  }
  return privateKey?.trim() ? privateKey.trim() : null
}

const closeRuntime = (): void => {
  if (runtimeUserSetupPoller) {
    clearInterval(runtimeUserSetupPoller)
    runtimeUserSetupPoller = null
  }
  runtimeUserSetupInFlight.clear()
  runtimeCleanup?.()
  runtimeCleanup = null
  runtime?.close()
  runtime = null
  runtimeOwnerIdentityKeyHex = null
}

export const closePrivateMessaging = (): void => {
  cleanupNdrRuntimeEventListener()
  cleanupGroupMessageListener()
  closeRuntime()
}

const getRuntime = (): NdrRuntime => {
  if (!privateMessagingAvailable) {
    throw new Error("Private messaging is active in another tab")
  }
  const ownerIdentityKeyHex = getOwnerIdentityKeyHex()

  if (runtime && runtimeOwnerIdentityKeyHex === ownerIdentityKeyHex) {
    return runtime
  }

  closeRuntime()

  runtime = new NdrRuntime({
    nostrSubscribe: createSubscribe(ndk()),
    nostrPublish: createPublish(ndk()),
    nostrFetch: createFetch(ndk()),
    storage: new LocalForageStorageAdapter(),
    appKeysFetchTimeoutMs: APP_KEYS_FETCH_TIMEOUT_MS,
    appKeysFastTimeoutMs: APP_KEYS_FAST_TIMEOUT_MS,
    ...(ownerIdentityKeyHex ? {ownerIdentityKey: hexToBytes(ownerIdentityKeyHex)} : {}),
  })
  runtimeOwnerIdentityKeyHex = ownerIdentityKeyHex

  runtimeCleanup = runtime.onStateChange((state) => {
    syncDeviceStoreFromRuntime(state)
  })

  return runtime
}

const needsRuntimeUserSetup = (record: RuntimeUserRecord): boolean => {
  const devicesMap = record.devices ?? new Map()
  const knownDeviceCount = devicesMap.size
  const appKeysDeviceCount = record.appKeys?.getAllDevices?.().length ?? 0

  if (appKeysDeviceCount > knownDeviceCount) {
    return true
  }

  return Array.from(devicesMap.values()).some(
    (device) => !device.activeSession && (device.inactiveSessions?.length ?? 0) === 0
  )
}

const queueRuntimeUserSetup = (currentRuntime: NdrRuntime, pubkey: string): void => {
  if (!pubkey || runtimeUserSetupInFlight.has(pubkey)) return

  runtimeUserSetupInFlight.add(pubkey)
  void currentRuntime
    .setupUser(pubkey)
    .catch((error) => {
      log("Failed to reconcile runtime user:", pubkey, error)
    })
    .finally(() => {
      runtimeUserSetupInFlight.delete(pubkey)
    })
}

const syncRuntimeUsers = (currentRuntime: NdrRuntime): void => {
  const state = currentRuntime.getState()
  if (!state.sessionManagerReady) return

  const records = currentRuntime.getSessionUserRecords()
  const ownerPubkey = state.ownerPubkey || useUserStore.getState().publicKey
  const ownerRecord = ownerPubkey ? records.get(ownerPubkey) : undefined
  if (ownerPubkey && (!ownerRecord || needsRuntimeUserSetup(ownerRecord))) {
    queueRuntimeUserSetup(currentRuntime, ownerPubkey)
  }

  for (const [pubkey, record] of records) {
    if (pubkey === ownerPubkey) continue
    if (needsRuntimeUserSetup(record)) {
      queueRuntimeUserSetup(currentRuntime, pubkey)
    }
  }
}

const startRuntimeUserSetupSync = (currentRuntime: NdrRuntime): void => {
  syncRuntimeUsers(currentRuntime)
  if (runtimeUserSetupPoller) return

  runtimeUserSetupPoller = setInterval(() => {
    const activeRuntime = runtime
    if (activeRuntime) {
      syncRuntimeUsers(activeRuntime)
    }
  }, RUNTIME_USER_SETUP_SYNC_MS)
}

export const getNdrRuntime = (): NdrRuntime => {
  return getRuntime()
}

export const setPrivateMessagingAvailable = (available: boolean): void => {
  privateMessagingAvailable = available
  if (!available) closePrivateMessaging()
}

const ensureNdkConnected = async (): Promise<void> => {
  const ndkInstance = ndk()
  if (ndkInstance.pool.connectedRelays().length === 0) {
    await ndkInstance.pool.connect(5000)
  }
}

export const getDelegateManager = (): DelegateManager => {
  const manager = getRuntime().getDelegateManager()
  if (!manager) {
    throw new Error("DelegateManager not initialized - call initDelegateManager first")
  }
  return manager
}

export const getAppKeysManager = (): AppKeysManager => {
  const manager = getRuntime().getAppKeysManager()
  if (!manager) {
    throw new Error("AppKeysManager not initialized - call initAppKeysManager first")
  }
  return manager
}

export const initAppKeysManager = async (): Promise<void> => {
  await getRuntime().initAppKeysManager()
  log("AppKeysManager initialized")
}

export const initDelegateManager = async (): Promise<void> => {
  await getRuntime().initDelegateManager()
  log("DelegateManager initialized")
}

export const ensureNdrRuntime = async (ownerPubkey: string): Promise<NdrRuntime> => {
  if (!ownerPubkey) throw new Error("Owner pubkey required")

  await ensureNdkConnected()
  const currentRuntime = getRuntime()
  await currentRuntime.initForOwner(ownerPubkey)
  return currentRuntime
}

export const initPrivateMessaging = async (ownerPubkey: string): Promise<NdrRuntime> => {
  if (!ownerPubkey) throw new Error("Owner pubkey required")

  const currentRuntime = getRuntime()
  try {
    await usePrivateMessagesStore.getState().awaitHydration()
    attachNdrRuntimeEventListener(currentRuntime)
    attachGroupMessageListener()
    await ensureNdkConnected()
    await currentRuntime.initForOwner(ownerPubkey)
  } catch (error) {
    cleanupNdrRuntimeEventListener()
    cleanupGroupMessageListener()
    if (runtime === currentRuntime) closeRuntime()
    throw error
  }

  startRuntimeUserSetupSync(currentRuntime)

  await currentRuntime.republishInvite().catch((error) => {
    log("Failed to publish invite after private messaging init:", error)
  })
  log("Device activated for owner:", ownerPubkey)
  return currentRuntime
}

const waitForManagers = async (): Promise<void> => {
  await getRuntime().initManagers()
}

export const hasLocalAppKeys = (): boolean => {
  return getRuntime().getState().hasLocalAppKeys
}

const requireOwnerPublicKey = (): string => {
  const {publicKey, linkedDevice} = useUserStore.getState()
  if (!publicKey) throw new Error("No public key - user must be logged in")
  if (linkedDevice) throw new Error("Linked devices cannot manage devices")
  return publicKey
}

export const registerDevice = async (timeoutMs?: number): Promise<void> => {
  const publicKey = requireOwnerPublicKey()

  const labels = await getCurrentDeviceRegistrationLabels()

  await ensureNdkConnected()
  await getRuntime().initForOwner(publicKey)
  await getRuntime().registerCurrentDevice({
    ownerPubkey: publicKey,
    timeoutMs,
    ...labels,
  })

  log("Device registered:", getRuntime().getState().currentDevicePubkey)
}

export const revokeDevice = async (identityPubkey: string): Promise<void> => {
  const publicKey = requireOwnerPublicKey()

  await ensureNdkConnected()
  await getRuntime().initForOwner(publicKey)
  await getRuntime().revokeDevice({
    ownerPubkey: publicKey,
    identityPubkey,
    timeoutMs: APP_KEYS_FAST_TIMEOUT_MS,
  })

  log("Device revoked:", identityPubkey)
}

export type {PreparedRegistration, PreparedRevocation}

export const prepareRegistration = async (): Promise<PreparedRegistration> => {
  const publicKey = requireOwnerPublicKey()

  const labels = await getCurrentDeviceRegistrationLabels()

  await waitForManagers()
  return getRuntime().prepareRegistration({
    ownerPubkey: publicKey,
    timeoutMs: APP_KEYS_FETCH_TIMEOUT_MS,
    ...labels,
  })
}

export const prepareRegistrationForIdentity = async (
  identityPubkey: string
): Promise<PreparedRegistration> => {
  const publicKey = requireOwnerPublicKey()

  const labels = await getLinkedDeviceRegistrationLabels()

  await waitForManagers()
  return getRuntime().prepareRegistrationForIdentity({
    ownerPubkey: publicKey,
    identityPubkey,
    timeoutMs: APP_KEYS_FETCH_TIMEOUT_MS,
    ...labels,
  })
}

export const publishPreparedRegistration = async (
  prepared: PreparedRegistration
): Promise<void> => {
  requireOwnerPublicKey()
  await getRuntime().publishPreparedRegistration(prepared)
  log("Device registered:", prepared.newDeviceIdentity)
}

export const prepareRevocation = async (
  identityPubkey: string
): Promise<PreparedRevocation> => {
  const publicKey = requireOwnerPublicKey()

  return getRuntime().prepareRevocation({
    ownerPubkey: publicKey,
    identityPubkey,
    timeoutMs: APP_KEYS_FETCH_TIMEOUT_MS,
  })
}

export const publishPreparedRevocation = async (
  prepared: PreparedRevocation
): Promise<void> => {
  requireOwnerPublicKey()
  await getRuntime().publishPreparedRevocation(prepared)
  log("Device revoked:", prepared.revokedIdentity)
}

export const revokeCurrentDevice = async (): Promise<void> => {
  const manager = getRuntime().getDelegateManager()
  if (!manager) {
    log("DelegateManager not initialized, skipping device revocation")
    return
  }

  await revokeDevice(manager.getIdentityPublicKey())
}

export const startAppKeysSubscription = (ownerPubkey: string): void => {
  getRuntime().startAppKeysSubscription(ownerPubkey)
  log("AppKeys subscription started")
}

export const refreshOwnAppKeysFromRelay = async (
  ownerPubkey?: string,
  timeoutMs: number = APP_KEYS_FAST_TIMEOUT_MS
): Promise<boolean> => {
  const resolvedOwnerPubkey = ownerPubkey || useUserStore.getState().publicKey
  if (!resolvedOwnerPubkey) {
    return false
  }

  await ensureNdkConnected().catch(() => {})
  return getRuntime().refreshOwnAppKeysFromRelay(resolvedOwnerPubkey, timeoutMs)
}

export const republishInvite = async (): Promise<void> => {
  await ensureNdkConnected()
  await getRuntime().republishInvite()
  log("Republished invite")
}

export const createLinkInvite = async (): Promise<Invite> => {
  const {publicKey} = useUserStore.getState()
  await initDelegateManager()
  return getRuntime().createLinkInvite(publicKey || undefined)
}

export const buildLinkInviteUrl = (
  invite: Invite,
  root: string,
  ownerPubkey?: string
): string => {
  const data: Record<string, string> = {
    inviter: invite.inviter,
    ephemeralKey: invite.inviterEphemeralPublicKey,
    sharedSecret: invite.sharedSecret,
    purpose: "link",
  }
  if (ownerPubkey) {
    data.owner = ownerPubkey
  }
  const url = new URL(root)
  url.hash = encodeURIComponent(JSON.stringify(data))
  return url.toString()
}

export const listenForLinkInviteAcceptance = (
  invite: Invite,
  onAccepted: (ownerPubkey: string) => void
): (() => void) => {
  const delegateManager = getDelegateManager()
  if (!invite.inviterEphemeralPrivateKey) {
    throw new Error("Invite missing ephemeral private key")
  }

  const inviterPrivateKey = delegateManager.getIdentityKey()
  const subscribe = createSubscribe(ndk())

  return subscribe(
    {
      kinds: [INVITE_RESPONSE_KIND],
      "#p": [invite.inviterEphemeralPublicKey],
    } as NDKFilter,
    async (event) => {
      try {
        if (invite.maxUses && invite.usedBy.length >= invite.maxUses) {
          return
        }

        const decrypted = await decryptInviteResponse({
          envelopeContent: event.content,
          envelopeSenderPubkey: event.pubkey,
          inviterEphemeralPrivateKey: invite.inviterEphemeralPrivateKey!,
          inviterPrivateKey,
          sharedSecret: invite.sharedSecret,
        })

        invite.usedBy.push(decrypted.inviteeIdentity)
        onAccepted(decrypted.ownerPublicKey || decrypted.inviteeIdentity)
      } catch {
        // ignore invalid responses
      }
    }
  )
}

const acceptInviteViaNdrRuntime = async (
  invite: Invite,
  ownerPublicKey: string
): Promise<string> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

  await ensureNdrRuntime(publicKey)
  const {ownerPublicKey: acceptedOwnerPublicKey} = await getRuntime().acceptInvite(
    invite,
    {
      ownerPublicKey,
    }
  )
  return acceptedOwnerPublicKey
}

export const acceptLinkInvite = async (invite: Invite): Promise<void> => {
  const {linkedDevice, publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }
  if (linkedDevice) {
    throw new Error("Linked devices cannot accept link invites")
  }
  if (invite.ownerPubkey && invite.ownerPubkey !== publicKey) {
    throw new Error("Link invite is for a different account")
  }

  await acceptInviteViaNdrRuntime(invite, publicKey)
}

export const acceptChatInvite = async (invite: Invite): Promise<string> => {
  return acceptInviteViaNdrRuntime(invite, invite.ownerPubkey || invite.inviter)
}
