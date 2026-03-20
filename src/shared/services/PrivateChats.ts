import { VerifiedEvent } from "nostr-tools"
import {hexToBytes} from "@noble/hashes/utils"
import { LocalForageStorageAdapter } from "../../session/StorageAdapter"
import {
  AppKeysManager,
  DelegateManager,
  Invite,
  INVITE_RESPONSE_KIND,
  NdrRuntime,
  SessionManager,
  decryptInviteResponse,
  type DeviceEntry,
  type NdrRuntimeState,
  type NostrPublish,
  type NostrSubscribe,
  type PreparedRegistration,
  type PreparedRevocation,
} from "nostr-double-ratchet"
import NDK, {
  NDKEvent,
  NDKFilter,
  NDKSubscriptionCacheUsage,
} from "@/lib/ndk"
import { ndk } from "@/utils/ndk"
import { useUserStore } from "../../stores/user"
import { useDevicesStore } from "../../stores/devices"
import { usePrivateMessagesStore } from "@/stores/privateMessages"
import { createDebugLogger } from "@/utils/createDebugLogger"
import { DEBUG_NAMESPACES } from "@/utils/constants"
import { attachSessionEventListener } from "@/utils/dmEventHandler"
import { attachGroupMessageListener } from "@/utils/groupMessageHandler"
import {
  getCurrentDeviceRegistrationLabels,
  getLinkedDeviceRegistrationLabels,
} from "./deviceLabels"

const { log } = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const APP_KEYS_FETCH_TIMEOUT_MS = 10000
const APP_KEYS_FAST_TIMEOUT_MS = 2000

let runtime: NdrRuntime | null = null
let runtimeCleanup: (() => void) | null = null
let lastRuntimeState: NdrRuntimeState | null = null
let runtimeOwnerIdentityKeyHex: string | null = null

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
  return (filter: NDKFilter, onEvent: (event: VerifiedEvent) => void) => {
    const subscription = ndkInstance.subscribe(filter, {
      closeOnEose: false,
      cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
    })

    subscription.on("event", (event: NDKEvent) => {
      onEvent(event as unknown as VerifiedEvent)
    })

    subscription.start()

    return () => {
      subscription.stop()
    }
  }
}

export const getNostrSubscribe = (): NostrSubscribe => {
  return createSubscribe(ndk())
}

const createPublish = (ndkInstance: NDK): NostrPublish => {
  return (async (event) => {
    const e = new NDKEvent(ndkInstance, event)
    await e.publish()

    const innerId = (event.tags ?? []).find(([k]) => k === "inner")?.[1]
    if (innerId) {
      const { events, updateMessage } = usePrivateMessagesStore.getState()
      for (const [chatId, messageMap] of events.entries()) {
        const existing = messageMap.get(innerId)
        if (!existing) continue

        const updates: Partial<typeof existing> = { sentToRelays: true }
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
  const { privateKey, linkedDevice } = useUserStore.getState()
  if (linkedDevice) {
    return null
  }
  return privateKey?.trim() ? privateKey.trim() : null
}

const closeRuntime = (): void => {
  runtimeCleanup?.()
  runtimeCleanup = null
  runtime?.close()
  runtime = null
  lastRuntimeState = null
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
    storage: new LocalForageStorageAdapter(),
    appKeysFetchTimeoutMs: APP_KEYS_FETCH_TIMEOUT_MS,
    appKeysFastTimeoutMs: APP_KEYS_FAST_TIMEOUT_MS,
    ...(ownerIdentityKeyHex ? {ownerIdentityKey: hexToBytes(ownerIdentityKeyHex)} : {}),
  })
  runtimeOwnerIdentityKeyHex = ownerIdentityKeyHex

  runtimeCleanup = runtime.onStateChange((state) => {
    syncDeviceStoreFromRuntime(state)
    lastRuntimeState = state
  })

  return runtime
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

export const initPrivateMessaging = async (
  ownerPubkey: string
): Promise<SessionManager> => {
  if (!ownerPubkey) throw new Error("Owner pubkey required")

  await ensureNdkConnected()
  const currentRuntime = getRuntime()
  const sessionManager = await currentRuntime.initForOwner(ownerPubkey)

  attachSessionEventListener(sessionManager)
  attachGroupMessageListener()

  await currentRuntime.republishInvite().catch((error) => {
    log("Failed to publish invite after private messaging init:", error)
  })
  log("Device activated for owner:", ownerPubkey)
  return sessionManager
}

export const getSessionManager = (): SessionManager | null => {
  return runtime?.getSessionManager() || null
}

export const ensureSessionManager = async (
  ownerPubkey: string
): Promise<SessionManager> => {
  if (!ownerPubkey) {
    throw new Error("Owner pubkey required to initialize SessionManager")
  }
  return initPrivateMessaging(ownerPubkey)
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
  const { publicKey } = useUserStore.getState()
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
  const { publicKey } = useUserStore.getState()
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

export type { PreparedRegistration, PreparedRevocation }

export const prepareRegistration = async (): Promise<PreparedRegistration> => {
  const { publicKey } = useUserStore.getState()
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
  const { publicKey } = useUserStore.getState()
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
  const { publicKey } = useUserStore.getState()
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
  const { publicKey } = useUserStore.getState()

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
  const manager = getSessionManager()
  if (!manager) {
    log("No session manager, skipping invite tombstone")
    return
  }

  await manager.init()
  await deleteDeviceInvite(manager.getDeviceId())
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
    return { found: false }
  }

  const deviceId = delegateManager.getIdentityPublicKey()
  const ndkInstance = ndk()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      subscription.stop()
      resolve({ found: false })
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
  const { publicKey } = useUserStore.getState()
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

const acceptInviteViaSessionManager = async (
  invite: Invite,
  ownerPublicKey: string
): Promise<string> => {
  const { publicKey } = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

  await ensureNdkConnected()
  await getRuntime().initForOwner(publicKey)
  const { ownerPublicKey: acceptedOwnerPublicKey } = await getRuntime().acceptInvite(
    invite,
    {
      ownerPublicKey,
    }
  )
  return acceptedOwnerPublicKey
}

export const acceptLinkInvite = async (invite: Invite): Promise<void> => {
  const { linkedDevice, publicKey } = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }
  if (linkedDevice) {
    throw new Error("Linked devices cannot accept link invites")
  }
  if (invite.ownerPubkey && invite.ownerPubkey !== publicKey) {
    throw new Error("Link invite is for a different account")
  }

  await acceptInviteViaSessionManager(invite, publicKey)
}

export const acceptChatInvite = async (invite: Invite): Promise<string> => {
  return acceptInviteViaSessionManager(invite, invite.ownerPubkey || invite.inviter)
}
