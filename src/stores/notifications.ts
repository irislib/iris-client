import {persist} from "zustand/middleware"
import {create} from "zustand"

interface NotificationsState {
  latestNotification: number
  refreshRouteSignal: number
  notificationsDeclined: boolean
  notificationsSeenAt: number
  goToNotifications: number

  setLatestNotification: (timestamp: number) => void
  updateRefreshRouteSignal: () => void
  setNotificationsDeclined: (declined: boolean) => void
  setNotificationsSeenAt: (timestamp: number) => void
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
        goToNotifications: 0,
      }

      const actions = {
        setLatestNotification: (latestNotification: number) => set({latestNotification}),
        updateRefreshRouteSignal: () => set({refreshRouteSignal: Date.now()}),
        setNotificationsDeclined: (notificationsDeclined: boolean) =>
          set({notificationsDeclined}),
        setNotificationsSeenAt: (notificationsSeenAt: number) =>
          set({notificationsSeenAt}),
        incrementGoToNotifications: () =>
          set({goToNotifications: get().goToNotifications + 1}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "notifications-storage",
    }
  )
)

if (typeof window !== "undefined") {
  ;(
    window as typeof window & {useNotificationsStore: typeof useNotificationsStore}
  ).useNotificationsStore = useNotificationsStore
}

export const useLatestNotification = () =>
  useNotificationsStore((state) => state.latestNotification)
export const useRefreshRouteSignal = () =>
  useNotificationsStore((state) => state.refreshRouteSignal)
export const useNotificationsDeclined = () =>
  useNotificationsStore((state) => state.notificationsDeclined)
export const useNotificationsSeenAt = () =>
  useNotificationsStore((state) => state.notificationsSeenAt)
export const useGoToNotifications = () =>
  useNotificationsStore((state) => state.goToNotifications)
