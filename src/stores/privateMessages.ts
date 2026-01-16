import {comparator} from "@/pages/chats/utils/messageGrouping"
import type {MessageType} from "@/pages/chats/message/Message"
import * as messageRepository from "@/utils/messageRepository"
import {KIND_REACTION, DEBUG_NAMESPACES} from "@/utils/constants"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {create} from "zustand"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {useUserStore} from "./user"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const addToMap = (
  chatEventMap: Map<string, SortedMap<string, MessageType>>,
  chatId: string,
  message: MessageType
) => {
  const existingEventMap = chatEventMap.get(chatId)
  const eventMap = existingEventMap
    ? new SortedMap<string, MessageType>(
        Array.from(existingEventMap.entries()),
        comparator
      )
    : new SortedMap<string, MessageType>([], comparator)

  eventMap.set(message.id, message)
  chatEventMap.set(chatId, eventMap)
  return chatEventMap
}

interface PrivateMessagesStoreState {
  events: Map<string, SortedMap<string, MessageType>>
  lastSeen: Map<string, number>
}

interface PrivateMessagesStoreActions {
  upsert: (from: string, to: string, message: MessageType) => Promise<void>
  updateMessage: (
    chatId: string,
    messageId: string,
    updates: Partial<MessageType>
  ) => Promise<void>
  updateLastSeen: (chatId: string, timestamp?: number) => void
  markOpened: (chatId: string) => void
  removeSession: (chatId: string) => Promise<void>
  removeMessage: (chatId: string, messageId: string) => Promise<void>
  clear: () => Promise<void>
}

type PrivateMessagesStore = PrivateMessagesStoreState & PrivateMessagesStoreActions

export const usePrivateMessagesStore = create<PrivateMessagesStore>((set, get) => {
  const rehydration = Promise.all([
    messageRepository.loadAll(),
    messageRepository.loadLastSeen(),
  ])
    .then(([events, lastSeen]) => set({events, lastSeen}))
    .catch(console.error)
  return {
    events: new Map(),
    lastSeen: new Map(),

    upsert: async (from, to, event) => {
      const myPubKey = useUserStore.getState().publicKey
      const chatId = from === myPubKey ? to : from

      // Debug logging for chat ID resolution
      log("[privateMessages.upsert]", {
        from: from?.slice(0, 8),
        to: to?.slice(0, 8),
        myPubKey: myPubKey?.slice(0, 8),
        chatId: chatId?.slice(0, 8),
        eventId: event.id?.slice(0, 8),
        eventPubkey: event.pubkey?.slice(0, 8),
        isFromMe: from === myPubKey,
      })

      set((state) => {
        const isReaction = event.kind === KIND_REACTION
        const eTag = event.tags.find(([key]) => key === "e")

        if (isReaction && eTag) {
          const [, messageId] = eTag
          const pubKey = event.pubkey

          // Find target message and update it in place
          const events = new Map(state.events)
          for (const [existingChatId, messageMap] of events.entries()) {
            const oldMsg = messageMap.get(messageId)
            if (oldMsg) {
              const updatedMsg = {
                ...oldMsg,
                reactions: {
                  ...oldMsg.reactions,
                  [pubKey]: event.content,
                },
              }
              messageMap.set(messageId, updatedMsg)
              events.set(existingChatId, messageMap)

              // Persist in background
              rehydration
                .then(() => messageRepository.save(existingChatId, updatedMsg))
                .catch(console.error)

              return {events}
            }
          }

          // Target message not found - ignore reaction
          console.warn("Reaction target message not found:", messageId)
          return state
        }

        // Regular message - add to chat
        return {
          events: addToMap(new Map(state.events), chatId, event),
        }
      })

      // For non-reaction messages, persist in background
      if (event.kind !== KIND_REACTION) {
        rehydration.then(() => messageRepository.save(chatId, event)).catch(console.error)
      }
    },

    removeSession: async (chatId) => {
      await rehydration
      await messageRepository.deleteBySession(chatId)
      await messageRepository.deleteLastSeen(chatId)
      set((state) => {
        const events = new Map(state.events)
        events.delete(chatId)
        const lastSeen = new Map(state.lastSeen)
        lastSeen.delete(chatId)
        return {events, lastSeen}
      })
    },

    clear: async () => {
      await rehydration
      await messageRepository.clearAll()
      await messageRepository.clearLastSeen()
      set({events: new Map(), lastSeen: new Map()})
    },

    updateMessage: async (
      chatId: string,
      messageId: string,
      updates: Partial<MessageType>
    ) => {
      await rehydration
      set((state) => {
        const events = new Map(state.events)
        const eventMap = events.get(chatId)
        if (eventMap) {
          const existingMessage = eventMap.get(messageId)
          if (existingMessage) {
            const updatedMessage = {...existingMessage, ...updates}
            eventMap.set(messageId, updatedMessage)
            messageRepository.save(chatId, updatedMessage)
          }
        }
        return {events}
      })
    },

    removeMessage: async (chatId: string, messageId: string) => {
      await rehydration
      await messageRepository.deleteMessage(chatId, messageId)
      set((state) => {
        const events = new Map(state.events)
        const eventMap = events.get(chatId)
        if (eventMap) {
          eventMap.delete(messageId)
          if (eventMap.size === 0) {
            events.delete(chatId)
          } else {
            events.set(chatId, eventMap)
          }
        }
        return {events}
      })
    },

    updateLastSeen: (chatId: string, timestamp?: number) => {
      const effectiveTimestamp = typeof timestamp === "number" ? timestamp : Date.now()
      set((state) => {
        const lastSeen = new Map(state.lastSeen)
        lastSeen.set(chatId, effectiveTimestamp)
        return {lastSeen}
      })
      messageRepository.saveLastSeen(chatId, effectiveTimestamp).catch(console.error)
    },

    markOpened: (chatId: string) => {
      if (!chatId) return
      const state = get()
      const events = state.events
      const messageMap = events.get(chatId)
      const latestEntry = messageMap?.last()
      const latestMessage = latestEntry ? latestEntry[1] : undefined
      const latestTimestamp = latestMessage
        ? getMillisecondTimestamp(latestMessage)
        : undefined
      const targetTimestamp = Math.max(Date.now(), latestTimestamp ?? 0)
      const current = state.lastSeen.get(chatId) || 0
      if (targetTimestamp <= current) {
        return
      }
      state.updateLastSeen(chatId, targetTimestamp)
    },
  }
})
