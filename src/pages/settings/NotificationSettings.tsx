import {
  showNotification,
  subscribeToDMNotifications,
  subscribeToNotifications,
} from "@/utils/notifications"
import IrisAPI, {
  NotificationSubscriptionResponse,
  PushNotifications,
} from "@/utils/IrisAPI"
import NotificationSubscriptionItem from "./NotificationSubscriptionItem"
import {useEffect, useState} from "react"
import {useSettingsStore} from "@/stores/settings"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingsInputItem} from "@/shared/components/settings/SettingsInputItem"
import Icon from "@/shared/components/Icons/Icon"
import {RiArrowRightSLine, RiArrowDownSLine} from "@remixicon/react"
import debounce from "lodash/debounce"
import {confirm, alert, isTauri} from "@/utils/utils"

interface StatusIndicatorProps {
  status: boolean
  enabledMessage: string
  disabledMessage: string
}

const StatusIndicator = ({
  status,
  enabledMessage,
  disabledMessage,
}: StatusIndicatorProps) => {
  return status ? (
    <div className="flex items-center">
      <Icon name="check" size={20} className="text-success mr-2" />
      {enabledMessage}
    </div>
  ) : (
    <div className="flex items-center">
      <Icon name="close" size={20} className="text-error mr-2" />
      {disabledMessage}
    </div>
  )
}

