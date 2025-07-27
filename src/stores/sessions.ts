import {
  Invite,
  Session,
  serializeSessionState,
  deserializeSessionState,
} from "nostr-double-ratchet/src"
import {createJSONStorage, persist, PersistStorage} from "zustand/middleware"
import {Filter, VerifiedEvent, UnsignedEvent} from "nostr-tools"
import {NostrEventFromRawEvent, RawEvent} from "@/utils/nostr"
import {REACTION_KIND} from "@/pages/chats/utils/constants"
import type {MessageType} from "@/pages/chats/message/Message"
import {hexToBytes} from "@noble/hashes/utils"
import {useEventsStore} from "./events"
import localforage from "localforage"
import {useUserStore} from "./user"
import {subscribe as applesauceSubscribe} from "@/utils/applesauce"
import {create} from "zustand"
import {useGroupsStore} from "./groups"

// Changing storage engine doesn't trigger migration. Only version difference in storage does.
// Here's an utility function that works around it by setting a dummy entry with version 0.
// Simplified version of the code here:
// https://github.com/pmndrs/zustand/discussions/1717#discussioncomment-9355154
const forceMigrationOnInitialPersist = <S>(
  originalStorage: PersistStorage<S> | undefined,
  initialState: S
): PersistStorage<S> | undefined =>
  originalStorage === undefined
    ? originalStorage
    : {
        ...originalStorage,
        getItem: async (name) => {
          const item = await originalStorage.getItem(name)
          return item ?? {state: initialState, version: 0}
        },
      }

interface SessionStoreState {
  invites: Map<string, Invite>
  sessions: Map<string, Session>
  lastSeen: Map<string, number>
}

const createSessionWithLastSeen = (
  currentSessions: Map<string, Session>,
  currentLastSeen: Map<string, number>,
  sessionId: string,
  session: Session
) => {
  const newSessions = new Map(currentSessions)
  newSessions.set(sessionId, session)
  const newLastSeen = new Map(currentLastSeen)
  newLastSeen.set(sessionId, Date.now())
  return {sessions: newSessions, lastSeen: newLastSeen}
}

const inviteListeners = new Map<string, () => void>()
const sessionListeners = new Map<string, () => void>()

interface SessionStoreActions {
  createInvite: (label: string, inviteId?: string) => void
  createDefaultInvites: () => void
  acceptInvite: (url: string) => Promise<string>
  sendMessage: (id: string, event: Partial<UnsignedEvent>) => Promise<void>
  sendToUser: (userPubKey: string, event: Partial<UnsignedEvent>) => Promise<string>
  updateLastSeen: (sessionId: string) => void
  deleteInvite: (id: string) => void
  deleteSession: (id: string) => void
}

type SessionStore = SessionStoreState & SessionStoreActions
const subscribe = (filter: Filter, onEvent: (event: VerifiedEvent) => void) => {
  const sub = applesauceSubscribe(filter)
  sub.on("event", (e) => onEvent(e as unknown as VerifiedEvent))
  return () => sub.stop()
}

const routeEventToStore = (sessionId: string, message: MessageType) => {
  const from = sessionId.split(":")[0]
  // Set pubkey to the original message pubkey, or from if not set
  if (!message.pubkey || message.pubkey !== "user") {
    message.pubkey = from
  }
  const groupLabelTag = message.tags?.find((tag: string[]) => tag[0] === "l")
  const targetId = groupLabelTag && groupLabelTag[1] ? groupLabelTag[1] : sessionId
  useEventsStore.getState().upsert(targetId, message)
}

