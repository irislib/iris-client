import {
  showNotification,
  subscribeToDMNotifications,
  subscribeToNotifications,
} from "@/utils/notifications"
import IrisAPI, {SubscriptionResponse, PushNotifications} from "@/utils/IrisAPI"
import {useEffect, useState, ChangeEvent} from "react"
import {useSettingsStore} from "@/stores/settings"
import Icon from "@/shared/components/Icons/Icon"
import debounce from "lodash/debounce"

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
  const [subscriptionsData, setSubscriptionsData] = useState<SubscriptionResponse>({})
  const [showDebugData, setShowDebugData] = useState(false)
  const [inputValue, setInputValue] = useState(notifications.server)
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

  const requestNotificationPermission = () => {
    Notification.requestPermission().then((permission) => {
      const allowed = permission === "granted"
      setNotificationsAllowed(allowed)
      if (!allowed) {
        alert("Please allow notifications in your browser settings and try again.")
      }
    })
  }

  const fireTestNotification = () => {
    if (notificationsAllowed) {
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
      alert("Notifications are not allowed. Please enable them first.")
    }
  }

  function handleServerChange(e: ChangeEvent<HTMLInputElement>) {
    const url = e.target.value
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
        const data = await api.getSubscriptions()
        setSubscriptionsData(data)
      } catch (error) {
        console.error("Failed to fetch subscriptions:", error)
      }
    }

    fetchSubscriptionsData()
  }, [])

  const handleDeleteSubscription = async (subscriptionId: string) => {
    try {
      const api = new IrisAPI()
      await api.deleteSubscription(subscriptionId)
      console.log(`Deleted subscription with ID: ${subscriptionId}`)
      // Optionally, update the local state to reflect the deletion
      setSubscriptionsData((prevData) => {
        const newData = {...prevData}
        delete newData[subscriptionId]
        return newData
      })
    } catch (error) {
      console.error(`Failed to delete subscription with ID: ${subscriptionId}`, error)
    }
  }

  const removeNullValues = (obj: Record<string, unknown>) => {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null))
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col space-y-4">
        {/*
            <StatusIndicator
            status={!login.readonly}
            enabledMessage="You have write access"
            disabledMessage="You don't have write access"
            />
        */}
        <StatusIndicator
          status={hasNotificationsApi}
          enabledMessage="Notifications API is enabled"
          disabledMessage="Notifications API is disabled"
        />
        <div className="flex items-center gap-2">
          <StatusIndicator
            status={notificationsAllowed}
            enabledMessage="Notifications are allowed"
            disabledMessage="Notifications are not allowed"
          />
          {hasNotificationsApi && !notificationsAllowed && (
            <button className="btn btn-neutral" onClick={requestNotificationPermission}>
              Allow
            </button>
          )}
          {notificationsAllowed && (
            <button className="btn btn-neutral btn-sm" onClick={fireTestNotification}>
              Test Notification
            </button>
          )}
        </div>
        <StatusIndicator
          status={serviceWorkerReady}
          enabledMessage="Service Worker is running"
          disabledMessage="Service Worker is not running"
        />
        <div className="flex items-center gap-2">
          <StatusIndicator
            status={subscribedToPush}
            enabledMessage="Subscribed to push notifications"
            disabledMessage="Not subscribed to push notifications"
          />
          {allGood && !subscribedToPush && (
            <button className="btn btn-primary btn-sm" onClick={subscribeToNotifications}>
              Subscribe
            </button>
          )}
        </div>
        <div>
          <b>Notification Server</b>
          <div className="mt-2">
            <input
              type="text"
              className={`w-96 max-w-full input input-primary ${isValidUrl ? "" : "input-error"}`}
              value={inputValue}
              onChange={handleServerChange}
            />
            {!isValidUrl && <p className="text-error">Invalid URL</p>}
          </div>
          <div className="mt-2">
            Self-host notification server?{" "}
            <a
              className="link"
              href="https://github.com/mmalmi/nostr-notification-server"
            >
              Source code
            </a>
          </div>
        </div>
        <div className="mt-4">
          <div className="my-4 font-bold">
            {Object.keys(subscriptionsData).length} subscriptions
          </div>
          <div className="flex flex-col space-y-2 w-full">
            {Object.entries(subscriptionsData)
              .flatMap(([id, subscription]) => {
                if (!subscription?.web_push_subscriptions) return []
                return subscription.web_push_subscriptions.map(
                  (pushSubscription: PushNotifications, index: number) => {
                    const isCurrentDevice = currentEndpoint === pushSubscription.endpoint
                    return {
                      id,
                      subscription,
                      pushSubscription,
                      index,
                      isCurrentDevice,
                    }
                  }
                )
              })
              .sort((a, b) => (b.isCurrentDevice ? 1 : 0) - (a.isCurrentDevice ? 1 : 0))
              .map(({id, subscription, pushSubscription, index, isCurrentDevice}) => (
                <div
                  key={`${id}-${index}`}
                  className={`flex w-full items-start gap-4 p-2 border rounded ${
                    isCurrentDevice ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  {/* The left side that holds the JSON block */}
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-center gap-2">
                      <strong>Endpoint:</strong>{" "}
                      {(() => {
                        const url = new URL(pushSubscription.endpoint)
                        const path = url.pathname
                        const last4 = path.length > 4 ? path.slice(-4) : path
                        return `${url.host}/...${last4}`
                      })()}
                      {isCurrentDevice && (
                        <span className="badge badge-primary text-xs">This device</span>
                      )}
                    </div>
                    <div>
                      <strong>Filters:</strong>
                    </div>
                    {/* This wrapper ensures only the <pre> can scroll horizontally */}
                    <pre className="w-full overflow-x-auto whitespace-pre bg-base-200 p-2 rounded text-sm">
                      {JSON.stringify(removeNullValues(subscription.filter), null, 2)}
                    </pre>
                  </div>

                  {/* The button, set to 'shrink-0' so it won't expand or push the row wide */}
                  <button
                    className="btn btn-error btn-sm shrink-0"
                    onClick={() => handleDeleteSubscription(id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
          </div>
        </div>

        <div className="mt-4">
          <b>Debug: /subscriptions Response</b>
          <button
            className="btn btn-neutral btn-sm ml-2"
            onClick={() => setShowDebugData(!showDebugData)}
          >
            {showDebugData ? "Hide" : "Show"}
          </button>
          {showDebugData && (
            <pre className="bg-base-200 p-4 rounded overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(subscriptionsData, null, 2) || "Loading..."}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotificationSettings
