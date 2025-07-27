// Runtime access to the global CONFIG defined by Vite
// This avoids importing Node.js config module in browser code

// Type for config object
interface ConfigType {
  appName: string
  defaultSettings: {
    irisApiUrl: string
    notificationServer: string
  }
  features: {
    analytics: boolean
  }
  [key: string]: unknown
}

// Get the global CONFIG defined by Vite at runtime
function getConfig(): ConfigType {
  // Use globalThis to access CONFIG safely
  if (typeof globalThis !== "undefined" && "CONFIG" in globalThis) {
    return (globalThis as unknown as {CONFIG: ConfigType}).CONFIG
  }
  // Fallback for development or if CONFIG isn't available
  return {
    appName: "Iris",
    defaultSettings: {
      irisApiUrl: "https://api.iris.to",
      notificationServer: "https://api.iris.to",
    },
    features: {
      analytics: false,
    },
  }
}

export const CONFIG: ConfigType = getConfig()
export default CONFIG
