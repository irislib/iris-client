/// <reference types="vite/client" />

// Add any custom type declarations here

// Nostr extension types
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: any): Promise<any>
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
    emit(event: string, ...args: any[]): boolean
    on(event: string, listener: (...args: any[]) => void): this
    off(event: string, listener: (...args: any[]) => void): this
  }
}

declare const CONFIG: {
  appName: string
  [key: string]: any
}

interface Performance {
  memory?: {
    jsHeapSizeLimit: number
    totalJSHeapSize: number
    usedJSHeapSize: number
  }
}
