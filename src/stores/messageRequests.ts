import {create} from "zustand"
import {persist} from "zustand/middleware"

type ChatFlagMap = Record<string, true | undefined>

interface MessageRequestsState {
  acceptedChats: ChatFlagMap
  rejectedChats: ChatFlagMap
  acceptChat: (chatId: string) => void
  rejectChat: (chatId: string) => void
  clearChat: (chatId: string) => void
}

export const useMessageRequestsStore = create<MessageRequestsState>()(
  persist(
    (set) => ({
      acceptedChats: {},
      rejectedChats: {},
      acceptChat: (chatId: string) =>
        set((state) => {
          const acceptedChats: ChatFlagMap = {...state.acceptedChats, [chatId]: true}
          const rejectedChats: ChatFlagMap = {...state.rejectedChats}
          delete rejectedChats[chatId]
          return {acceptedChats, rejectedChats}
        }),
      rejectChat: (chatId: string) =>
        set((state) => {
          const rejectedChats: ChatFlagMap = {...state.rejectedChats, [chatId]: true}
          const acceptedChats: ChatFlagMap = {...state.acceptedChats}
          delete acceptedChats[chatId]
          return {acceptedChats, rejectedChats}
        }),
      clearChat: (chatId: string) =>
        set((state) => {
          const acceptedChats: ChatFlagMap = {...state.acceptedChats}
          const rejectedChats: ChatFlagMap = {...state.rejectedChats}
          delete acceptedChats[chatId]
          delete rejectedChats[chatId]
          return {acceptedChats, rejectedChats}
        }),
    }),
    {
      name: "message-requests-storage",
      partialize: (state) => ({
        acceptedChats: state.acceptedChats,
        rejectedChats: state.rejectedChats,
      }),
    }
  )
)
