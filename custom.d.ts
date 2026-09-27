/// <reference types="vite/client" />

declare const CONFIG: {
  appVariant: "iris" | "groups"
  appName: string
  appNameCapitalized: string
  appTitle: string
  hostname: string
  nip05Domain: string
  icon: string
  navLogo: string
  defaultTheme: string
  navItems?: string[]
  aboutText: string
  repository: string
  features: {
    analytics: boolean
    showSubscriptionSettings: boolean
  }
  defaultSettings: {
    notificationServer: string
    irisApiUrl: string
  }
}

interface Performance {
  memory?: {
    jsHeapSizeLimit: number
    totalJSHeapSize: number
    usedJSHeapSize: number
  }
}
