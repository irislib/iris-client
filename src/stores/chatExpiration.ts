import {create} from "zustand"
import {persist, createJSONStorage} from "zustand/middleware"
import localforage from "localforage"

export type ChatExpirationSeconds = number | null

interface ChatExpirationState {
  /**
   * Per-chat disappearing message timer in seconds.
   * `null` means explicitly "off".
   * Missing key means unknown/unset.
   */
  expirations: Record<string, ChatExpirationSeconds | undefined>

  setExpiration: (chatId: string, ttlSeconds: ChatExpirationSeconds | undefined) => void
  clearExpiration: (chatId: string) => void
}

const STORAGE_VERSION = 1

export const useChatExpirationStore = create<ChatExpirationState>()(
  persist(
    (set) => ({
      expirations: {},
      setExpiration: (chatId, ttlSeconds) =>
        set((state) => ({
          expirations: {
            ...state.expirations,
            [chatId]: ttlSeconds,
          },
        })),
      clearExpiration: (chatId) =>
        set((state) => {
          const next = {...state.expirations}
          delete next[chatId]
          return {expirations: next}
        }),
    }),
    {
      name: "chat-expiration",
      storage: createJSONStorage(() => localforage),
      version: STORAGE_VERSION,
    }
  )
)
