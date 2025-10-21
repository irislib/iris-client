declare global {
  interface Window {
    cf_turnstile_callback?: (token: string) => void
    webln?: WebLNProvider
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
    webkit?: {
      messageHandlers?: {
        push?: {
          postMessage?: (message: unknown) => void
        }
        pushNotification?: {
          postMessage?: (message: unknown) => void
        }
      }
    }
    Android?: {
      requestPushPermission?: () => void
      setFCMToken?: (token: string) => void
      registerForPushNotifications?: () => void
    }
  }
}

export interface WebLNProvider {
  enable?: () => Promise<void>
  isEnabled: () => Promise<boolean>
  sendPayment: (pr: string) => Promise<{preimage?: string}>
  makeInvoice?: (args: {
    amount: string
    defaultMemo?: string
  }) => Promise<{paymentRequest: string}>
  getBalance?: () => Promise<{balance: number}>
  on?: (eventName: "accountChanged", listener: () => void) => void
  off?: (eventName: "accountChanged", listener: () => void) => void
}

export interface EncryptionMeta {
  decryptionKey: string // hex string
  fileName: string // original file name
  fileSize: number // original file size in bytes
  algorithm?: string // e.g., 'AES-GCM'
}

export {}
