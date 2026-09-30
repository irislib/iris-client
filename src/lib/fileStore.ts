import {DexieStore} from "@hashtree/dexie"
import {fromHex, sha256, toHex, type Store} from "@hashtree/core"
import localforage from "localforage"

export const FILE_STORE_NAME = "iris-client-blocks"
export const localBlocks = new DexieStore(FILE_STORE_NAME)
const uploadQueue = localforage.createInstance({name: "iris-client-file-outbox"})

/** Verified encrypted blocks are durable and available to the peer server. */
export function createFileStore(
  remote: Store,
  peerFetch: (hash: string) => Promise<Uint8Array | null>
): Store {
  const inflight = new Map<string, Promise<Uint8Array | null>>()
  let uploading = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  async function flush() {
    if (uploading) return
    uploading = true
    let failed = false
    try {
      for (const hash of await uploadQueue.keys()) {
        const data = await localBlocks.get(fromHex(hash))
        if (!data) {
          await uploadQueue.removeItem(hash)
          continue
        }
        try {
          if (!(await remote.put(fromHex(hash), data))) {
            failed = true
            break
          }
          await uploadQueue.removeItem(hash)
        } catch {
          failed = true
          break
        }
      }
    } finally {
      uploading = false
      if (await uploadQueue.length())
        retryTimer = setTimeout(
          () => {
            retryTimer = undefined
            void flush()
          },
          failed ? 30000 : 0
        )
    }
  }
  const schedule = () => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
    void flush()
  }
  if (typeof window !== "undefined") window.addEventListener("online", schedule)
  void flush()
  return {
    async put(hash, data) {
      if (toHex(await sha256(data)) !== toHex(hash))
        throw new Error("File block failed integrity check")
      await localBlocks.put(hash, data)
      await uploadQueue.setItem(toHex(hash), true)
      schedule()
      return true
    },
    async get(hash) {
      const cached = await localBlocks.get(hash)
      if (cached) return cached
      const key = toHex(hash)
      let task = inflight.get(key)
      if (!task) {
        task = (async () => {
          // Both paths have bounded I/O; a stalled peer cannot hold up an available CDN.
          const valid = async (data: Uint8Array | null) => {
            if (!data || toHex(await sha256(data)) !== key)
              throw new Error("File block unavailable")
            await localBlocks.put(hash, data)
            return data
          }
          try {
            return await Promise.any([
              peerFetch(key).then(valid),
              remote.get(hash).then(valid),
            ])
          } catch {
            return null
          }
        })().finally(() => inflight.delete(key))
        inflight.set(key, task)
      }
      return task
    },
    has: (hash) => localBlocks.has(hash),
    async delete(hash) {
      await uploadQueue.removeItem(toHex(hash))
      return localBlocks.delete(hash)
    },
  }
}
