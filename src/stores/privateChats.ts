import {createJSONStorage, persist} from "zustand/middleware"
import localforage from "localforage"
import {create} from "zustand"

interface PrivateChatsState {
  chatPublicKeys: Set<string>
  lastSeen: Map<string, number>
  lastSeenPublic: Map<string, number>
}

interface PrivateChatsActions {
  addChat: (publicKey: string) => void
  removeChat: (publicKey: string) => void
  updateLastSeen: (publicKey: string, timestamp?: number) => void
  updateLastSeenPublic: (publicKey: string, timestamp?: number) => void
}

type PrivateChatsStore = PrivateChatsState & PrivateChatsActions

const store = create<PrivateChatsStore>()(
  persist(
    (set, get) => ({
      chatPublicKeys: new Set(),
      lastSeen: new Map(),
      lastSeenPublic: new Map(),

      addChat: (publicKey: string) => {
        const currentChats = get().chatPublicKeys
        const newChats = new Set(currentChats)
        newChats.add(publicKey)
        set({chatPublicKeys: newChats})
      },

      removeChat: (publicKey: string) => {
        const currentChats = get().chatPublicKeys
        const currentLastSeen = get().lastSeen
        const currentLastSeenPublic = get().lastSeenPublic
        const newChats = new Set(currentChats)
        const newLastSeen = new Map(currentLastSeen)
        const newLastSeenPublic = new Map(currentLastSeenPublic)
        newChats.delete(publicKey)
        newLastSeen.delete(publicKey)
        newLastSeenPublic.delete(publicKey)
        set({
          chatPublicKeys: newChats,
          lastSeen: newLastSeen,
          lastSeenPublic: newLastSeenPublic,
        })
      },

      updateLastSeen: (publicKey: string, timestamp?: number) => {
        const newLastSeen = new Map(get().lastSeen)
        newLastSeen.set(publicKey, timestamp || Date.now())
        set({lastSeen: newLastSeen})
      },

      updateLastSeenPublic: (publicKey: string, timestamp?: number) => {
        const newLastSeenPublic = new Map(get().lastSeenPublic)
        newLastSeenPublic.set(publicKey, timestamp || Date.now())
        set({lastSeenPublic: newLastSeenPublic})
      },

    }),
    {
      name: "private-chats",
      storage: createJSONStorage(() => localforage),
      version: 1,
      partialize: (state) => ({
        chatPublicKeys: Array.from(state.chatPublicKeys),
        lastSeen: Array.from(state.lastSeen.entries()),
        lastSeenPublic: Array.from(state.lastSeenPublic.entries()),
      }),
      merge: (persistedState: unknown, currentState: PrivateChatsStore) => {
        const state = (persistedState || {
          chatPublicKeys: [],
          lastSeen: [],
          lastSeenPublic: [],
        }) as {
          chatPublicKeys: string[]
          lastSeen: [string, number][]
          lastSeenPublic: [string, number][]
        }

        return {
          ...currentState,
          chatPublicKeys: new Set(state.chatPublicKeys || []),
          lastSeen: new Map(state.lastSeen || []),
          lastSeenPublic: new Map(state.lastSeenPublic || []),
        }
      },
    }
  )
)

export const usePrivateChatsStore = store
