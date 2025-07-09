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

interface PublicChatStore {
  publicChats: Record<string, PublicChat>
  lastSeen: Record<string, number>
  timestamps: Record<string, number>

  updateLastSeen: (chatId: string) => void
  updateTimestamp: (chatId: string, timestamp: number) => void
  addOrRefreshChatById: (chatId: string) => Promise<void>
  removePublicChat: (chatId: string) => void
}

const store = create<PublicChatStore>()(
  persist(
    (set) => ({
      publicChats: {},
      lastSeen: {},
      timestamps: {},

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
        }))
      },
    }),
    {
      name: "publicChats",
      storage: createJSONStorage(() => localforage),
    }
  )
)

export const usePublicChatsStore = store
