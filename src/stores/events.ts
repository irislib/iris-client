import {comparator} from "@/pages/chats/utils/messageGrouping"
import type {MessageType} from "@/pages/chats/message/Message"
import * as messageRepository from "@/utils/messageRepository"
import {REACTION_KIND} from "@/pages/chats/utils/constants"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useUserStore} from "./user"
import {create} from "zustand"

const addToMap = (
  publicKeyEventMap: Map<string, SortedMap<string, MessageType>>,
  publicKey: string,
  message: MessageType
) => {
  const eventMap =
    publicKeyEventMap.get(publicKey) || new SortedMap<string, MessageType>([], comparator)
  eventMap.set(message.id, message)
  publicKeyEventMap.set(publicKey, eventMap)
  return publicKeyEventMap
}

interface EventsStoreState {
  events: Map<string, SortedMap<string, MessageType>>
}

interface EventsStoreActions {
  upsert: (publicKey: string, message: MessageType) => Promise<void>
  removePublicKey: (publicKey: string) => Promise<void>
  removeMessage: (publicKey: string, messageId: string) => Promise<void>
  clear: () => Promise<void>
}

type EventsStore = EventsStoreState & EventsStoreActions

const makeOrModifyMessage = async (publicKey: string, message: MessageType) => {
  const isReaction = message.kind === REACTION_KIND
  const eTag = message.tags.find(([key]) => key === "e")
  if (isReaction && eTag) {
    const [, messageId] = eTag
    const oldMsg = await messageRepository.getById(messageId)

    const reactionPubKey =
      message?.sender === "user" ? useUserStore.getState().publicKey : publicKey

    if (oldMsg) {
      return {
        ...oldMsg,
        reactions: {
          ...oldMsg.reactions,
          [reactionPubKey]: message.content,
        },
      }
    }
  }
  return message
}

export const useEventsStore = create<EventsStore>((set) => {
  const rehydration = messageRepository
    .loadAll()
    .then((data) => set({events: data}))
    .catch(console.error)
  return {
    events: new Map(),

    upsert: async (publicKey, event) => {
      await rehydration
      const message = await makeOrModifyMessage(publicKey, event)
      await messageRepository.save(publicKey, message)
      set((state) => ({
        events: addToMap(new Map(state.events), publicKey, message),
      }))
    },

    removePublicKey: async (publicKey) => {
      await rehydration
      await messageRepository.deleteBySession(publicKey)
      set((state) => {
        const events = new Map(state.events)
        events.delete(publicKey)
        return {events}
      })
    },

    clear: async () => {
      await rehydration
      await messageRepository.clearAll()
      set({events: new Map()})
    },

    removeMessage: async (publicKey: string, messageId: string) => {
      await rehydration
      await messageRepository.deleteMessage(publicKey, messageId)
      set((state) => {
        const events = new Map(state.events)
        const eventMap = events.get(publicKey)
        if (eventMap) {
          eventMap.delete(messageId)
          if (eventMap.size === 0) {
            events.delete(publicKey)
          } else {
            events.set(publicKey, eventMap)
          }
        }
        return {events}
      })
    },
  }
})
