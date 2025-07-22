import {
  Session,
  serializeSessionState,
  deserializeSessionState,
} from "nostr-double-ratchet/src"
import {createJSONStorage, persist} from "zustand/middleware"
import type {MessageType} from "@/pages/chats/message/Message"
import {Filter, UnsignedEvent, VerifiedEvent} from "nostr-tools"
import {NDKEventFromRawEvent} from "@/utils/nostr"
import {REACTION_KIND} from "@/pages/chats/utils/constants"
import {ndk} from "@/utils/ndk"
import localforage from "localforage"
import {create} from "zustand"

// Import stores that we need for event routing
import {useEventsStore} from "./events"
import {useUserStore} from "./user"
import {useGroupsStore} from "./groups"
import {useUserRecordsStore} from "./userRecords"
import {UserRecord} from "./UserRecord"
import throttle from "lodash/throttle"

// Parse sessionId to get user info (moved from UserRecord)
const parseSessionId = (sessionId: string): {userPubKey: string; deviceId: string} => {
  const [userPubKey, deviceId] = sessionId.split(":")
  return {userPubKey, deviceId: deviceId || "unknown"}
}

// Route events to the appropriate store based on message content and tags
const routeEventToStore = (sessionId: string, message: MessageType) => {
  const {userPubKey} = parseSessionId(sessionId)

  // Set pubkey to the original message pubkey, or from if not set
  if (!message.pubkey || message.pubkey !== "user") {
    message.pubkey = userPubKey
  }

  // Check for ['p', recipientPubKey] tag, but only use for routing if authored by us
  const pTag = message.tags?.find((tag: string[]) => tag[0] === "p")
  const groupLabelTag = message.tags?.find((tag: string[]) => tag[0] === "l")
  const myPubKey = useUserStore.getState().publicKey
  let targetId

  if (groupLabelTag && groupLabelTag[1]) {
    // Group message - store by group ID
    targetId = groupLabelTag[1]
  } else if (
    pTag &&
    pTag[1] &&
    (message.pubkey === myPubKey || message.pubkey === "user")
  ) {
    // Message sent by us with recipient tag - store by recipient pubkey
    targetId = pTag[1]
  } else {
    // Private message - always store by the other user's pubkey, not sessionId
    targetId = userPubKey
  }

  useEventsStore.getState().upsert(targetId, message)
}

// Helper subscribe implementation for Session reconstruction
const sessionSubscribe = (
  filter: Filter,
  onEvent: (event: VerifiedEvent) => void
): (() => void) => {
  console.log("sessionSubscribe called with filter:", filter)
  const sub = ndk().subscribe(filter)
  sub.on("event", (e: unknown) => {
    const event = e as VerifiedEvent
    console.log("sessionSubscribe received event:", {
      id: event?.id,
      kind: event?.kind,
      pubkey: event?.pubkey,
      authors: filter?.authors,
      filterMatch: filter?.authors?.includes(event?.pubkey),
      kindMatch: filter?.kinds?.includes(event?.kind),
    })
    onEvent(event)
  })
  return () => {
    console.log("sessionSubscribe unsubscribing from filter:", filter)
    sub.stop()
  }
}

interface SessionsStoreState {
  sessions: Map<string, Session> // sessionId -> Session
  sessionListeners: Map<string, () => void> // sessionId -> unsubscribe function
  eventCallbacks: Set<(sessionId: string, event: MessageType) => void> // External event callbacks
}

interface SessionsStoreActions {
  // Session management
  addSession: (sessionId: string, session: Session) => void
  removeSession: (sessionId: string) => void
  getSession: (sessionId: string) => Session | undefined
  hasSession: (sessionId: string) => boolean
  getAllSessionIds: () => string[]

  // Session state updates (triggers individual persistence)
  updateSession: (sessionId: string) => void
  updateSessionthrottled: (sessionId: string) => void

  // Send methods
  sendMessage: (sessionId: string, event: Partial<UnsignedEvent>) => Promise<void>

  // Event listeners (internal - sessions store handles these automatically)
  setSessionListener: (sessionId: string, onEvent: (event: MessageType) => void) => void
  removeSessionListener: (sessionId: string) => void

  // Event callbacks (for external stores to get notified)
  onSessionEvent: (
    callback: (sessionId: string, event: MessageType) => void
  ) => () => void

  // Initialization
  initializeSessionListeners: (
    onEvent: (sessionId: string, event: MessageType) => void
  ) => void

  // Utilities
  reset: () => void
}

type SessionsStore = SessionsStoreState & SessionsStoreActions

