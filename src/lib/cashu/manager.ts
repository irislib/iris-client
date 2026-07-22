import {Manager, ConsoleLogger} from "./core/index"
import {IndexedDbRepositories} from "./indexeddb/index"

let managerInstance: Manager | null = null
let managerInitPromise: Promise<Manager> | null = null

const getSeed = async (): Promise<Uint8Array> => {
  const storedSeed = localStorage.getItem("cashu:seed")

  if (storedSeed) {
    return Uint8Array.from(atob(storedSeed), (c) => c.charCodeAt(0))
  }

  // Generate new 64-byte seed
  const seed = new Uint8Array(64)
  crypto.getRandomValues(seed)

  // Store for future use
  localStorage.setItem("cashu:seed", btoa(String.fromCharCode(...seed)))

  return seed
}

export const initCashuManager = async (): Promise<Manager> => {
  if (managerInstance) return managerInstance
  if (managerInitPromise) return managerInitPromise

  managerInitPromise = (async () => {
    const repos = new IndexedDbRepositories({name: "iris-cashu-db"})
    await repos.init()

    const manager = new Manager(
      repos,
      getSeed,
      new ConsoleLogger("cashu", {level: "warn"})
    )
    try {
      await manager.enableMintQuoteWatcher({watchExistingPendingOnStart: true})
      await manager.enableProofStateWatcher()
      await manager.enableMintQuoteProcessor()
      await manager.quotes.requeuePaidMintQuotes()
      managerInstance = manager
      return manager
    } catch (error) {
      await manager.dispose().catch(() => {})
      throw error
    }
  })()

  try {
    return await managerInitPromise
  } finally {
    managerInitPromise = null
  }
}

export const getCashuManager = (): Manager | null => {
  return managerInstance
}

export const disposeCashuManager = async (): Promise<void> => {
  if (managerInitPromise) await managerInitPromise.catch(() => {})
  if (managerInstance) {
    await managerInstance.dispose()
    managerInstance = null
  }
}
