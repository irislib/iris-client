const LOCK_NAME = "iris-private-messaging-runtime"
const CHANNEL_NAME = "iris-private-messaging-tab"

let releaseWebLock: (() => void) | null = null
let fallbackChannel: BroadcastChannel | null = null

const acquireBroadcastLock = async (): Promise<boolean> => {
  if (typeof BroadcastChannel === "undefined") return true

  const channel = new BroadcastChannel(CHANNEL_NAME)
  const tabId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
  const candidates = new Set([tabId])
  let existingHolder = false
  let holding = false

  channel.onmessage = ({data}) => {
    if (!data || data.tabId === tabId) return
    if (holding && (data.type === "probe" || data.type === "candidate")) {
      channel.postMessage({type: "held", tabId})
    } else if (data.type === "held") {
      existingHolder = true
    } else if (data.type === "candidate") {
      candidates.add(data.tabId)
    }
  }

  channel.postMessage({type: "probe", tabId})
  channel.postMessage({type: "candidate", tabId})
  await new Promise((resolve) => setTimeout(resolve, 100))

  if (existingHolder || [...candidates].sort()[0] !== tabId) {
    channel.close()
    return false
  }

  holding = true
  fallbackChannel = channel
  return true
}

export async function acquirePrivateMessagingTabLock(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return acquireBroadcastLock()
  }

  let settled = false
  let resolveDecision!: (acquired: boolean) => void
  const decision = new Promise<boolean>((resolve) => {
    resolveDecision = resolve
  })

  void navigator.locks
    .request(LOCK_NAME, {mode: "exclusive", ifAvailable: true}, async (lock) => {
      settled = true
      resolveDecision(Boolean(lock))
      if (!lock) return
      await new Promise<void>((resolve) => {
        releaseWebLock = resolve
      })
    })
    .catch(async () => {
      if (!settled) resolveDecision(await acquireBroadcastLock())
    })

  return decision
}

export function releasePrivateMessagingTabLock(): void {
  releaseWebLock?.()
  releaseWebLock = null
  fallbackChannel?.close()
  fallbackChannel = null
}
