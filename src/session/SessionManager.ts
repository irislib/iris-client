import {
  DecryptFunction,
  NostrSubscribe,
  NostrPublish,
  Rumor,
  Unsubscribe,
  Invite,
  Session,
  serializeSessionState,
  deserializeSessionState,
} from "nostr-double-ratchet/src"
import {StorageAdapter, InMemoryStorageAdapter} from "./StorageAdapter"
import {KIND_CHAT_MESSAGE} from "../utils/constants"
import {getEventHash} from "nostr-tools"
import {
  deviceInviteKey,
  inviteAcceptKey as buildInviteAcceptKey,
  sessionKey as buildSessionKey,
  sessionKeyPrefix,
  userInviteKey,
  userRecordKey,
  userRecordKeyPrefix,
} from "./storageKeys"
import {migrateToVersion1IfNeeded} from "./migrations/migrateToVersion1"

export type OnEventCallback = (event: Rumor, from: string) => void

interface DeviceRecord {
  deviceId: string
  activeSession?: Session
  inactiveSessions: Session[]
}

interface UserRecord {
  publicKey: string
  devices: Map<string, DeviceRecord>
  foundInvites: Map<string, Invite>
}

type SerializedSessionState = ReturnType<typeof serializeSessionState>
type StoredSessionEntry = [string, SerializedSessionState] | SerializedSessionState

interface StoredDeviceRecord {
  deviceId: string
  activeSession: StoredSessionEntry | null
  inactiveSessions: StoredSessionEntry[]
}

interface StoredUserRecord {
  publicKey: string
  devices: StoredDeviceRecord[]
}

export default class SessionManager {
  // Params
  private deviceId: string
  private storage: StorageAdapter
  private nostrSubscribe: NostrSubscribe
  private nostrPublish: NostrPublish
  private ourIdentityKey: Uint8Array | DecryptFunction
  private ourPublicKey: string

  // Data
  private userRecords: Map<string, UserRecord> = new Map()
  private messageHistory: Map<string, Rumor[]> = new Map()

  // Subscriptions
  private ourDeviceInviteSubscription: Unsubscribe | null = null
  private ourOtherDeviceInviteSubscription: Unsubscribe | null = null
  private inviteSubscriptions: Map<string, Unsubscribe> = new Map()
  private sessionSubscriptions: Map<string, Unsubscribe> = new Map()

  // Callbacks
  private internalSubscriptions: Set<OnEventCallback> = new Set()

  // Initialization flag
  private initialized: boolean = false

  constructor(
    ourPublicKey: string,
    ourIdentityKey: Uint8Array | DecryptFunction,
    deviceId: string,
    nostrSubscribe: NostrSubscribe,
    nostrPublish: NostrPublish,
    storage?: StorageAdapter
  ) {
    this.userRecords = new Map()
    this.nostrSubscribe = nostrSubscribe
    this.nostrPublish = nostrPublish
    this.ourPublicKey = ourPublicKey
    this.ourIdentityKey = ourIdentityKey
    this.deviceId = deviceId
    this.storage = storage || new InMemoryStorageAdapter()
  }

  async init() {
    if (this.initialized) return
    this.initialized = true

    await migrateToVersion1IfNeeded(this.storage)

    await this.loadAllUserRecords()

    return this.storage
      .get<string>(deviceInviteKey(this.deviceId))
      .then((data) => {
        if (!data) return null
        const invite = Invite.deserialize(data)
        return invite
      })
      .catch((error) => {
        console.error("Failed to load invite:", error)
        return null
      })
      .then(async (invite) => {
        if (invite) {
          // Republish existing invite to ensure relay propagation
          const event = invite.getEvent()
          await this.nostrPublish(event).catch(console.error)
          return invite
        }
        const newInvite = Invite.createNew(this.ourPublicKey, this.deviceId)
        await this.storage.put(deviceInviteKey(this.deviceId), newInvite.serialize())
        const event = newInvite.getEvent()
        await this.nostrPublish(event).catch(console.error)
        return newInvite
      })
      .then((invite) => {
        // Listen to our invite
        this.ourDeviceInviteSubscription = invite.listen(
          this.ourIdentityKey,
          this.nostrSubscribe,
          async (session, inviteePubkey, deviceId) => {
            if (!deviceId || deviceId === this.deviceId) return
            const nostrEventId = session.name
            const acceptanceKey = this.inviteAcceptKey(
              nostrEventId,
              inviteePubkey,
              deviceId
            )
            const nostrEventIdInStorage = await this.storage.get<string>(acceptanceKey)

            if (nostrEventIdInStorage) {
              return
            }

            await this.storage.put(acceptanceKey, "1")
            this.attachSessionSubscription(inviteePubkey, deviceId, session)
          }
        )
      })
      .catch((error) => {
        console.error("Failed to initialize session manager:", error)
      })
  }

