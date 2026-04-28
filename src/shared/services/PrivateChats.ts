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
import {attachNdrRuntimeEventListener} from "@/utils/dmEventHandler"
import {attachGroupMessageListener} from "@/utils/groupMessageHandler"
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
  return (async (event) => {
    const e = new NDKEvent(ndkInstance, event)
    await e.publish()

    const innerId = (event.tags ?? []).find(([k]) => k === "inner")?.[1]
    if (innerId) {
      const {events, updateMessage} = usePrivateMessagesStore.getState()
      for (const [chatId, messageMap] of events.entries()) {
        const existing = messageMap.get(innerId)
        if (!existing) continue

        const updates: Partial<typeof existing> = {sentToRelays: true}
        if (!existing.nostrEventId) {
          updates.nostrEventId = e.id
        }

        void updateMessage(chatId, innerId, updates)
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

const getRuntime = (): NdrRuntime => {
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

export const initPrivateMessaging = async (
  ownerPubkey: string
): Promise<NdrRuntime> => {
  const currentRuntime = await ensureNdrRuntime(ownerPubkey)

  attachNdrRuntimeEventListener(currentRuntime)
  attachGroupMessageListener()
  startRuntimeUserSetupSync(currentRuntime)

  await currentRuntime.republishInvite().catch((error) => {
    log("Failed to publish invite after private messaging init:", error)
  })
  log("Device activated for owner:", ownerPubkey)
  return currentRuntime
}

export const waitForNdrRuntime = async (ownerPubkey?: string): Promise<NdrRuntime> => {
  const currentRuntime = getRuntime()
  if (currentRuntime.getState().sessionManagerReady) {
    return currentRuntime
  }

  const resolvedOwnerPubkey =
    ownerPubkey || currentRuntime.getState().ownerPubkey || useUserStore.getState().publicKey
  if (!resolvedOwnerPubkey) {
    throw new Error("Owner pubkey required to initialize NdrRuntime")
  }

  return ensureNdrRuntime(resolvedOwnerPubkey)
}

export const waitForAppKeysManager = async (): Promise<AppKeysManager> => {
  await initAppKeysManager()
  return getAppKeysManager()
}

export const waitForDelegateManager = async (): Promise<DelegateManager> => {
  await initDelegateManager()
  return getDelegateManager()
}

export const waitForManagers = async (): Promise<void> => {
  await getRuntime().initManagers()
}

export const hasLocalAppKeys = (): boolean => {
  return getRuntime().getState().hasLocalAppKeys
}

export const registerDevice = async (timeoutMs?: number): Promise<void> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

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
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

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
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

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
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

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
  await getRuntime().publishPreparedRegistration(prepared)
  log("Device registered:", prepared.newDeviceIdentity)
}

export const prepareRevocation = async (
  identityPubkey: string
): Promise<PreparedRevocation> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

  return getRuntime().prepareRevocation({
    ownerPubkey: publicKey,
    identityPubkey,
    timeoutMs: APP_KEYS_FETCH_TIMEOUT_MS,
  })
}

export const publishPreparedRevocation = async (
  prepared: PreparedRevocation
): Promise<void> => {
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

export const deleteDeviceInvite = async (deviceId: string) => {
  const {publicKey} = useUserStore.getState()

  const dTag = `double-ratchet/invites/${deviceId}`
  const deletionEvent = new NDKEvent(ndk(), {
    kind: 30078,
    pubkey: publicKey,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag]],
  })

  await deletionEvent.sign()
  await deletionEvent.publish()

  log("Published invite tombstone for device:", deviceId)

  const storage = new LocalForageStorageAdapter()
  await storage.del(`invite/${deviceId}`)
}

export const deleteCurrentDeviceInvite = async () => {
  await getRuntime().initDelegateManager()
  const deviceId = getRuntime().getState().currentDevicePubkey
  if (!deviceId) {
    log("No device identity, skipping invite tombstone")
    return
  }

  await deleteDeviceInvite(deviceId)
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

export const stopAppKeysSubscription = (): void => {
  runtime?.stopAppKeysSubscription()
  log("AppKeys subscription stopped")
}

export const republishInvite = async (): Promise<void> => {
  await ensureNdkConnected()
  await getRuntime().republishInvite()
  log("Republished invite")
}

export const rotateInvite = async (): Promise<void> => {
  await getRuntime().rotateInvite()
  log("Rotated invite for device:", getRuntime().getState().currentDevicePubkey)
}

export const checkInviteOnRelay = async (): Promise<{
  found: boolean
  eventId?: string
  createdAt?: number
}> => {
  const delegateManager = getRuntime().getDelegateManager()
  if (!delegateManager) {
    return {found: false}
  }

  const deviceId = delegateManager.getIdentityPublicKey()
  const ndkInstance = ndk()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      subscription.stop()
      resolve({found: false})
    }, 3000)

    const subscription = ndkInstance.subscribe({
      kinds: [30078],
      authors: [deviceId],
      "#d": [`double-ratchet/invites/${deviceId}`],
    } as NDKFilter)

    subscription.on("event", (event: NDKEvent) => {
      clearTimeout(timeout)
      subscription.stop()
      resolve({
        found: true,
        eventId: event.id,
        createdAt: event.created_at,
      })
    })

    subscription.start()
  })
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
