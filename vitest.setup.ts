import "fake-indexeddb/auto"

const storage = (() => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
})()

const globalScope = typeof window !== "undefined" ? window : global

Object.defineProperty(globalScope, "localStorage", {
  value: storage,
  configurable: true,
})

Object.defineProperty(globalScope, "sessionStorage", {
  value: storage,
  configurable: true,
})
