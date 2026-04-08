import {fetchChannelMetadata, ChannelMetadata} from "@/pages/chats/utils/channelMetadata"
import {createJSONStorage, persist} from "zustand/middleware"
import localforage from "localforage"
import {create} from "zustand"

export interface PublicChat {
  id: string
  name: string
  about: string
  picture: string
  metadata?: ChannelMetadata
}

export interface LatestMessage {
  content: string
  created_at: number
  pubkey: string
  kind: number
}

interface PublicChatStore {
  publicChats: Record<string, PublicChat>
  lastSeen: Record<string, number>
  timestamps: Record<string, number>
  latestMessages: Record<string, LatestMessage>
  hasHydrated: boolean

  updateLastSeen: (chatId: string) => void
  updateTimestamp: (chatId: string, timestamp: number) => void
  updateLatestMessage: (chatId: string, message: LatestMessage) => void
  addOrRefreshChatById: (chatId: string) => Promise<void>
  removePublicChat: (chatId: string) => void
  awaitHydration: () => Promise<void>
}

let resolveHydration: (() => void) | null = null
let hydrationPromise: Promise<void> | null = null

const store = create<PublicChatStore>()(
  persist(
    (set, get) => ({
      publicChats: {},
      lastSeen: {},
      timestamps: {},
      latestMessages: {},
      hasHydrated: false,

      updateLastSeen: (chatId: string) => {
        set((state) => ({
          lastSeen: {
            ...state.lastSeen,
            [chatId]: Date.now(),
          },
        }))
      },

      updateTimestamp: (chatId: string, timestamp: number) => {
        set((state) => ({
          timestamps: {
            ...state.timestamps,
            [chatId]: timestamp,
          },
        }))
      },

      updateLatestMessage: (chatId: string, message: LatestMessage) => {
        set((state) => ({
          latestMessages: {
            ...state.latestMessages,
            [chatId]: message,
          },
          timestamps: {
            ...state.timestamps,
            [chatId]: message.created_at,
          },
        }))
      },

      addOrRefreshChatById: async (chatId: string) => {
        const metadata = await fetchChannelMetadata(chatId)
        const chat: PublicChat = {
          id: chatId,
          name: metadata?.name || `Channel ${chatId.slice(0, 8)}...`,
          about: metadata?.about || "",
          picture: metadata?.picture || "",
          ...(metadata ? {metadata} : {}),
        }

        set((state) => ({
          publicChats: {
            ...state.publicChats,
            [chatId]: chat,
          },
        }))
      },

      removePublicChat: (chatId: string) => {
        set((state) => ({
          publicChats: Object.fromEntries(
            Object.entries(state.publicChats).filter(([id]) => id !== chatId)
          ),
          lastSeen: Object.fromEntries(
            Object.entries(state.lastSeen).filter(([id]) => id !== chatId)
          ),
          timestamps: Object.fromEntries(
            Object.entries(state.timestamps).filter(([id]) => id !== chatId)
          ),
          latestMessages: Object.fromEntries(
            Object.entries(state.latestMessages).filter(([id]) => id !== chatId)
          ),
        }))
      },

      awaitHydration: () => {
        if (get().hasHydrated) return Promise.resolve()
        if (!hydrationPromise) {
          hydrationPromise = new Promise<void>((resolve) => {
            resolveHydration = resolve
          })
        }
        return hydrationPromise
      },
    }),
    {
      name: "publicChats",
      storage: createJSONStorage(() => localforage),
      onRehydrateStorage: () => (state, error) => {
        if (state) {
          // Clean up invalid entries (non-hex IDs like "notifications")
          const validPublicChats = Object.fromEntries(
            Object.entries(state.publicChats).filter(([id]) => /^[0-9a-f]{64}$/i.test(id))
          )
          const validLastSeen = Object.fromEntries(
            Object.entries(state.lastSeen).filter(([id]) => /^[0-9a-f]{64}$/i.test(id))
          )
          const validTimestamps = Object.fromEntries(
            Object.entries(state.timestamps).filter(([id]) => /^[0-9a-f]{64}$/i.test(id))
          )
          const validLatestMessages = Object.fromEntries(
            Object.entries(state.latestMessages).filter(([id]) =>
              /^[0-9a-f]{64}$/i.test(id)
            )
          )

          if (
            Object.keys(state.publicChats).length !== Object.keys(validPublicChats).length
          ) {
            state.publicChats = validPublicChats
            state.lastSeen = validLastSeen
            state.timestamps = validTimestamps
            state.latestMessages = validLatestMessages
          }

          state.hasHydrated = true
        }

        if (error) {
          console.warn("[Iris] public chats store rehydrate failed:", error)
        }

        if (resolveHydration) {
          resolveHydration()
          resolveHydration = null
          hydrationPromise = null
        }
      },
    }
  )
)

export const usePublicChatsStore = store
