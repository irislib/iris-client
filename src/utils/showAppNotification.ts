/* global NotificationOptions */
export function showAppNotification(
  registration: ServiceWorkerRegistration,
  title: string,
  options: NotificationOptions
) {
  const appIcon = new URL(CONFIG.icon.replace(/^\//, ""), registration.scope).href
  return registration.showNotification(title, {
    ...options,
    icon: options.icon || appIcon,
    badge: appIcon,
  })
}
