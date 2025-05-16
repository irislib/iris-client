import {persist} from "zustand/middleware"
import {create} from "zustand"

interface NotificationsState {
  latestNotification: number
  refreshRouteSignal: number
  notificationsDeclined: boolean
  notificationsSeenAt: number
  goToNotifications: number

  setLatestNotification: (timestamp: number) => void
  incrementRefreshRouteSignal: () => void
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
        incrementRefreshRouteSignal: () =>
          set({refreshRouteSignal: get().refreshRouteSignal + 1}),
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
