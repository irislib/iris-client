import {create} from "zustand"

export const TYPING_EXPIRY_MS = 10000

type TypingState = {
  isTyping: Map<string, boolean>
  setRemoteTyping: (chatId: string, eventTimestamp?: number) => void
  clearRemoteTyping: (chatId: string, messageTimestamp?: number) => void
  clearAll: () => void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const lastMessageAt = new Map<string, number>()

export const useTypingStore = create<TypingState>((set) => ({
  isTyping: new Map(),

  setRemoteTyping: (chatId, eventTimestamp) => {
    if (eventTimestamp) {
      const lastMessage = lastMessageAt.get(chatId)
      if (lastMessage && eventTimestamp <= lastMessage) return
    }

    const existing = timers.get(chatId)
    if (existing) clearTimeout(existing)

    set((state) => {
      const next = new Map(state.isTyping)
      next.set(chatId, true)
      return {isTyping: next}
    })

    timers.set(
      chatId,
      setTimeout(() => {
        timers.delete(chatId)
        set((state) => {
          const next = new Map(state.isTyping)
          next.delete(chatId)
          return {isTyping: next}
        })
      }, TYPING_EXPIRY_MS)
    )
  },

  clearRemoteTyping: (chatId, messageTimestamp) => {
    if (messageTimestamp) {
      const existing = lastMessageAt.get(chatId) || 0
      lastMessageAt.set(chatId, Math.max(existing, messageTimestamp))
    }

    const existing = timers.get(chatId)
    if (existing) {
      clearTimeout(existing)
      timers.delete(chatId)
    }

    set((state) => {
      if (!state.isTyping.has(chatId)) return state
      const next = new Map(state.isTyping)
      next.delete(chatId)
      return {isTyping: next}
    })
  },

  clearAll: () => {
    for (const timer of timers.values()) {
      clearTimeout(timer)
    }
    timers.clear()
    lastMessageAt.clear()
    set({isTyping: new Map()})
  },
}))

export function createTypingThrottle(
  callback: () => void,
  intervalMs: number
): {fire: () => void; reset: () => void} {
  let lastFired = 0
  return {
    fire() {
      const now = Date.now()
      if (now - lastFired >= intervalMs) {
        lastFired = now
        callback()
      }
    },
    reset() {
      lastFired = 0
    },
  }
}