const NotificationSettings = () => {
  const {notifications, updateNotifications} = useSettingsStore()
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false)
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)
  const [desktopPermissionGranted, setDesktopPermissionGranted] = useState(false)
  const hasNotificationsApi = "Notification" in window
  const [notificationsAllowed, setNotificationsAllowed] = useState(
    hasNotificationsApi && Notification.permission === "granted"
  )
  const [subscribedToPush, setSubscribedToPush] = useState(false)
  const allGood =
    /*!login.readonly &&*/ hasNotificationsApi &&
    notificationsAllowed &&
    serviceWorkerReady

  const [isValidUrl, setIsValidUrl] = useState(true)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)
  const [subscriptionsData, setSubscriptionsData] =
    useState<NotificationSubscriptionResponse>({})
  const [showDebugData, setShowDebugData] = useState(false)
  const [inputValue, setInputValue] = useState(notifications.server)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [debouncedValidation] = useState(() =>
    debounce((url: string) => {
      const valid = validateUrl(url)
      setIsValidUrl(valid)
      if (valid) {
        updateNotifications({server: url})
      }
    }, 500)
  )

  const trySubscribePush = async () => {
    try {
      if (allGood && !subscribedToPush) {
        await Promise.all([subscribeToNotifications(), subscribeToDMNotifications()])
        setSubscribedToPush(true)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    trySubscribePush()
  }, [allGood])

  useEffect(() => {
    // Check if running on desktop
    const checkPlatform = async () => {
      if (isTauri()) {
        try {
          const {platform} = await import("@tauri-apps/plugin-os")
          const platformType = await platform()
          const desktop = platformType !== "android" && platformType !== "ios"
          setIsDesktop(desktop)

          // Check desktop notification permission
          if (desktop) {
            const {isPermissionGranted} = await import("@tauri-apps/plugin-notification")
            const granted = await isPermissionGranted()
            console.log("[NotificationSettings] Desktop permission check:", granted)
            setDesktopPermissionGranted(granted)
          }
        } catch (e) {
          console.error("Failed to check platform, assuming desktop:", e)
          setIsDesktop(true) // If platform check fails in Tauri, assume desktop
        }
      } else {
        setIsDesktop(false)
      }
    }
    checkPlatform()

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          setServiceWorkerReady(true)
        }
      })
    }
  }, [])

  // Get the current service worker subscription endpoint
  useEffect(() => {
    const getCurrentEndpoint = async () => {
      if ("serviceWorker" in navigator && "PushManager" in window) {
        try {
          const registration = await navigator.serviceWorker.ready
          const subscription = await registration.pushManager.getSubscription()
          if (subscription) {
            setCurrentEndpoint(subscription.endpoint)
          }
        } catch (error) {
          console.error("Failed to get current subscription endpoint:", error)
        }
      }
    }

    getCurrentEndpoint()
  }, [serviceWorkerReady])

  const requestNotificationPermission = async () => {
    Notification.requestPermission().then(async (permission) => {
      const allowed = permission === "granted"
      setNotificationsAllowed(allowed)
      if (!allowed) {
        await alert("Please allow notifications in your browser settings and try again.")
      }
    })
  }

  const requestDesktopPermission = async () => {
    try {
      const {requestPermission} = await import("@tauri-apps/plugin-notification")
      console.log("[Desktop Permission] Requesting permission...")
      const permission = await requestPermission()
      console.log("[Desktop Permission] Result:", permission)
      const granted = permission === "granted"
      setDesktopPermissionGranted(granted)
      if (!granted) {
        await alert("Notification permission denied. Please enable notifications in your system settings.")
      }
    } catch (error) {
      console.error("[Desktop Permission] Failed to request permission:", error)
      await alert(`Failed to request permission: ${error}`)
    }
  }

  const fireTestNotification = async () => {
    console.log("[Test Notification] isDesktop:", isDesktop)
    if (isDesktop) {
      // Desktop Tauri notifications
      console.log("[Test Notification] Sending desktop notification")
      try {
        const {sendNotification, isPermissionGranted, requestPermission} = await import(
          "@tauri-apps/plugin-notification"
        )

        // Check and request permission if needed
        let permissionGranted = await isPermissionGranted()
        console.log("[Test Notification] Permission granted:", permissionGranted)

        if (!permissionGranted) {
          const permission = await requestPermission()
          permissionGranted = permission === "granted"
          setDesktopPermissionGranted(permissionGranted)
          console.log("[Test Notification] Requested permission, granted:", permissionGranted)
        }

        if (!permissionGranted) {
          await alert("Notification permission denied. Please enable notifications in your system settings.")
          return
        }

        await sendNotification({
          title: "Test notification",
          body: "Seems like it's working!",
        })
        console.log("[Test Notification] Desktop notification sent")
      } catch (error) {
        console.error("[Test Notification] Failed to send test notification:", error)
        await alert(`Failed to send notification: ${error}`)
      }
    } else if (notificationsAllowed) {
      const title = "Test notification"
      const options = {
        body: "Seems like it's working!",
        icon: "/favicon.png",
        requireInteraction: false,
        image:
          "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Orange_tabby_cat_sitting_on_fallen_leaves-Hisashi-01A.jpg/1920px-Orange_tabby_cat_sitting_on_fallen_leaves-Hisashi-01A.jpg",
      }
      showNotification(title, options, true)
    } else {
      await alert("Notifications are not allowed. Please enable them first.")
    }
  }

  function handleServerChange(url: string) {
    setInputValue(url)
    debouncedValidation(url)
  }

  useEffect(() => {
    setInputValue(notifications.server)
  }, [notifications.server])

  function validateUrl(url: string): boolean {
    try {
      new URL(url)
      return true
    } catch (_) {
      return false
    }
  }

  useEffect(() => {
    const fetchSubscriptionsData = async () => {
      try {
        const api = new IrisAPI(notifications.server)
        const data = await api.getNotificationSubscriptions()
        setSubscriptionsData(data)
      } catch (error) {
        console.error("Failed to fetch subscriptions:", error)
      }
    }

    fetchSubscriptionsData()
  }, [])

  const handleDeleteSubscription = async (subscriptionId: string) => {
    try {
      const api = new IrisAPI(notifications.server)
      await api.deleteNotificationSubscription(subscriptionId)
      console.log(`Deleted subscription with ID: ${subscriptionId}`)
      // Optionally, update the local state to reflect the deletion
      setSubscriptionsData((prevData) => {
        const newData = {...prevData}
        delete newData[subscriptionId]
        return newData
      })
      setSelectedRows((prev) => {
        const newSet = new Set(prev)
        newSet.delete(subscriptionId)
        return newSet
      })
    } catch (error) {
      console.error(`Failed to delete subscription with ID: ${subscriptionId}`, error)
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedRows.size === 0) return

    const confirmed = await confirm(
      `Delete ${selectedRows.size} selected subscription(s)?`
    )
    if (!confirmed) return

    for (const id of selectedRows) {
      await handleDeleteSubscription(id)
    }
    setSelectedRows(new Set())
  }

  const toggleSelection = (id: string) => {
    setSelectedRows((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const toggleSelectAll = () => {
    const allIds = Object.keys(subscriptionsData)

    if (selectedRows.size === allIds.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(allIds))
    }
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <SettingsGroup title="Preferences">
            <SettingsGroupItem>
              <div className="flex items-center justify-between">
                <span>Mentions</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifications.preferences.mentions}
                  onChange={(e) =>
                    updateNotifications({
                      preferences: {
                        ...notifications.preferences,
                        mentions: e.target.checked,
                      },
                    })
                  }
                />
              </div>
            </SettingsGroupItem>
            <SettingsGroupItem>
              <div className="flex items-center justify-between">
                <span>Replies</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifications.preferences.replies}
                  onChange={(e) =>
                    updateNotifications({
                      preferences: {
                        ...notifications.preferences,
                        replies: e.target.checked,
                      },
                    })
                  }
                />
              </div>
            </SettingsGroupItem>
            <SettingsGroupItem>
              <div className="flex items-center justify-between">
                <span>Reposts</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifications.preferences.reposts}
                  onChange={(e) =>
                    updateNotifications({
                      preferences: {
                        ...notifications.preferences,
                        reposts: e.target.checked,
                      },
                    })
                  }
                />
              </div>
            </SettingsGroupItem>
            <SettingsGroupItem>
              <div className="flex items-center justify-between">
                <span>Reactions</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifications.preferences.reactions}
                  onChange={(e) =>
                    updateNotifications({
                      preferences: {
                        ...notifications.preferences,
                        reactions: e.target.checked,
                      },
                    })
                  }
                />
              </div>
            </SettingsGroupItem>
            <SettingsGroupItem>
              <div className="flex items-center justify-between">
                <span>Zaps</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifications.preferences.zaps}
                  onChange={(e) =>
                    updateNotifications({
                      preferences: {...notifications.preferences, zaps: e.target.checked},
                    })
                  }
                />
              </div>
            </SettingsGroupItem>
            <SettingsGroupItem isLast>
              <div className="flex items-center justify-between">
                <span>Direct Messages</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifications.preferences.dms}
                  onChange={(e) =>
                    updateNotifications({
                      preferences: {...notifications.preferences, dms: e.target.checked},
                    })
                  }
                />
              </div>
            </SettingsGroupItem>
          </SettingsGroup>

          {isDesktop && (
            <SettingsGroup title="Status">
              <SettingsGroupItem isLast>
                <div className="flex items-center justify-between">
                  <StatusIndicator
                    status={desktopPermissionGranted}
                    enabledMessage="Notifications are allowed"
                    disabledMessage="Notifications are not allowed"
                  />
                  <div className="flex items-center gap-2">
                    {!desktopPermissionGranted && (
                      <button
                        className="btn btn-neutral btn-sm"
                        onClick={requestDesktopPermission}
                      >
                        Allow
                      </button>
                    )}
                    <button
                      className="btn btn-neutral btn-sm"
                      onClick={fireTestNotification}
                    >
                      Test
                    </button>
                  </div>
                </div>
              </SettingsGroupItem>
            </SettingsGroup>
          )}

          {isDesktop === false && (
            <SettingsGroup title="Status">
              <SettingsGroupItem>
                <StatusIndicator
                  status={hasNotificationsApi}
                  enabledMessage="Notifications API is enabled"
                  disabledMessage="Notifications API is disabled"
                />
              </SettingsGroupItem>
              <SettingsGroupItem>
                <div className="flex items-center justify-between">
                  <StatusIndicator
                    status={notificationsAllowed}
                    enabledMessage="Notifications are allowed"
                    disabledMessage="Notifications are not allowed"
                  />
                  <div className="flex items-center gap-2">
                    {hasNotificationsApi && !notificationsAllowed && (
                      <button
                        className="btn btn-neutral btn-sm"
                        onClick={requestNotificationPermission}
                      >
                        Allow
                      </button>
                    )}
                    {notificationsAllowed && (
                      <button
                        className="btn btn-neutral btn-sm"
                        onClick={fireTestNotification}
                      >
                        Test
                      </button>
                    )}
                  </div>
                </div>
              </SettingsGroupItem>
              <SettingsGroupItem>
                <StatusIndicator
                  status={serviceWorkerReady}
                  enabledMessage="Service Worker is running"
                  disabledMessage="Service Worker is not running"
                />
              </SettingsGroupItem>
              <SettingsGroupItem isLast>
                <div className="flex items-center justify-between">
                  <StatusIndicator
                    status={subscribedToPush}
                    enabledMessage="Subscribed to push notifications"
                    disabledMessage="Not subscribed to push notifications"
                  />
                  {allGood && !subscribedToPush && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={subscribeToNotifications}
                    >
                      Subscribe
                    </button>
                  )}
                </div>
              </SettingsGroupItem>
            </SettingsGroup>
          )}

          <SettingsGroup title="Server">
            <SettingsInputItem
              label="Notification Server"
              value={inputValue}
              onChange={handleServerChange}
              type="url"
              rightContent={
                !isValidUrl ? (
                  <Icon name="close" size={16} className="text-error" />
                ) : undefined
              }
            />
            <SettingsGroupItem isLast>
              <div className="text-sm text-base-content/70">
                Self-host notification server?{" "}
                <a
                  className="link"
                  href="https://github.com/mmalmi/nostr-notification-server"
                >
                  Source code
                </a>
              </div>
            </SettingsGroupItem>
          </SettingsGroup>

          <SettingsGroup title="Subscriptions">
            <SettingsGroupItem>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {Object.keys(subscriptionsData).length} active subscriptions
                </span>
                <div className="flex items-center gap-2">
                  {selectedRows.size > 0 && (
                    <button
                      className="btn btn-error btn-sm"
                      onClick={handleDeleteSelected}
                    >
                      Delete {selectedRows.size}
                    </button>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={
                        selectedRows.size > 0 &&
                        selectedRows.size === Object.keys(subscriptionsData).length
                      }
                      onChange={toggleSelectAll}
                    />
                    <span className="text-sm">Select all</span>
                  </label>
                </div>
              </div>
            </SettingsGroupItem>
            {Object.entries(subscriptionsData)
              .flatMap(([id, subscription]) => {
                type SubscriptionItem = {
                  id: string
                  subscription: typeof subscription
                  pushSubscription: PushNotifications | null
                  index: number
                  isCurrentDevice: boolean
                }

                const items: SubscriptionItem[] = []

                if (
                  !subscription?.web_push_subscriptions ||
                  subscription.web_push_subscriptions.length === 0
                ) {
                  items.push({
                    id,
                    subscription,
                    pushSubscription: null,
                    index: 0,
                    isCurrentDevice: false,
                  })
                } else {
                  subscription.web_push_subscriptions.forEach(
                    (pushSubscription: PushNotifications, index: number) => {
                      const isCurrentDevice =
                        currentEndpoint === pushSubscription.endpoint
                      items.push({
                        id,
                        subscription,
                        pushSubscription,
                        index,
                        isCurrentDevice,
                      })
                    }
                  )
                }

                return items
              })
              .sort((a, b) => (b.isCurrentDevice ? 1 : 0) - (a.isCurrentDevice ? 1 : 0))
              .map(({id, subscription, pushSubscription, index}, itemIndex, array) => (
                <SettingsGroupItem
                  key={`${id}-${index}`}
                  isLast={itemIndex === array.length - 1}
                >
                  <NotificationSubscriptionItem
                    id={id}
                    subscription={subscription}
                    pushSubscription={pushSubscription}
                    currentEndpoint={currentEndpoint}
                    onDelete={handleDeleteSubscription}
                    isSelected={selectedRows.has(id)}
                    onToggleSelect={toggleSelection}
                  />
                </SettingsGroupItem>
              ))}
          </SettingsGroup>

          <SettingsGroup title="Debug">
            <SettingsGroupItem
              onClick={() => setShowDebugData(!showDebugData)}
              isLast={!showDebugData}
            >
              <div className="flex justify-between items-center">
                <span>Subscriptions Response</span>
                {showDebugData ? (
                  <RiArrowDownSLine size={20} className="text-base-content/50" />
                ) : (
                  <RiArrowRightSLine size={20} className="text-base-content/50" />
                )}
              </div>
            </SettingsGroupItem>
            {showDebugData && (
              <SettingsGroupItem isLast>
                <pre className="bg-base-300 p-4 rounded overflow-auto whitespace-pre-wrap break-all text-sm">
                  {JSON.stringify(subscriptionsData, null, 2) || ""}
                </pre>
              </SettingsGroupItem>
            )}
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default NotificationSettings
