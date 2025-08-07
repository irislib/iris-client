import {Invite} from "nostr-double-ratchet/src"
import {createJSONStorage, persist} from "zustand/middleware"
import {Filter, VerifiedEvent, UnsignedEvent} from "nostr-tools"
import {NDKEventFromRawEvent, RawEvent} from "@/utils/nostr"
import {getEncryptFunction, getDecryptFunction} from "@/utils/nostrCrypto"
import {usePrivateMessagesStore} from "./privateMessages"
import {useSessionsStore} from "./sessions"
import {UserRecord} from "./UserRecord"
import localforage from "localforage"
import {useUserStore} from "./user"
import {ndk} from "@/utils/ndk"
import {create} from "zustand"

const generateDeviceId = (): string => {
  return crypto.randomUUID()
}

interface UserRecordsStoreState {
  invites: Map<string, Invite>
  userRecords: Map<string, UserRecord> // userPubKey -> UserRecord
  lastSeen: Map<string, number> // sessionId -> timestamp (for UI compatibility)
  deviceId: string
  deviceInviteListeners: Map<string, () => void>
  messageQueue: Map<
    string,
    Array<{event: Partial<UnsignedEvent>; resolve: (sessionId: string) => void}>
  >
}

interface UserRecordsStoreActions {
  // Core session management
  createInvite: (label: string, inviteId?: string) => void
  createDefaultInvites: () => void
  acceptInvite: (invite: Invite) => Promise<string>
  sendMessage: (sessionId: string, event: Partial<UnsignedEvent>) => Promise<void>
  sendToUser: (userPubKey: string, event: Partial<UnsignedEvent>) => Promise<void>
  updateLastSeen: (sessionId: string) => void
  deleteInvite: (id: string) => void
  deleteSession: (sessionId: string) => void

  // Device management
  listenToUserDevices: (userPubKey: string) => void
  stopListeningToUserDevices: (userPubKey: string) => void

  // Session selection
  getPreferredSession: (userPubKey: string) => string | null
  // Maintenance
  getOwnDeviceInvites: () => Map<string, Invite>
  reset: () => void
  initializeListeners: () => void
  initializeSessionListeners: () => void

  // Compatibility API (for existing components)
  sessions: Map<string, string> // Virtual getter for backward compatibility - returns sessionIds
}

type UserRecordsStore = UserRecordsStoreState & UserRecordsStoreActions

// Subscribe function for nostr events
const subscribe = (filter: Filter, onEvent: (event: VerifiedEvent) => void) => {
  const sub = ndk().subscribe(filter)
  sub.on("event", (e) => onEvent(e as unknown as VerifiedEvent))
  return () => sub.stop()
}

// Global listeners tracking
const inviteListeners = new Map<string, () => void>()
const pendingInvites = new Set<string>()

