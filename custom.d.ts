/// <reference types="vite/client" />

declare const CONFIG: {
  appName: string
  appNameCapitalized: string
  appTitle: string
  hostname: string
  nip05Domain: string
  icon: string
  navLogo: string
  defaultTheme: string
  defaultNotesTheme: string
  navItems: string[]
  aboutText: string
  repository: string
  features: {
    pushNotifications: boolean
    analytics: boolean
  }
  defaultSettings: {
    notificationServer: string
  }
}