const store = create<SessionStore>()(
  persist(
    (set, get) => ({
      invites: new Map(),
      sessions: new Map(),
      lastSeen: new Map(),
      createDefaultInvites: async () => {
        const myPubKey = useUserStore.getState().publicKey
        if (!myPubKey) {
          throw new Error("No public key")
        }
        if (!get().invites.has("public")) {
          get().createInvite("Public Invite", "public")
          const invite = get().invites.get("public")
          if (!invite) {
            return
          }
          const event = invite.getEvent() as RawEvent
          console.log("Publishing public invite...", event)
          try {
            const res = await NostrEventFromRawEvent(event)
            console.log("Published public invite", res)
          } catch (e) {
            console.warn("Error publishing public invite:", e)
          }
        }
        if (!get().invites.has("private")) {
          get().createInvite("Private Invite", "private")
        }
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
      createInvite: (label: string, inviteId?: string) => {
        const myPubKey = useUserStore.getState().publicKey
        const myPrivKey = useUserStore.getState().privateKey
        if (!myPubKey) {
          throw new Error("No public key")
        }
        const invite = Invite.createNew(myPubKey, label)
        const id = inviteId || crypto.randomUUID()
        const currentInvites = get().invites

        const newInvites = new Map(currentInvites)
        newInvites.set(id, invite)
        const decrypt = myPrivKey
          ? hexToBytes(myPrivKey)
          : async (cipherText: string, pubkey: string) => {
              if (window.nostr?.nip44) {
                return window.nostr.nip44.decrypt(pubkey, cipherText)
              }
              throw new Error("No nostr extension or private key")
            }
        const unsubscribe = invite.listen(decrypt, subscribe, (session, identity) => {
          const sessionId = `${identity}:${session.name}`
          if (sessionListeners.has(sessionId)) {
            return
          }
          const newState = createSessionWithLastSeen(
            store.getState().sessions,
            store.getState().lastSeen,
            sessionId,
            session
          )
          store.setState(newState)
          const sessionUnsubscribe = session.onEvent((event) => {
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
            routeEventToStore(sessionId, event)
            store.setState({sessions: new Map(store.getState().sessions)})
          })
          sessionListeners.set(sessionId, sessionUnsubscribe)
        })
        inviteListeners.set(id, unsubscribe)
        set({invites: newInvites})
      },
      sendMessage: async (sessionId: string, event: Partial<UnsignedEvent>) => {
        const session = get().sessions.get(sessionId)
        if (!session) {
          throw new Error("Session not found")
        }
        if (event.kind === REACTION_KIND && !event.tags?.find((tag) => tag[0] === "e")) {
          throw new Error("Cannot send a reaction without a replyingToId")
        }
        const {event: publishedEvent, innerEvent} = session.sendEvent(event)
        const message: MessageType = {
          ...innerEvent,
          pubkey: "user",
          reactions: {},
        }
        // Optimistic update
        routeEventToStore(sessionId, message)
        try {
          const e = await NostrEventFromRawEvent(publishedEvent)
          // TODO: Implement publishing with applesauce
          console.log("Event converted (publishing disabled):", e, publishedEvent.id)
        } catch (err) {
          console.warn("Error converting event:", err)
        }
        // make sure we persist session state
        set({sessions: new Map(get().sessions)})
      },
      sendToUser: async (
        userPubKey: string,
        event: Partial<UnsignedEvent>
      ): Promise<string> => {
        console.log("sendToUser:", {userPubKey, event})
        // First, try to find an existing session with this user
        const existingSessionId = Array.from(get().sessions.keys()).find((sessionId) =>
          sessionId.startsWith(`${userPubKey}:`)
        )
        if (existingSessionId) {
          await get().sendMessage(existingSessionId, event)
          console.log("sendToUser existingSessionId:", existingSessionId)
          console.log("sendToUser result:", existingSessionId)
          return existingSessionId
        }
        // No existing session, try to create one via Invite.fromUser
        return new Promise((resolve, reject) => {
          const timeoutId: NodeJS.Timeout = setTimeout(() => {
            cleanup()
            reject(new Error("Timeout waiting for user invite"))
          }, 10000) // 10 second timeout
          const unsubscribe = Invite.fromUser(userPubKey, subscribe, async (invite) => {
            try {
              cleanup()
              const sessionId = await get().acceptInvite(invite.getUrl())
              await get().sendMessage(sessionId, event)
              console.log("sendToUser new sessionId:", sessionId)
              console.log("sendToUser result:", sessionId)
              resolve(sessionId)
            } catch (error) {
              reject(error)
            }
          })
          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId)
            if (unsubscribe) unsubscribe()
          }
        })
      },
      acceptInvite: async (url: string): Promise<string> => {
        const invite = Invite.fromUrl(url)
        const myPubKey = useUserStore.getState().publicKey
        if (!myPubKey) {
          throw new Error("No public key")
        }
        const myPrivKey = useUserStore.getState().privateKey
        const encrypt = myPrivKey
          ? hexToBytes(myPrivKey)
          : async (plaintext: string, pubkey: string) => {
              if (window.nostr?.nip44) {
                return window.nostr.nip44.encrypt(pubkey, plaintext)
              }
              throw new Error("No nostr extension or private key")
            }
        const {session, event} = await invite.accept(
          (filter, onEvent) => subscribe(filter, onEvent),
          myPubKey,
          encrypt
        )
        try {
          const e = await NostrEventFromRawEvent(event)
          // TODO: Implement publishing with applesauce
          console.log("Event converted (publishing disabled):", e)
        } catch (e) {
          console.warn("Error converting event:", e)
        }
        const sessionId = `${invite.inviter}:${session.name}`
        if (sessionListeners.has(sessionId)) {
          return sessionId
        }
        const newState = createSessionWithLastSeen(
          get().sessions,
          get().lastSeen,
          sessionId,
          session
        )
        const sessionUnsubscribe = session.onEvent((event) => {
          routeEventToStore(sessionId, event)
          // make sure we persist session state
          set({sessions: new Map(get().sessions)})
        })
        sessionListeners.set(sessionId, sessionUnsubscribe)
        set(newState)
        return sessionId
      },
      updateLastSeen: (sessionId: string) => {
        const newLastSeen = new Map(get().lastSeen)
        newLastSeen.set(sessionId, Date.now())
        set({lastSeen: newLastSeen})
      },
      deleteSession: (sessionId: string) => {
        const newSessions = new Map(get().sessions)
        newSessions.delete(sessionId)
        set({sessions: newSessions})
        const unsubscribe = sessionListeners.get(sessionId)
        if (unsubscribe) {
          unsubscribe()
          sessionListeners.delete(sessionId)
        }
        useEventsStore.getState().removeSession(sessionId)
      },
    }),
    {
      name: "sessions",
      onRehydrateStorage: () => async (state) => {
        await useUserStore.getState().awaitHydration()

        const privateKey = useUserStore.getState().privateKey
        const decrypt = privateKey
          ? hexToBytes(privateKey)
          : async (cipherText: string, pubkey: string) => {
              if (window.nostr?.nip44) {
                return window.nostr.nip44.decrypt(pubkey, cipherText)
              }
              throw new Error("No nostr extension or private key")
            }
        Array.from(state?.invites || []).forEach(([id, invite]) => {
          if (inviteListeners.has(id)) {
            return
          }
          const inviteUnsubscribe = invite.listen(
            decrypt,
            subscribe,
            (session, identity) => {
              const sessionId = `${identity}:${session.name}`
              if (sessionListeners.has(sessionId)) {
                return
              }
              const newState = createSessionWithLastSeen(
                store.getState().sessions,
                store.getState().lastSeen,
                sessionId,
                session
              )
              store.setState(newState)
              const sessionUnsubscribe = session.onEvent((event) => {
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
                routeEventToStore(sessionId, event)
                store.setState({sessions: new Map(store.getState().sessions)})
              })
              sessionListeners.set(sessionId, sessionUnsubscribe)
            }
          )
          inviteListeners.set(id, inviteUnsubscribe)
        })
        Array.from(state?.sessions || []).forEach(([sessionId, session]) => {
          if (sessionListeners.has(sessionId)) {
            return
          }
          // Ensure lastSeen entry exists for rehydrated sessions
          const currentLastSeen = store.getState().lastSeen
          if (!currentLastSeen.has(sessionId)) {
            const newLastSeen = new Map(currentLastSeen)
            newLastSeen.set(sessionId, Date.now())
            store.setState({lastSeen: newLastSeen})
          }
          const sessionUnsubscribe = session.onEvent((event) => {
            // Handle group creation event (kind 40)
            if (event.kind === 40 && event.content) {
              try {
                const group = JSON.parse(event.content)
                const groups = useGroupsStore.getState().groups
                if (!groups[group.id]) {
                  useGroupsStore.getState().addGroup(group)
                }
                console.log("group created", group)
              } catch (e) {
                console.warn("Failed to parse group from kind 40 event", e)
              }
            }
            routeEventToStore(sessionId, event)
            store.setState({sessions: new Map(store.getState().sessions)})
          })
          sessionListeners.set(sessionId, sessionUnsubscribe)
        })
      },
      storage: forceMigrationOnInitialPersist(
        createJSONStorage(() => localforage),
        JSON.parse(localStorage.getItem("sessions") || "null")
      ),
      version: 1,
      migrate: async (oldData: unknown, version) => {
        if (version === 0 && oldData) {
          const data = {
            version: 1,
            state: oldData as SessionStore,
          }

          const dataString = JSON.stringify(data)

          await localforage.setItem("sessions", dataString)

          return data.state
        }
      },
      partialize: (state) => {
        return {
          invites: Array.from(state.invites.entries()).map((entry) => {
            const [id, invite] = entry as [string, Invite]
            return [id, invite.serialize()]
          }),
          sessions: Array.from(state.sessions.entries()).map((entry) => {
            const [id, session] = entry as [string, Session]
            return [id, serializeSessionState(session.state)]
          }),
          lastSeen: Array.from(state.lastSeen.entries()),
        }
      },
      merge: (persistedState: unknown, currentState: SessionStore) => {
        const state = (persistedState || {
          invites: [],
          sessions: [],
          lastSeen: [],
        }) as {
          invites: [string, string][]
          sessions: [string, string][]
          lastSeen: [string, number][]
        }
        const newSessions: [string, Session][] = state.sessions.map(
          ([id, sessionState]: [string, string]) => {
            const session = new Session(subscribe, deserializeSessionState(sessionState))
            return [id, session] as [string, Session]
          }
        )
        const newInvites: [string, Invite][] = state.invites.map(
          (entry: [string, string]) => {
            const [id, invite] = entry
            return [id, Invite.deserialize(invite)] as [string, Invite]
          }
        )
        return {
          ...currentState,
          invites: new Map<string, Invite>(newInvites),
          sessions: new Map<string, Session>(newSessions),
          lastSeen: new Map<string, number>(state.lastSeen || []),
        }
      },
    }
  )
)

export const useSessionsStore = store