  // -------------------
  // Idempotency helpers
  // -------------------
  private getOrCreateUserRecord(userPubkey: string): UserRecord {
    let rec = this.userRecords.get(userPubkey)
    if (!rec) {
      rec = {publicKey: userPubkey, devices: new Map(), foundInvites: new Map()}
      this.userRecords.set(userPubkey, rec)
    }
    return rec
  }

  private getOrCreateDeviceRecord(userPubkey: string, deviceId: string): DeviceRecord {
    const ur = this.getOrCreateUserRecord(userPubkey)
    let dr = ur.devices.get(deviceId)
    if (!dr) {
      dr = {deviceId, inactiveSessions: []}
      ur.devices.set(deviceId, dr)
    }
    return dr
  }

  private sessionKey(userPubkey: string, deviceId: string, sessionName: string) {
    return buildSessionKey(userPubkey, deviceId, sessionName)
  }
  private inviteKey(userPubkey: string) {
    return userInviteKey(userPubkey)
  }
  private inviteAcceptKey(nostrEventId: string, userPubkey: string, deviceId: string) {
    return buildInviteAcceptKey(nostrEventId, userPubkey, deviceId)
  }

  private attachSessionSubscription(
    userPubkey: string,
    deviceId: string,
    session: Session
  ): void {
    const key = this.sessionKey(userPubkey, deviceId, session.name)
    if (this.sessionSubscriptions.has(key)) return

    console.warn("Attaching session subscription for", userPubkey, deviceId, session.name)

    const dr = this.getOrCreateDeviceRecord(userPubkey, deviceId)
    if (dr.activeSession) {
      dr.inactiveSessions.push(dr.activeSession)
    }
    dr.activeSession = session

    if (dr.inactiveSessions.length > 10) {
      dr.inactiveSessions = dr.inactiveSessions.slice(-10)
    }

    const unsub = session.onEvent((event) => {
      for (const cb of this.internalSubscriptions) cb(event, userPubkey)
      this.storeUserRecord(userPubkey).catch(console.error)
    })
    this.storeUserRecord(userPubkey).catch(console.error)
    this.sessionSubscriptions.set(key, unsub)
  }

  private attachInviteSubscription(
    userPubkey: string,
    onInvite?: (invite: Invite) => void | Promise<void>
  ): void {
    const key = this.inviteKey(userPubkey)
    if (this.inviteSubscriptions.has(key)) return

    const unsubscribe = Invite.fromUser(
      userPubkey,
      this.nostrSubscribe,
      async (invite) => {
        if (!invite.deviceId) return

        const ur = this.getOrCreateUserRecord(userPubkey)
        if (!ur.foundInvites.has(invite.deviceId)) {
          ur.foundInvites.set(invite.deviceId, invite)
        }

        if (onInvite) await onInvite(invite)
      }
    )

    this.inviteSubscriptions.set(key, unsubscribe)
  }

  setupUser(userPubkey: string) {
    this.getOrCreateUserRecord(userPubkey)

    this.attachInviteSubscription(userPubkey, async (invite) => {
      const {deviceId} = invite

      if (!deviceId) return

      const currentActiveSession = this.getOrCreateDeviceRecord(
        userPubkey,
        deviceId
      ).activeSession

      if (currentActiveSession) {
        return
      }

      const {session, event} = await invite.accept(
        this.nostrSubscribe,
        this.ourPublicKey,
        this.ourIdentityKey,
        this.deviceId
      )
      await this.nostrPublish(event)
        .then(() => this.attachSessionSubscription(userPubkey, deviceId, session))
        .then(() => this.sendMessageHistory(userPubkey, deviceId))
        .catch(console.error)
    })
  }

  onEvent(callback: OnEventCallback) {
    this.internalSubscriptions.add(callback)

    return () => {
      this.internalSubscriptions.delete(callback)
    }
  }

  getDeviceId(): string {
    return this.deviceId
  }

  getUserRecords(): Map<string, UserRecord> {
    return this.userRecords
  }

  close() {
    for (const unsubscribe of this.inviteSubscriptions.values()) {
      unsubscribe()
    }

    for (const unsubscribe of this.sessionSubscriptions.values()) {
      unsubscribe()
    }

    this.ourDeviceInviteSubscription?.()
    this.ourOtherDeviceInviteSubscription?.()
  }