export const useUserRecordsStore = create<UserRecordsStore>()(
  persist(
    (set, get) => ({
      invites: new Map(),
      userRecords: new Map(),
      lastSeen: new Map(),
      deviceId: "",
      deviceInviteListeners: new Map(),
      messageQueue: new Map(),

      // Virtual sessions getter for backward compatibility
      get sessions() {
        const virtualSessions = new Map<string, string>()
        const userRecords = get().userRecords

        for (const [, userRecord] of userRecords.entries()) {
          for (const device of userRecord.getActiveDevices()) {
            if (device.activeSessionId) {
              virtualSessions.set(device.activeSessionId, device.activeSessionId)
            }
          }
        }

        return virtualSessions
      },

      createDefaultInvites: async () => {
        const myPubKey = useUserStore.getState().publicKey
        const myPrivKey = useUserStore.getState().privateKey
        const nip07Login = useUserStore.getState().nip07Login

        // Skip all DM functionality if no signer (view-only mode)
        if (!myPrivKey && !nip07Login) {
          console.log(
            "No private key or NIP-07 extension - skipping DM initialization (view-only mode)"
          )
          return
        }

        if (!myPubKey) {
          throw new Error("No public key")
        }

        console.log("createDefaultInvites called for user:", myPubKey)

        // Get or create device ID
        let deviceId = get().deviceId
        if (!deviceId) {
          const stored = await localforage.getItem<string>("deviceId")
          if (stored) {
            deviceId = stored
            console.log("Using existing device ID:", deviceId)
          } else {
            deviceId = generateDeviceId()
            await localforage.setItem("deviceId", deviceId)
            console.log("Generated new device ID:", deviceId)
          }
          set({deviceId})
        }

        // Create device-specific invite
        if (!get().invites.has(deviceId)) {
          console.log("Creating new device invite for:", deviceId)
          get().createInvite(`Device ${deviceId.slice(0, 8)}`, deviceId)
          const invite = get().invites.get(deviceId)
          if (!invite) {
            console.error("Failed to create device invite")
            return
          }
          const event = invite.getEvent() as RawEvent
          console.log("Publishing device invite...", {deviceId, eventId: event.id})
          await NDKEventFromRawEvent(event)
            .publish()
            .then((res) => console.log("Successfully published device invite", res))
            .catch((e) => console.warn("Error publishing device invite:", e))
        }

        console.log("Current invites:", Array.from(get().invites.keys()))
        console.log("Current userRecords:", Array.from(get().userRecords.keys()))
      },

      createInvite: (_label: string, inviteId?: string) => {
        const myPubKey = useUserStore.getState().publicKey
        const myPrivKey = useUserStore.getState().privateKey
        const nip07Login = useUserStore.getState().nip07Login

        // Skip if no signer (view-only mode)
        if (!myPrivKey && !nip07Login) {
          console.log(
            "No private key or NIP-07 extension - cannot create invite (view-only mode)"
          )
          return
        }

        if (!myPubKey) {
          throw new Error("No public key")
        }

        const id = inviteId || crypto.randomUUID()
        const invite = Invite.createNew(myPubKey, id) // Pass deviceId as second parameter
        const currentInvites = get().invites

        const newInvites = new Map(currentInvites)
        newInvites.set(id, invite)

        const decrypt = getDecryptFunction(myPrivKey)

        const unsubscribe = invite.listen(decrypt, subscribe, (session, identity) => {
          // uniquely identify by their initial nostr public key to avoid duplicates. TODO for privacy we might not want to actually store this.
          const sessionId = session.state.theirNextNostrPublicKey
          console.log("got session", sessionId, session)
          if (!identity || !sessionId) return

          const deviceId = `${identity}:incoming` // TODO invite acceptors need to communicate their device id in addition to identity?

          // Check if we already have a session with this device
          const existingUserRecord = get().userRecords.get(identity)
          const existingSessionId = existingUserRecord?.getActiveSessionId(deviceId)

          if (existingSessionId) {
            console.log(
              "Session already exists with this device in invite listener, skipping",
              existingSessionId
            )
            return
          }

          // Add session to sessions store and reference in UserRecord
          useSessionsStore.getState().addSession(sessionId, session, identity, deviceId)

          // Get or create UserRecord
          const userRecords = new Map(get().userRecords)
          let userRecord = userRecords.get(identity)
          if (!userRecord) {
            userRecord = new UserRecord(identity, identity)
            userRecords.set(identity, userRecord)
          }

          userRecord.upsertSession(deviceId, sessionId)

          // Update last seen
          const lastSeen = new Map(get().lastSeen)
          lastSeen.set(sessionId, Date.now())

          set({userRecords, lastSeen})

          // Session listener is automatically set up by sessions store
          // Chat will appear automatically in getChatsList() via userRecords
        })

        inviteListeners.set(id, unsubscribe)
        set({invites: newInvites})
      },

      deleteInvite: (id: string) => {
        const currentInvites = get().invites
        const newInvites = new Map(currentInvites)
        newInvites.delete(id)
        set({invites: newInvites})
        const unsubscribe = inviteListeners.get(id)
        if (unsubscribe) {
          unsubscribe()
          inviteListeners.delete(id)
        }
      },

      sendMessage: async (sessionId: string, event: Partial<UnsignedEvent>) => {
        // Delegate to sessions store for actual message sending
        await useSessionsStore.getState().sendMessage(sessionId, event)
      },

      sendToUser: async (
        userPubKey: string,
        event: Partial<UnsignedEvent>
      ): Promise<void> => {
        console.log("sendToUser:", {userPubKey, event})

        const myPubKey = useUserStore.getState().publicKey

        if (!event.created_at) {
          event.created_at = Math.round(Date.now() / 1000)
        }

        // Initialize tags if not present
        if (!event.tags) {
          event.tags = []
        }

        // Add ms tag if not present
        if (!event.tags.some((tag) => tag[0] === "ms")) {
          event.tags.push(["ms", Date.now().toString()])
        }

        // Add p tag if not present
        if (!event.tags.some((tag) => tag[0] === "p")) {
          event.tags.push(["p", userPubKey])
        }

        const fanOutToOwnDevices = async (sentVia: Set<string>) => {
          if (!myPubKey) return
          const myRecord = get().userRecords.get(myPubKey)
          console.log("fanOutToOwnDevices - myRecord:", myRecord)
          if (!myRecord) {
            console.log("No user record found for own user:", myPubKey)
            return
          }

          const activeDevices = myRecord.getActiveDevices()
          console.log("=== MY DEVICES ===")
          console.log("Total active devices:", activeDevices.length)
          console.log("My device ID:", get().deviceId)
          console.log(
            "All my devices:",
            activeDevices.map((d) => ({
              deviceId: d.deviceId,
              hasSession: !!d.activeSessionId,
              sessionId: d.activeSessionId,
              isCurrentDevice: d.deviceId === get().deviceId,
            }))
          )

          for (const device of activeDevices) {
            console.log(`Checking device ${device.deviceId}:`)
            if (!device.activeSessionId) continue
            if (sentVia.has(device.activeSessionId)) continue
            try {
              const clone = JSON.parse(JSON.stringify(event)) as Partial<UnsignedEvent>
              console.log(`Sending to own device session ${device.activeSessionId}`)
              await get().sendMessage(device.activeSessionId, clone)
              console.log(`Successfully sent to ${device.activeSessionId}`)
            } catch (err) {
              console.warn(
                `Failed to fan-out to own session ${device.activeSessionId}:`,
                err
              )
            }
          }
        }

        // Track which sessions we've already sent through
        const sentSessionIds = new Set<string>()

        // ALWAYS fan out to our own devices first
        console.log("=== SEND TO USER ===")
        console.log("Sending to:", userPubKey)
        console.log("My pubkey:", myPubKey)
        console.log("Is sending to self:", userPubKey === myPubKey)
        console.log("Fanning out to own devices...")
        await fanOutToOwnDevices(sentSessionIds)

        // Get UserRecord for this user
        const userRecord = get().userRecords.get(userPubKey)

        // Special handling when sending to self
        if (userPubKey === myPubKey) {
          const currentDeviceId = get().deviceId
          const myRecord = get().userRecords.get(myPubKey)

          // Exclude current device from fan-out
          if (currentDeviceId && myRecord) {
            const currentSessionId = myRecord.getActiveSessionId(currentDeviceId)
            if (currentSessionId) {
              sentSessionIds.add(currentSessionId)
            }
          }

          // Check if we have other devices to send to
          if (myRecord?.hasActiveSessions()) {
            const otherDevices = myRecord
              .getActiveDevices()
              .filter((d) => d.activeSessionId && !sentSessionIds.has(d.activeSessionId))

            if (otherDevices.length > 0) {
              await fanOutToOwnDevices(sentSessionIds)
              return
            }
          }

          // No other devices found - ensure we're listening for them
          get().listenToUserDevices(myPubKey)
        }

        // Send to all peer devices we already have sessions with (concurrently)
        if (userRecord && userRecord.hasActiveSessions()) {
          await Promise.all(
            userRecord.getActiveDevices().map(async (device) => {
              if (!device.activeSessionId) return
              const sessionId = device.activeSessionId
              try {
                await get().sendMessage(sessionId, event)
                sentSessionIds.add(sessionId)
                console.log(`Sent via session ${sessionId}`)
              } catch (err) {
                console.warn(`Failed sending via session ${sessionId}:`, err)
              }
            })
          )

          // Immediately fan-out to own devices
          await fanOutToOwnDevices(sentSessionIds)

          // If at least one peer session succeeded we're done
          if (sentSessionIds.size > 0) {
            return
          }
          // otherwise fall through to invite waiting
        }

        // No existing sessions - listen for invites and queue message
        console.log("No existing sessions, queuing message and listening for invites")

        // Special case for self-messaging - we can't wait for our own invite
        if (userPubKey === myPubKey) {
          // The message is already shown optimistically, so just resolve
          return Promise.resolve()
        }

        return new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            cleanup()
            reject(new Error("Timeout waiting for user invite"))
          }, 10000)

          get().listenToUserDevices(userPubKey)

          const unsubscribe = Invite.fromUser(userPubKey, subscribe, async (invite) => {
            try {
              if (invite.inviter !== userPubKey) {
                console.warn("Received invite from unexpected user:", {
                  expected: userPubKey,
                  actual: invite.inviter,
                })
                return
              }

              cleanup()
              const sessionId = await get().acceptInvite(invite)
              sentSessionIds.add(sessionId)

              // Process any queued messages
              const queue = get().messageQueue.get(userPubKey) || []
              if (queue.length > 0) {
                for (const {event: queuedEvent, resolve: queuedResolve} of queue) {
                  try {
                    await get().sendMessage(sessionId, queuedEvent)
                    sentSessionIds.add(sessionId)
                    queuedResolve(sessionId)
                  } catch (error) {
                    console.warn("Error sending queued message:", error)
                  }
                }
                const newQueue = new Map(get().messageQueue)
                newQueue.delete(userPubKey)
                set({messageQueue: newQueue})
              }

              await get().sendMessage(sessionId, event)
              console.log("sendToUser new sessionId:", sessionId)

              resolve()
            } catch (error) {
              reject(error)
            }
          })

          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId)
            if (unsubscribe) unsubscribe()
          }

          // Queue the message
          const messageQueue = new Map(get().messageQueue)
          const queue = messageQueue.get(userPubKey) || []
          queue.push({event, resolve})
          messageQueue.set(userPubKey, queue)
          set({messageQueue})
        })
      },

      acceptInvite: async (invite: Invite): Promise<string> => {
        const myPubKey = useUserStore.getState().publicKey
        if (!myPubKey) {
          throw new Error("No public key")
        }

        // Check if deviceId is valid before proceeding
        if (!invite.deviceId) {
          console.warn(
            "acceptInvite: invite.deviceId is undefined, cannot create session"
          )
          throw new Error(
            `Invite deviceId is undefined for invite from ${invite.inviter}`
          )
        }

        const inviteKey = `${invite.inviter}:${invite.deviceId}`

        if (pendingInvites.has(inviteKey)) {
          console.log("Invite already being processed:", inviteKey)
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const userRecord = get().userRecords.get(invite.inviter)
          const existingSessionId = userRecord?.getActiveSessionId(invite.deviceId)
          if (existingSessionId) {
            return inviteKey
          }
        }

        pendingInvites.add(inviteKey)

        try {
          // Don't default to "unknown" - use the actual deviceId or throw an error
          const deviceId = invite.deviceId
          if (!deviceId) {
            console.warn(
              "acceptInvite: invite.deviceId is undefined, cannot create session"
            )
            throw new Error(
              `Invite deviceId is undefined for invite from ${invite.inviter}`
            )
          }

          console.log("acceptInvite called:", {
            inviter: invite.inviter,
            deviceId: invite.deviceId,
            actualDeviceId: deviceId,
          })
          const userRecord = get().userRecords.get(invite.inviter)
          const existingSessionId = userRecord?.getActiveSessionId(deviceId)

          if (existingSessionId) {
            console.log("Session already exists with this device:", inviteKey)
            return inviteKey
          }

          const myPrivKey = useUserStore.getState().privateKey
          const encrypt = getEncryptFunction(myPrivKey)

          const {session, event} = await invite.accept(
            (filter, onEvent) => subscribe(filter, onEvent),
            myPubKey,
            encrypt
          )

          const e = NDKEventFromRawEvent(event)
          await e
            .publish()
            .then((res) => console.log("published", res))
            .catch((e) => console.warn("Error publishing event:", e))

          // Use the actual deviceId from invite, not session.name
          const sessionId = `${invite.inviter}:${deviceId}`

          // Add session to sessions store
          useSessionsStore
            .getState()
            .addSession(sessionId, session, invite.inviter, deviceId)

          // Get or create UserRecord
          const userRecords = new Map(get().userRecords)
          let targetUserRecord = userRecords.get(invite.inviter)
          if (!targetUserRecord) {
            targetUserRecord = new UserRecord(invite.inviter, invite.inviter)
            userRecords.set(invite.inviter, targetUserRecord)
          }

          // Add session reference to UserRecord
          targetUserRecord.upsertSession(deviceId, sessionId)

          // Update last seen
          const lastSeen = new Map(get().lastSeen)
          lastSeen.set(sessionId, Date.now())

          set({userRecords, lastSeen})

          // Session listener is automatically set up by sessions store
          // Chat will appear automatically in getChatsList() via userRecords

          // After accepting invite, ensure we store the invite itself so that ChatSettings can list the device
          const invitesMap = new Map(get().invites)
          const deviceInviteKey = invite.deviceId || crypto.randomUUID()
          invitesMap.set(deviceInviteKey, invite)
          set({invites: invitesMap})

          return sessionId
        } finally {
          pendingInvites.delete(inviteKey)
        }
      },

      updateLastSeen: (sessionId: string) => {
        const newLastSeen = new Map(get().lastSeen)
        newLastSeen.set(sessionId, Date.now())
        set({lastSeen: newLastSeen})
      },

      deleteSession: (sessionId: string) => {
        const {userPubKey, deviceId} = UserRecord.parseSessionId(sessionId)
        const userRecords = new Map(get().userRecords)
        const userRecord = userRecords.get(userPubKey)

        if (userRecord) {
          userRecord.deleteSession(deviceId)
          if (userRecord.getTotalSessionCount() === 0) {
            userRecords.delete(userPubKey)
          }
        }

        set({userRecords})

        // Remove session from sessions store
        useSessionsStore.getState().removeSession(sessionId)
        usePrivateMessagesStore.getState().removeSession(sessionId)
      },

      listenToUserDevices: (userPubKey: string) => {
        const myPubKey = useUserStore.getState().publicKey
        const myPrivKey = useUserStore.getState().privateKey
        const nip07Login = useUserStore.getState().nip07Login

        // Skip if no signer (view-only mode)
        if (!myPrivKey && !nip07Login) {
          console.log(
            "No private key or NIP-07 extension - skipping device listening (view-only mode)"
          )
          return
        }

        if (get().deviceInviteListeners.has(userPubKey)) {
          console.log("Already listening to user devices for:", userPubKey)
          return
        }

        console.log("Starting to listen for device invites from user:", userPubKey)

        // Log current state to debug
        const currentUserRecord = get().userRecords.get(userPubKey)
        if (currentUserRecord) {
          console.log(
            "Current sessions for user before listening:",
            currentUserRecord.getActiveDevices().map((d) => ({
              deviceId: d.deviceId,
              sessionId: d.activeSessionId,
            }))
          )
        }

        const unsubscribe = Invite.fromUser(userPubKey, subscribe, async (invite) => {
          console.log("Received invite from user:", {
            inviter: invite.inviter,
            deviceId: invite.deviceId,
            isOurself: invite.inviter === myPubKey,
          })
          try {
            if (invite.inviter !== userPubKey) {
              console.warn("Received invite from unexpected user:", {
                expected: userPubKey,
                actual: invite.inviter,
              })
              return
            }

            // The invite ID is actually the deviceId for device invites
            const inviteDeviceId = invite.deviceId || "unknown"

            // Get device ID the same way createDefaultInvites does
            let ourDeviceId = get().deviceId
            if (!ourDeviceId) {
              const stored = await localforage.getItem<string>("deviceId")
              if (stored) {
                ourDeviceId = stored
                // Update the store with the device ID we found
                set({deviceId: stored})
              }
            }

            console.log("Checking device invite:", {
              inviteDeviceId,
              ourDeviceId,
              isOurDevice: inviteDeviceId === ourDeviceId,
              inviter: invite.inviter,
              isOurself: invite.inviter === myPubKey,
            })

            if (userPubKey === myPubKey && inviteDeviceId === ourDeviceId) {
              console.log(
                "Skipping invite from our own device to prevent loop:",
                inviteDeviceId
              )
              return
            }

            const userRecord = get().userRecords.get(userPubKey)
            console.log("Checking for existing session with deviceId:", inviteDeviceId)
            console.log("UserRecord exists:", !!userRecord)
            if (userRecord) {
              console.log(
                "Active devices:",
                userRecord.getActiveDevices().map((d) => ({
                  deviceId: d.deviceId,
                  hasSession: !!d.activeSessionId,
                }))
              )
            }
            const existingSessionId = userRecord?.getActiveSessionId(inviteDeviceId)

            if (existingSessionId) {
              console.log(
                "Session already exists with this device, skipping invite",
                inviteDeviceId,
                "sessionId:",
                existingSessionId
              )
              return
            }

            // Accept invite directly instead of converting to URL to preserve deviceId
            const inviteKey = `${invite.inviter}:${inviteDeviceId}`

            if (pendingInvites.has(inviteKey)) {
              console.log("Invite already being processed:", inviteKey)
              return
            }

            pendingInvites.add(inviteKey)
            try {
              const sessionId = await get().acceptInvite(invite)
              console.log("Accepted invite from user device:", sessionId)
            } finally {
              pendingInvites.delete(inviteKey)
            }
          } catch (error) {
            console.warn("Error accepting user device invite:", error)
          }
        })

        const listeners = new Map(get().deviceInviteListeners)
        listeners.set(userPubKey, unsubscribe)
        set({deviceInviteListeners: listeners})
      },

      stopListeningToUserDevices: (userPubKey: string) => {
        const deviceId = get().deviceId
        const key = `${userPubKey}:${deviceId}`
        const listeners = get().deviceInviteListeners
        const unsubscribe = listeners.get(key)

        if (unsubscribe) {
          unsubscribe()
          const newListeners = new Map(listeners)
          newListeners.delete(key)
          set({deviceInviteListeners: newListeners})
          console.log("Stopped listening to user devices for:", userPubKey)
        }
      },

      getPreferredSession: (userPubKey: string) => {
        const userRecord = get().userRecords.get(userPubKey)
        return userRecord?.getPreferredSessionId() || null
      },

      getOwnDeviceInvites: () => {
        const myPubKey = useUserStore.getState().publicKey
        if (!myPubKey) {
          return new Map()
        }

        const ownInvites = new Map<string, Invite>()
        Array.from(get().invites.entries()).forEach(([id, invite]) => {
          if (invite.inviter === myPubKey) {
            ownInvites.set(id, invite)
          }
        })

        return ownInvites
      },

      reset: () => {
        console.log("Resetting user records store...")

        // Close all user records
        const userRecords = get().userRecords
        for (const userRecord of userRecords.values()) {
          userRecord.close()
        }

        // Clean up all invite listeners
        for (const unsubscribe of inviteListeners.values()) {
          unsubscribe()
        }

        // Clean up device invite listeners
        const deviceListeners = get().deviceInviteListeners
        for (const unsubscribe of deviceListeners.values()) {
          unsubscribe()
        }

        // Reset sessions store
        useSessionsStore.getState().reset()

        // Reset state
        set({
          invites: new Map(),
          userRecords: new Map(),
          lastSeen: new Map(),
          deviceId: "",
          deviceInviteListeners: new Map(),
          messageQueue: new Map(),
        })

        // Clear global maps
        inviteListeners.clear()
        pendingInvites.clear()

        console.log("User records store reset completed.")
      },

      initializeListeners: async () => {
        const myPubKey = useUserStore.getState().publicKey
        const myPrivKey = useUserStore.getState().privateKey
        const nip07Login = useUserStore.getState().nip07Login
        let currentDeviceId = get().deviceId

        // Skip invite listening if no signer (view-only mode)
        if (!myPrivKey && !nip07Login) {
          console.log(
            "No private key or NIP-07 extension - skipping invite listeners (view-only mode)"
          )
          return
        }

        // If deviceId is not in store, try to load from localforage
        if (!currentDeviceId) {
          const stored = await localforage.getItem<string>("deviceId")
          if (stored) {
            currentDeviceId = stored
            set({deviceId: stored})
            console.log("Loaded deviceId from storage in initializeListeners:", stored)
          }
        }

        if (!myPubKey || !currentDeviceId) {
          console.error("No public key or device ID available for initializeListeners")
          return
        }

        console.log("Initializing listener for current device invite:", currentDeviceId)

        const invite = get().invites.get(currentDeviceId)
        if (!invite || invite.inviter !== myPubKey) {
          console.log("No invite found for current device or not our invite")
          return
        }

        // Skip if already listening
        if (inviteListeners.has(currentDeviceId)) {
          console.log("Already listening to current device invite")
          return
        }

        console.log("Starting listener for current device invite:", currentDeviceId)

        const decrypt = getDecryptFunction(myPrivKey)

        const unsubscribe = invite.listen(decrypt, subscribe, (session, identity) => {
          if (!identity) return

          // Check if we already have a session with this user from our device
          const userRecord = get().userRecords.get(identity)
          const existingSessionId = userRecord?.getActiveSessionId(currentDeviceId)

          if (existingSessionId) {
            console.log(
              "Session already exists from our device to this user, skipping",
              existingSessionId
            )
            return
          }

          // Use the current device ID
          const sessionId = `${identity}:${currentDeviceId}`

          // Add session to sessions store
          useSessionsStore
            .getState()
            .addSession(sessionId, session, identity, currentDeviceId)

          // Get or create UserRecord
          const userRecords = new Map(get().userRecords)
          let targetUserRecord = userRecords.get(identity)
          if (!targetUserRecord) {
            targetUserRecord = new UserRecord(identity, identity)
            userRecords.set(identity, targetUserRecord)
          }

          // Add session reference to UserRecord with proper deviceId
          targetUserRecord.upsertSession(currentDeviceId, sessionId)

          // Update last seen
          const lastSeen = new Map(get().lastSeen)
          lastSeen.set(sessionId, Date.now())

          set({userRecords, lastSeen})

          // Session listener is automatically set up by sessions store
          // Chat will appear automatically in getChatsList() via userRecords
        })

        inviteListeners.set(currentDeviceId, unsubscribe)
        console.log("Initialization of listener completed for device:", currentDeviceId)
      },

      initializeSessionListeners: () => {
        console.log("Initializing session listeners via sessions store...")

        // Sessions store now handles event routing automatically
        // Set up callback to trigger UI updates when session events occur
        useSessionsStore.getState().onSessionEvent(() => {
          // Trigger userRecords persistence for UI updates
          set({userRecords: new Map(get().userRecords)})
        })
      },
    }),
    {
      name: "userRecords",
      storage: createJSONStorage(() => localforage),
      partialize: (state: UserRecordsStore) => ({
        // Only serialize user records (no session data), invites, and metadata
        invites: Array.from(state.invites.entries()).map(([id, invite]) => [
          id,
          invite.serialize(),
        ]),
        userRecords: Array.from(state.userRecords.entries()).map(([id, userRecord]) => [
          id,
          userRecord.serialize(),
        ]),
        lastSeen: Array.from(state.lastSeen.entries()),
        deviceId: state.deviceId,
      }),
      merge: (persistedState: unknown, currentState: UserRecordsStore) => {
        const state = (persistedState || {
          invites: [],
          userRecords: [],
          lastSeen: [],
          deviceId: "",
        }) as {
          invites: [string, string][]
          userRecords: [string, string][]
          lastSeen: [string, number][]
          deviceId: string
        }

        const newInvites = new Map<string, Invite>()
        state.invites?.forEach(([id, serializedInvite]) => {
          try {
            const invite = Invite.deserialize(serializedInvite)
            newInvites.set(id, invite)
          } catch (e) {
            console.warn("Failed to deserialize invite:", id, e)
          }
        })

        const newUserRecords = new Map<string, UserRecord>()
        state.userRecords?.forEach(([userPubKey, serializedUserRecord]) => {
          try {
            const userRecord = new UserRecord(userPubKey, userPubKey)
            userRecord.deserialize(serializedUserRecord)
            newUserRecords.set(userPubKey, userRecord)
          } catch (e) {
            console.warn("Failed to deserialize user record:", userPubKey, e)
          }
        })

        return {
          ...currentState,
          invites: newInvites,
          userRecords: newUserRecords,
          lastSeen: new Map<string, number>(state.lastSeen || []),
          deviceId: state.deviceId,
          deviceInviteListeners: new Map(),
          messageQueue: new Map(),
        }
      },
      onRehydrateStorage: () => (state) => {
        // Trigger session listener initialization after rehydration
        if (state) {
          console.log("Storage rehydrated, scheduling session listener initialization")
          setTimeout(async () => {
            // Ensure deviceId is loaded before initializing listeners
            if (!state.deviceId) {
              const stored = await localforage.getItem<string>("deviceId")
              if (stored) {
                state.deviceId = stored
                console.log("Loaded deviceId from storage during rehydration:", stored)
              }
            }
            state.initializeSessionListeners()
          }, 100)
        }
      },
    }
  )
)
