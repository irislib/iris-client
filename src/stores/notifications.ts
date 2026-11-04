import {persist} from "zustand/middleware"
import {create} from "zustand"

const storageKey = "notifications-storage"

interface NotificationsState {
  latestNotification: number
  refreshRouteSignal: number
  notificationsDeclined: boolean
  notificationsSeenAt: number
  readEventsByAccount: Record<string, Record<string, number>>
  goToNotifications: number

  setLatestNotification: (timestamp: number) => void
  updateRefreshRouteSignal: () => void
  setNotificationsDeclined: (declined: boolean) => void
  setNotificationsSeenAt: (timestamp: number) => void
  markEventsRead: (publicKey: string, events: Record<string, number>) => void
  incrementGoToNotifications: () => void
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => {
      const initialState = {
        latestNotification: 0,
        refreshRouteSignal: 0,
        notificationsDeclined: false,
        notificationsSeenAt: 0,
        readEventsByAccount: {},
        goToNotifications: 0,
      }

      const actions = {
        setLatestNotification: (latestNotification: number) => set({latestNotification}),
        updateRefreshRouteSignal: () =>
          set({refreshRouteSignal: get().refreshRouteSignal + 1}),
        setNotificationsDeclined: (notificationsDeclined: boolean) =>
          set({notificationsDeclined}),
        setNotificationsSeenAt: (notificationsSeenAt: number) =>
          set({notificationsSeenAt}),
        markEventsRead: (publicKey: string, events: Record<string, number>) => {
          const {notificationsSeenAt, readEventsByAccount} = get()
          const previous = readEventsByAccount[publicKey] || {}
          const additions = Object.entries(events).filter(
            ([id, time]) => time > notificationsSeenAt && !(id in previous)
          )
          if (!additions.length) return
          // Once the inbox watermark covers an event it no longer needs an exception.
          const outstanding = Object.fromEntries(
            Object.entries(previous).filter(([, time]) => time > notificationsSeenAt)
          )
          set({
            readEventsByAccount: {
              ...readEventsByAccount,
              [publicKey]: {...outstanding, ...Object.fromEntries(additions)},
            },
          })
        },
        incrementGoToNotifications: () =>
          set({goToNotifications: get().goToNotifications + 1}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: storageKey,
      partialize: ({
        notificationsSeenAt,
        readEventsByAccount,
        notificationsDeclined,
      }) => ({
        notificationsSeenAt,
        readEventsByAccount,
        notificationsDeclined,
      }),
    }
  )
)

if (typeof window !== "undefined") {
  window.addEventListener("storage", ({key, newValue}) => {
    if (key !== storageKey || !newValue) return
    const stored = JSON.parse(newValue).state as Partial<NotificationsState>
    const state = useNotificationsStore.getState()
    if (
      stored.notificationsSeenAt &&
      stored.notificationsSeenAt > state.notificationsSeenAt
    ) {
      state.setNotificationsSeenAt(stored.notificationsSeenAt)
    }
    for (const [publicKey, events] of Object.entries(stored.readEventsByAccount || {})) {
      state.markEventsRead(publicKey, events)
    }
  })
  ;(
    window as {
      useNotificationsStore?: typeof useNotificationsStore
    }
  ).useNotificationsStore = useNotificationsStore
}
