import {MouseEventHandler} from "react"

export interface NavItemConfig {
  to: string
  label: string
  icon?: string
  activeIcon?: string
  inactiveIcon?: string
  requireLogin?: boolean
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export const navItemsConfig = (): Record<string, NavItemConfig> => {
  const items: Record<string, NavItemConfig> = {
    home: {to: "/", icon: "home", label: "Home"},
    groups: {
      to: CONFIG.appVariant === "groups" ? "/" : "/groups",
      icon: "groups",
      label: "Groups",
    },
    search: {
      to: "/u",
      icon: "search",
      label: "Search",
    },
    messages: {
      to: "/chats",
      icon: "mail",
      label: "Chats",
      requireLogin: true,
    },
    notifications: {
      to: "/notifications",
      icon: "notifications",
      label: "Notifications",
      requireLogin: true,
    },
    wallet: {
      to: "/wallet",
      icon: "wallet",
      label: "Wallet",
      requireLogin: true,
    },
    settings: {to: "/settings", icon: "settings", label: "Settings", requireLogin: true},
    about: {to: "/about", icon: "info", label: "About"},
  }

  if (!CONFIG.navItems) return items
  return Object.fromEntries(
    CONFIG.navItems.filter((key) => items[key]).map((key) => [key, items[key]])
  )
}