  async deleteUser(userPubkey: string): Promise<void> {
    await this.init()

    const userRecord = this.userRecords.get(userPubkey)

    if (userRecord) {
      for (const device of userRecord.devices.values()) {
        if (device.activeSession) {
          this.removeSessionSubscription(
            userPubkey,
            device.deviceId,
            device.activeSession.name
          )
        }

        for (const session of device.inactiveSessions) {
          this.removeSessionSubscription(userPubkey, device.deviceId, session.name)
        }
      }

      this.userRecords.delete(userPubkey)
    }

    const inviteKey = this.inviteKey(userPubkey)
    const inviteUnsub = this.inviteSubscriptions.get(inviteKey)
    if (inviteUnsub) {
      inviteUnsub()
      this.inviteSubscriptions.delete(inviteKey)
    }

    this.messageHistory.delete(userPubkey)

    await Promise.allSettled([
      this.storage.del(this.inviteKey(userPubkey)),
      this.deleteUserSessionsFromStorage(userPubkey),
      this.storage.del(userRecordKey(userPubkey)),
    ])
  }

  private removeSessionSubscription(
    userPubkey: string,
    deviceId: string,
    sessionName: string
  ) {
    const key = this.sessionKey(userPubkey, deviceId, sessionName)
    const unsubscribe = this.sessionSubscriptions.get(key)
    if (unsubscribe) {
      unsubscribe()
      this.sessionSubscriptions.delete(key)
    }
  }

  private async deleteUserSessionsFromStorage(userPubkey: string): Promise<void> {
    const prefix = sessionKeyPrefix(userPubkey)
    const keys = await this.storage.list(prefix)
    await Promise.all(keys.map((key) => this.storage.del(key)))
  }

  private async sendMessageHistory(
    recipientPublicKey: string,
    deviceId: string
  ): Promise<void> {
    const history = this.messageHistory.get(recipientPublicKey) || []
    const userRecord = this.userRecords.get(recipientPublicKey)
    if (!userRecord) {
      console.warn("No user record for", recipientPublicKey)
      return
    }
    const device = userRecord.devices.get(deviceId)
    if (!device) {
      console.warn("No device record for", deviceId)
      return
    }
    for (const event of history) {
      const {activeSession} = device
      if (!activeSession) {
        console.warn("No active session for device", device.deviceId)
        return
      }
      const {event: verifiedEvent} = activeSession.sendEvent(event)
      await this.nostrPublish(verifiedEvent)
      await this.storeUserRecord(recipientPublicKey)
    }
  }

  async sendEvent(
    recipientIdentityKey: string,
    event: Partial<Rumor>
  ): Promise<Rumor | undefined> {
    await this.init()
    const userRecord = this.getOrCreateUserRecord(recipientIdentityKey)
    const ourUserRecord = this.getOrCreateUserRecord(this.ourPublicKey)

    this.setupUser(recipientIdentityKey)
    this.setupUser(this.ourPublicKey)

    const devices = [
      ...Array.from(userRecord.devices.values()),
      ...Array.from(ourUserRecord.devices.values()),
    ]

    // Send to all devices in background
    Promise.all(
      devices.map(async (device) => {
        const {activeSession} = device
        if (!activeSession) return
        const {event: verifiedEvent} = activeSession.sendEvent(event)
        await this.nostrPublish(verifiedEvent).catch(console.error)
      })
    )
      .then(() => this.storeUserRecord(recipientIdentityKey))
      .catch(console.error)

    // Return the event with computed ID (same as library would compute)
    return event as Rumor
  }

  async sendMessage(
    recipientPublicKey: string,
    content: string,
    options: {kind?: number; tags?: string[][]} = {}
  ): Promise<Rumor> {
    const {kind = KIND_CHAT_MESSAGE, tags = []} = options

    // Build message exactly as library does (Session.ts sendEvent)
    const now = Date.now()
    const builtTags = this.buildMessageTags(recipientPublicKey, tags)

    const rumor: Rumor = {
      content,
      kind,
      created_at: Math.floor(now / 1000),
      tags: builtTags,
      pubkey: this.ourPublicKey,
      id: "", // Will compute next
    }

    // Add ms tag if not present (exactly like library)
    if (!rumor.tags.some(([k]) => k === "ms")) {
      rumor.tags.push(["ms", String(now)])
    }

    // Compute ID exactly as library does
    rumor.id = getEventHash(rumor)

    this.messageHistory.set(recipientPublicKey, [
      ...(this.messageHistory.get(recipientPublicKey) || []),
      rumor,
    ])

    // Send in background
    this.sendEvent(recipientPublicKey, rumor).catch(console.error)

    return rumor
  }

