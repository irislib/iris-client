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

export const navItemsConfig = (): Record<string, NavItemConfig> => ({
  home: {to: "/", icon: "home", label: "Home"},
  search: {to: "/search", icon: "search", label: "Search"},
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
  subscription: {
    to: "/subscribe",
    icon: "star",
    label: "Subscription",
    requireLogin: true,
  },
  about: {to: "/about", icon: "info", label: "About"},
})
