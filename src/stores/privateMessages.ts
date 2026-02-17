import {comparator} from "@/pages/chats/utils/messageGrouping"
import type {MessageType} from "@/pages/chats/message/Message"
import * as messageRepository from "@/utils/messageRepository"
import {KIND_REACTION} from "@/utils/constants"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {create} from "zustand"
import {getMillisecondTimestamp, isExpired} from "nostr-double-ratchet"
import {useUserStore} from "./user"

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
  awaitHydration: () => Promise<void>
  upsert: (from: string, to: string, message: MessageType) => Promise<void>
  updateMessage: (
    chatId: string,
    messageId: string,
    updates: Partial<MessageType>
  ) => Promise<void>
  updateLastSeen: (chatId: string, timestamp?: number) => void
  markOpened: (chatId: string) => void
  purgeExpired: (nowSeconds?: number) => void
  removeSession: (chatId: string) => Promise<void>
  removeMessage: (chatId: string, messageId: string) => Promise<void>
  clear: () => Promise<void>
}

type PrivateMessagesStore = PrivateMessagesStoreState & PrivateMessagesStoreActions

export const usePrivateMessagesStore = create<PrivateMessagesStore>((set, get) => {
  const filterExpired = (
    events: Map<string, SortedMap<string, MessageType>>,
    nowSeconds: number
  ): Map<string, SortedMap<string, MessageType>> => {
    const next = new Map<string, SortedMap<string, MessageType>>()
    for (const [chatId, messageMap] of events.entries()) {
      const remaining: Array<[string, MessageType]> = []
      for (const [id, msg] of messageMap.entries()) {
        if (isExpired(msg, nowSeconds)) {
          void messageRepository.deleteMessage(chatId, id).catch(() => {})
          continue
        }
        remaining.push([id, msg])
      }
      if (remaining.length === 0) continue
      // Keep stable reference when nothing was removed.
      if (remaining.length === messageMap.size) {
        next.set(chatId, messageMap)
      } else {
        next.set(chatId, new SortedMap<string, MessageType>(remaining, comparator))
      }
    }
    return next
  }

  const rehydration = Promise.all([
    messageRepository.loadAll(),
    messageRepository.loadLastSeen(),
  ])
    .then(([events, lastSeen]) => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      set({events: filterExpired(events, nowSeconds), lastSeen})
    })
    .catch(console.error)
  return {
    events: new Map(),
    lastSeen: new Map(),
    awaitHydration: async () => {
      await rehydration
    },

    upsert: async (from, to, event) => {
      const myPubKey = useUserStore.getState().publicKey
      const chatId = from === myPubKey ? to : from

      const nowSeconds = Math.floor(Date.now() / 1000)

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

        const existingMessage = state.events.get(chatId)?.get(event.id)
        const mergedMessage = existingMessage
          ? {
              ...existingMessage,
              ...event,
              reactions: event.reactions ?? existingMessage.reactions,
              status: event.status ?? existingMessage.status,
            }
          : event

        if (isExpired(mergedMessage, nowSeconds)) {
          void messageRepository.deleteMessage(chatId, mergedMessage.id).catch(() => {})
          return state
        }

        // Regular message - add to chat
        return {
          events: addToMap(new Map(state.events), chatId, mergedMessage),
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
        const currentEventMap = events.get(chatId)
        if (currentEventMap) {
          const existingMessage = currentEventMap.get(messageId)
          if (existingMessage) {
            const eventMap = new SortedMap<string, MessageType>(
              Array.from(currentEventMap.entries()),
              comparator
            )
            const updatedMessage = {...existingMessage, ...updates}
            eventMap.set(messageId, updatedMessage)
            events.set(chatId, eventMap)
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

    purgeExpired: (nowSeconds?: number) => {
      const effectiveNow =
        typeof nowSeconds === "number" ? nowSeconds : Math.floor(Date.now() / 1000)
      set((state) => {
        const nextEvents = filterExpired(state.events, effectiveNow)
        if (nextEvents === state.events) return state
        // Cheap structural equality check: compare sizes and object identity in common case.
        if (nextEvents.size === state.events.size) {
          let same = true
          for (const [chatId, map] of nextEvents.entries()) {
            if (state.events.get(chatId) !== map) {
              same = false
              break
            }
          }
          if (same) return state
        }
        return {events: nextEvents}
      })
    },
  }
})

// Expose for Playwright/e2e seeding in dev mode.
// (Avoids having tests import a separate module instance with a different Vite HMR query.)
if (import.meta.env.DEV && typeof window !== "undefined") {
  ;(
    window as unknown as {
      usePrivateMessagesStore?: typeof usePrivateMessagesStore
    }
  ).usePrivateMessagesStore = usePrivateMessagesStore
}