  private buildMessageTags(
    recipientPublicKey: string,
    extraTags: string[][]
  ): string[][] {
    const hasRecipientPTag = extraTags.some(
      (tag) => tag[0] === "p" && tag[1] === recipientPublicKey
    )
    const tags = hasRecipientPTag
      ? [...extraTags]
      : [["p", recipientPublicKey], ...extraTags]
    return tags
  }

  private storeUserRecord(publicKey: string) {
    console.warn("Storing user record for", publicKey)
    const data: StoredUserRecord = {
      publicKey: publicKey,
      devices: Array.from(this.userRecords.get(publicKey)?.devices.entries() || []).map(
        ([, device]) => ({
          deviceId: device.deviceId,
          activeSession: device.activeSession
            ? [
                device.activeSession.name,
                serializeSessionState(device.activeSession.state),
              ]
            : null,
          inactiveSessions: device.inactiveSessions.map((session) => [
            session.name,
            serializeSessionState(session.state),
          ]),
        })
      ),
    }
    return this.storage.put(userRecordKey(publicKey), data)
  }

  private loadUserRecord(publicKey: string) {
    return this.storage
      .get<StoredUserRecord>(userRecordKey(publicKey))
      .then((data) => {
        if (!data) return

        const devices = new Map<string, DeviceRecord>()

        for (const deviceData of data.devices) {
          const {
            deviceId,
            activeSession: serializedActive,
            inactiveSessions: serializedInactive,
          } = deviceData

          try {
            const activeSession = serializedActive
              ? new Session(
                  this.nostrSubscribe,
                  deserializeSessionState(serializedActive[1])
                )
              : undefined

            const inactiveSessions = serializedInactive.map((entry) => {
              return new Session(this.nostrSubscribe, deserializeSessionState(entry[1]))
            })

            devices.set(deviceId, {
              deviceId,
              activeSession,
              inactiveSessions,
            })
          } catch (e) {
            console.warn(
              `Failed to deserialize session for ${publicKey}/${deviceId}, skipping:`,
              e
            )
            continue
          }
        }

        for (const device of devices.values()) {
          const {deviceId, activeSession, inactiveSessions} = device
          if (!deviceId) continue

          if (activeSession) {
            const sessionSubscriptionId = this.sessionKey(
              publicKey,
              deviceId,
              activeSession.name
            )
            if (!this.sessionSubscriptions.has(sessionSubscriptionId)) {
              console.warn("SETTING A LISTENER IN LOAD", publicKey, deviceId)
              const unsubscribe = activeSession.onEvent((event) => {
                console.warn(
                  "[loadUserRecord] Received event from",
                  publicKey,
                  deviceId,
                  event
                )
                for (const callback of this.internalSubscriptions) {
                  callback(event, publicKey)
                }
                this.storeUserRecord(publicKey).catch(console.error)
              })
              this.sessionSubscriptions.set(sessionSubscriptionId, unsubscribe)
            }
          }

          for (const session of inactiveSessions) {
            const sessionSubscriptionId = this.sessionKey(
              publicKey,
              deviceId,
              session.name
            )
            if (this.sessionSubscriptions.has(sessionSubscriptionId)) {
              continue
            }
            const unsubscribe = session.onEvent((event) => {
              console.warn(
                "[loadUserRecord] Received event from (inactive)",
                publicKey,
                deviceId,
                event
              )
              for (const callback of this.internalSubscriptions) {
                callback(event, publicKey)
              }
              this.storeUserRecord(publicKey).catch(console.error)
            })
            this.sessionSubscriptions.set(sessionSubscriptionId, unsubscribe)
          }
        }

        this.userRecords.set(publicKey, {
          publicKey: data.publicKey,
          devices,
          foundInvites: new Map(),
        })
      })
      .catch((error) => {
        console.error(`Failed to load user record for ${publicKey}:`, error)
      })
  }
  private loadAllUserRecords() {
    const prefix = userRecordKeyPrefix()
    return this.storage.list(prefix).then((keys) => {
      return Promise.all(
        keys.map((key) => {
          const publicKey = key.slice(prefix.length)
          return this.loadUserRecord(publicKey)
        })
      )
    })
  }
}