export const useSessionsStore = create<SessionsStore>()(
  persist(
    (set, get) => {
      // Create throttled version of updateSession
      const throttledUpdateSession = throttle((sessionId: string) => {
        console.log("throttled persistence trigger for session:", sessionId)
        const newSessions = new Map(get().sessions)
        set({sessions: newSessions})
      }, 100) // 100ms debounce

      return {
        sessions: new Map(),
        sessionListeners: new Map(),
        eventCallbacks: new Set(),

        addSession: (sessionId: string, session: Session) => {
          console.log("Adding session:", sessionId)
          const newSessions = new Map(get().sessions)
          newSessions.set(sessionId, session)
          set({sessions: newSessions})

          // Automatically set up event listener for the new session
          get().setSessionListener(sessionId, (event) => {
            handleSessionEvent(get, sessionId, event)
          })
        },

        removeSession: (sessionId: string) => {
          console.log("Removing session:", sessionId)
          const session = get().sessions.get(sessionId)
          if (session) {
            session.close()
          }

          // Remove from sessions
          const newSessions = new Map(get().sessions)
          newSessions.delete(sessionId)

          // Remove listener
          get().removeSessionListener(sessionId)

          set({sessions: newSessions})
        },

        getSession: (sessionId: string) => {
          return get().sessions.get(sessionId)
        },

        hasSession: (sessionId: string) => {
          return get().sessions.has(sessionId)
        },

        getAllSessionIds: () => {
          return Array.from(get().sessions.keys())
        },

        updateSession: (sessionId: string) => {
          // Force persistence for this specific session by recreating the Map
          // This is more efficient than the current approach of serializing all user records
          console.log("Triggering persistence for session:", sessionId)
          const newSessions = new Map(get().sessions)
          set({sessions: newSessions})
        },

        updateSessionthrottled: throttledUpdateSession,

        sendMessage: async (sessionId: string, event: Partial<UnsignedEvent>) => {
          const session = get().sessions.get(sessionId)
          if (!session) {
            throw new Error(`Session not found: ${sessionId}`)
          }

          // Debug session state
          console.log("Session state for sending:", {
            sessionId,
            hasTheirNextKey: !!session.state?.theirNextNostrPublicKey,
            hasOurCurrentKey: !!session.state?.ourCurrentNostrKey,
            canSend: !!(
              session.state?.theirNextNostrPublicKey && session.state?.ourCurrentNostrKey
            ),
          })

          // Check if session can send messages
          if (
            !session.state?.theirNextNostrPublicKey ||
            !session.state?.ourCurrentNostrKey
          ) {
            console.error("Session not ready to send messages:", sessionId, {
              theirNextKey: !!session.state?.theirNextNostrPublicKey,
              ourCurrentKey: !!session.state?.ourCurrentNostrKey,
            })
            throw new Error(
              "Session not ready to send messages - missing keys after deserialization"
            )
          }

          if (
            event.kind === REACTION_KIND &&
            !event.tags?.find((tag) => tag[0] === "e")
          ) {
            throw new Error("Cannot send a reaction without a replyingToId")
          }

          const {event: publishedEvent, innerEvent} = session.sendEvent(event)

          // Optimistic update – show our own message immediately
          if (innerEvent) {
            routeEventToStore(sessionId, {
              ...innerEvent,
              pubkey: "user",
              reactions: {},
            } as MessageType)
          }

          try {
            const e = NDKEventFromRawEvent(publishedEvent)
            // Debug NDK connection status
            const ndkInstance = ndk()
            console.log(
              "NDK connected relays:",
              ndkInstance.pool.connectedRelays().length
            )
            console.log("NDK total relays:", ndkInstance.pool.relays.size)

            await e.publish(undefined, undefined, 0)
            console.log("published", publishedEvent.id)
          } catch (err) {
            console.warn("Error publishing event:", err)
          }

          // Trigger throttled persistence for this session
          get().updateSessionthrottled(sessionId)
        },

        setSessionListener: (
          sessionId: string,
          onEvent: (event: MessageType) => void
        ) => {
          const session = get().sessions.get(sessionId)
          if (!session) {
            console.warn("Cannot set listener for non-existent session:", sessionId)
            return
          }

          // Remove existing listener if any
          get().removeSessionListener(sessionId)

          // Set up new listener
          const unsubscribe = session.onEvent((event) => {
            console.log("Session event received:", sessionId, event.kind)
            onEvent(event)
            // Trigger persistence for this session
            get().updateSession(sessionId)
          })

          const newListeners = new Map(get().sessionListeners)
          newListeners.set(sessionId, unsubscribe)
          set({sessionListeners: newListeners})
        },

        removeSessionListener: (sessionId: string) => {
          const unsubscribe = get().sessionListeners.get(sessionId)
          if (unsubscribe) {
            unsubscribe()
            const newListeners = new Map(get().sessionListeners)
            newListeners.delete(sessionId)
            set({sessionListeners: newListeners})
          }
        },

        onSessionEvent: (callback: (sessionId: string, event: MessageType) => void) => {
          const callbacks = new Set(get().eventCallbacks)
          callbacks.add(callback)
          set({eventCallbacks: callbacks})

          // Return unsubscribe function
          return () => {
            const newCallbacks = new Set(get().eventCallbacks)
            newCallbacks.delete(callback)
            set({eventCallbacks: newCallbacks})
          }
        },

        initializeSessionListeners: (
          onEvent: (sessionId: string, event: MessageType) => void
        ) => {
          console.log("Initializing session listeners for all deserialized sessions...")
          const sessions = get().sessions
          let count = 0

          // Small delay to ensure sessions are fully reconstructed
          setTimeout(() => {
            for (const [sessionId, session] of sessions.entries()) {
              if (!get().sessionListeners.has(sessionId)) {
                console.log("Setting up listener for deserialized session:", sessionId)

                // Debug session state after deserialization
                console.log("Deserialized session state:", {
                  sessionId,
                  hasTheirNextKey: !!session.state?.theirNextNostrPublicKey,
                  hasOurCurrentKey: !!session.state?.ourCurrentNostrKey,
                  canSend: !!(
                    session.state?.theirNextNostrPublicKey &&
                    session.state?.ourCurrentNostrKey
                  ),
                })

                // Set up listener that calls the provided onEvent callback
                get().setSessionListener(sessionId, (event) => {
                  onEvent(sessionId, event)
                })
                count++
              }
            }

            console.log(
              `Initialized ${count} session listeners for deserialized sessions`
            )
          }, 100)
        },

        reset: () => {
          console.log("Resetting sessions store...")

          // Close all sessions
          for (const session of get().sessions.values()) {
            session.close()
          }

          // Remove all listeners
          for (const unsubscribe of get().sessionListeners.values()) {
            unsubscribe()
          }

          set({
            sessions: new Map(),
            sessionListeners: new Map(),
            eventCallbacks: new Set(),
          })

          console.log("Sessions store reset completed.")
        },
      }
    },
    {
      name: "sessions",
      storage: createJSONStorage(() => localforage),
      partialize: (state: SessionsStore) => ({
        // Only serialize sessions, not listeners (they'll be recreated)
        sessions: Array.from(state.sessions.entries()).map(([sessionId, session]) => [
          sessionId,
          serializeSessionState(session.state),
        ]),
      }),
      merge: (persistedState: unknown, currentState: SessionsStore) => {
        const state = (persistedState || {sessions: []}) as {
          sessions: [string, string][]
        }

        const newSessions = new Map<string, Session>()
        state.sessions?.forEach(([sessionId, serializedState]) => {
          try {
            const sessionState = deserializeSessionState(serializedState)
            const session = new Session(sessionSubscribe, sessionState)
            newSessions.set(sessionId, session)
            console.log("Successfully deserialized session:", sessionId)
          } catch (e) {
            console.warn("Failed to deserialize session:", sessionId, e)
            // Individual session failures don't affect others
          }
        })

        return {
          ...currentState,
          sessions: newSessions,
          sessionListeners: new Map(), // Will be recreated in onRehydrateStorage
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log("Sessions store rehydrated, wiring listeners for hydrated sessions")
          setTimeout(() => {
            state.initializeSessionListeners((sessionId, event) => {
              handleSessionEvent(() => state, sessionId, event)
            })
          }, 50)
        }
      },
    }
  )
)

