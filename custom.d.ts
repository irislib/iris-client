/// <reference types="vite/client" />

// Add any custom type declarations here

// Nostr extension types
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>
      nip04?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>
        decrypt(pubkey: string, ciphertext: string): Promise<string>
      }
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>
        decrypt(pubkey: string, ciphertext: string): Promise<string>
      }
    }
  }
}

export {}

// Add missing module declarations
declare module "tseep" {
  export class EventEmitter {
    emit(event: string, ...args: unknown[]): boolean
    on(event: string, listener: (...args: unknown[]) => void): this
    off(event: string, listener: (...args: unknown[]) => void): this
  }
}

declare const CONFIG: {
  appName: string
  [key: string]: unknown
}

interface Performance {
  memory?: {
    jsHeapSizeLimit: number
    totalJSHeapSize: number
    usedJSHeapSize: number
  }
}