// Helper to process any session event consistently
const handleSessionEvent = (
  get: () => SessionsStore,
  sessionId: string,
  event: MessageType
) => {
  // Handle group creation event (kind 40)
  if (event.kind === 40 && event.content) {
    try {
      const group = JSON.parse(event.content)
      const groups = useGroupsStore.getState().groups
      if (!groups[group.id]) {
        useGroupsStore.getState().addGroup(group)
      }
    } catch (e) {
      console.warn("Failed to parse group from kind 40 event", e)
    }
  }

  // Fallback: if message has an "l" tag (group id) ensure group exists
  const groupLabel = event.tags?.find((t) => t[0] === "l")?.[1]
  if (groupLabel && !useGroupsStore.getState().groups[groupLabel]) {
    useGroupsStore.getState().addGroup({
      id: groupLabel,
      name: groupLabel, // placeholder
      description: "",
      picture: "",
      members: [],
      createdAt: Date.now(),
    })
  }

  // Route to events store
  routeEventToStore(sessionId, event)

  // --- Ensure UserRecord exists and session is referenced ---
  const {userPubKey, deviceId} = parseSessionId(sessionId)
  const urStore = useUserRecordsStore.getState()
  if (!urStore.userRecords.has(userPubKey)) {
    const newRecord = new UserRecord(userPubKey, userPubKey)
    const map = new Map(urStore.userRecords)
    map.set(userPubKey, newRecord)
    useUserRecordsStore.setState({userRecords: map})
  }

  // Ensure sessionId is linked to this user/device
  const me = useUserStore.getState().publicKey
  const myDeviceId = useUserRecordsStore.getState().deviceId
  if (!(userPubKey === me && deviceId === myDeviceId)) {
    const rec = useUserRecordsStore.getState().userRecords.get(userPubKey)!
    if (rec && !rec.getActiveSessionId(deviceId)) {
      rec.upsertSession(deviceId, sessionId)
      // trigger persistence
      useUserRecordsStore.setState({
        userRecords: new Map(useUserRecordsStore.getState().userRecords),
      })
    }
  }

  // Notify external callbacks
  for (const cb of get().eventCallbacks) {
    try {
      cb(sessionId, event)
    } catch (err) {
      console.warn("Error in session event callback", err)
    }
  }
}
