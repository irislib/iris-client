import {Page, CDPSession} from "@playwright/test"
import createDebug from "debug"

const debug = createDebug("test:performance")

// Types for React profiler metrics (matches src/utils/reactProfiler.ts)
export interface ReactRenderMetric {
  id: string
  phase: "mount" | "update" | "nested-update"
  actualDuration: number
  baseDuration: number
  startTime: number
  commitTime: number
}

export interface ReactComponentMetrics {
  renderCount: number
  totalActualDuration: number
  totalBaseDuration: number
  avgActualDuration: number
  avgBaseDuration: number
  maxActualDuration: number
  renders: ReactRenderMetric[]
}

export interface ReactPerfMetrics {
  [componentId: string]: ReactComponentMetrics
}

// Types for CPU profiling
export interface CPUProfile {
  nodes: Array<{
    id: number
    callFrame: {
      functionName: string
      scriptId: string
      url: string
      lineNumber: number
      columnNumber: number
    }
    hitCount: number
    children?: number[]
  }>
  startTime: number
  endTime: number
  samples: number[]
  timeDeltas: number[]
}

export interface CPUProfileSummary {
  totalTime: number
  hotFunctions: Array<{
    name: string
    selfTime: number
    percentage: number
  }>
}

export interface PerformanceMetrics {
  feedRenderTime: number
  scrollFrameTime: number
  memoryUsageMB: number
  memoryGrowthMB: number
}

export interface MemorySnapshot {
  timestamp: number
  usedHeapMB: number
  totalHeapMB: number
}

/**
 * Measure time until first feed item appears
 */
export async function measureFeedRenderTime(
  page: Page,
  timeoutMs = 10000
): Promise<number> {
  const startTime = Date.now()

  try {
    await page.waitForSelector('[data-testid="feed-item"]', {
      timeout: timeoutMs,
      state: "visible",
    })
    const renderTime = Date.now() - startTime
    debug("Feed render time: %dms", renderTime)
    return renderTime
  } catch {
    debug("Feed render timeout after %dms", timeoutMs)
    return timeoutMs
  }
}

/**
 * Measure time until N feed items are visible
 */
export async function measureFeedRenderTimeForCount(
  page: Page,
  count: number,
  timeoutMs = 15000
): Promise<number> {
  const startTime = Date.now()

  try {
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="feed-item"]').length >= n,
      count,
      {timeout: timeoutMs}
    )
    const renderTime = Date.now() - startTime
    debug("Feed render time for %d items: %dms", count, renderTime)
    return renderTime
  } catch {
    debug("Feed render timeout for %d items after %dms", count, timeoutMs)
    return timeoutMs
  }
}

/**
 * Measure scroll performance by tracking frame times during scroll
 */
export async function measureScrollPerformance(
  page: Page,
  scrollDistance = 2000,
  frameCount = 60
): Promise<{avgFrameTime: number; maxFrameTime: number; droppedFrames: number}> {
  return await page.evaluate(
    ({distance, frames}) => {
      return new Promise<{
        avgFrameTime: number
        maxFrameTime: number
        droppedFrames: number
      }>((resolve) => {
        const frameTimes: number[] = []
        let lastFrameTime = performance.now()
        let currentFrame = 0
        const scrollStep = distance / frames

        const measureFrame = () => {
          const now = performance.now()
          const frameTime = now - lastFrameTime
          frameTimes.push(frameTime)
          lastFrameTime = now
          currentFrame++

          // Scroll incrementally
          window.scrollBy(0, scrollStep)

          if (currentFrame < frames) {
            requestAnimationFrame(measureFrame)
          } else {
            const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
            const maxFrameTime = Math.max(...frameTimes)
            // Dropped frames = frames that took longer than 2x the target (16.67ms * 2)
            const droppedFrames = frameTimes.filter((t) => t > 33.34).length

            resolve({
              avgFrameTime: Math.round(avgFrameTime * 100) / 100,
              maxFrameTime: Math.round(maxFrameTime * 100) / 100,
              droppedFrames,
            })
          }
        }

        requestAnimationFrame(measureFrame)
      })
    },
    {distance: scrollDistance, frames: frameCount}
  )
}

/**
 * Get current memory usage in MB
 * Requires --enable-precise-memory-info Chrome flag (set in playwright.config.ts)
 */
export async function getMemoryUsage(page: Page): Promise<MemorySnapshot> {
  return await page.evaluate(() => {
    if ("memory" in performance && performance.memory) {
      const memory = performance.memory as unknown as {
        usedJSHeapSize: number
        totalJSHeapSize: number
      }
      return {
        timestamp: Date.now(),
        usedHeapMB: Math.round(memory.usedJSHeapSize / 1024 / 1024),
        totalHeapMB: Math.round(memory.totalJSHeapSize / 1024 / 1024),
      }
    }
    return {
      timestamp: Date.now(),
      usedHeapMB: 0,
      totalHeapMB: 0,
    }
  })
}

/**
 * Track memory usage over time during an action
 */
export async function trackMemoryDuringAction(
  page: Page,
  action: () => Promise<void>,
  intervalMs = 500
): Promise<{
  snapshots: MemorySnapshot[]
  peakUsageMB: number
  growthMB: number
}> {
  const snapshots: MemorySnapshot[] = []

  // Take initial snapshot
  const initial = await getMemoryUsage(page)
  snapshots.push(initial)

  // Start interval to collect snapshots
  const intervalId = setInterval(async () => {
    try {
      const snapshot = await getMemoryUsage(page)
      snapshots.push(snapshot)
    } catch {
      // Page may have navigated, ignore
    }
  }, intervalMs)

  // Execute the action
  await action()

  // Stop collecting and take final snapshot
  clearInterval(intervalId)
  const final = await getMemoryUsage(page)
  snapshots.push(final)

  const peakUsageMB = Math.max(...snapshots.map((s) => s.usedHeapMB))
  const growthMB = final.usedHeapMB - initial.usedHeapMB

  debug(
    "Memory tracking: initial=%dMB, peak=%dMB, final=%dMB, growth=%dMB",
    initial.usedHeapMB,
    peakUsageMB,
    final.usedHeapMB,
    growthMB
  )

  return {snapshots, peakUsageMB, growthMB}
}

/**
 * Measure memory growth after repeated scrolling (simulates extended session)
 */
export async function measureMemoryGrowthDuringScroll(
  page: Page,
  scrollCycles = 5,
  scrollDistance = 3000
): Promise<{initialMB: number; finalMB: number; growthMB: number; peakMB: number}> {
  const initial = await getMemoryUsage(page)
  let peak = initial.usedHeapMB

  for (let i = 0; i < scrollCycles; i++) {
    // Scroll down
    await page.evaluate((dist) => window.scrollBy(0, dist), scrollDistance)
    await page.waitForTimeout(500)

    // Scroll back up
    await page.evaluate((dist) => window.scrollBy(0, -dist), scrollDistance)
    await page.waitForTimeout(500)

    // Check memory
    const current = await getMemoryUsage(page)
    peak = Math.max(peak, current.usedHeapMB)
  }

  // Force garbage collection if available (Chrome with --js-flags="--expose-gc")

  await page.evaluate(() => {
    const g = window as unknown as {gc?: () => void}
    if (typeof g.gc === "function") {
      g.gc()
    }
  })
  await page.waitForTimeout(100)

  const final = await getMemoryUsage(page)

  return {
    initialMB: initial.usedHeapMB,
    finalMB: final.usedHeapMB,
    growthMB: final.usedHeapMB - initial.usedHeapMB,
    peakMB: peak,
  }
}

/**
 * Count number of DOM nodes (useful for detecting memory leaks from unmounted components)
 */
export async function getDOMNodeCount(page: Page): Promise<number> {
  return await page.evaluate(() => document.getElementsByTagName("*").length)
}

/**
 * Measure DOM growth during an action
 */
export async function measureDOMGrowth(
  page: Page,
  action: () => Promise<void>
): Promise<{initialNodes: number; finalNodes: number; growth: number}> {
  const initialNodes = await getDOMNodeCount(page)
  await action()
  const finalNodes = await getDOMNodeCount(page)

  return {
    initialNodes,
    finalNodes,
    growth: finalNodes - initialNodes,
  }
}

// ============================================================================
// React Profiler Utilities
// ============================================================================

/**
 * Check if React profiling is available on the page
 */
export async function isReactProfilingEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    return typeof window.__REACT_PERF__ !== "undefined"
  })
}

/**
 * Get React render metrics from the page
 * Requires VITE_PERF_PROFILING=true or test relay mode
 */
export async function getReactMetrics(page: Page): Promise<ReactPerfMetrics | null> {
  return await page.evaluate(() => {
    if (typeof window.__REACT_PERF__ === "undefined") {
      return null
    }
    return window.__REACT_PERF__.getMetrics()
  })
}

/**
 * Get metrics for a specific component
 */
export async function getComponentMetrics(
  page: Page,
  componentId: string
): Promise<ReactComponentMetrics | null> {
  return await page.evaluate(
    ({id}) => {
      if (typeof window.__REACT_PERF__ === "undefined") {
        return null
      }
      return window.__REACT_PERF__.getComponentMetrics(id)
    },
    {id: componentId}
  )
}

/**
 * Clear React profiler metrics (useful between test phases)
 */
export async function clearReactMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (typeof window.__REACT_PERF__ !== "undefined") {
      window.__REACT_PERF__.clear()
    }
  })
}

/**
 * Measure React render counts during an action
 */
export async function measureRendersDuringAction(
  page: Page,
  componentId: string,
  action: () => Promise<void>
): Promise<{renderCount: number; totalDuration: number; avgDuration: number} | null> {
  // Clear existing metrics
  await clearReactMetrics(page)

  // Perform the action
  await action()

  // Get metrics
  const metrics = await getComponentMetrics(page, componentId)
  if (!metrics) {
    debug("React profiling not available for component: %s", componentId)
    return null
  }

  debug(
    "Component %s: %d renders, total=%dms, avg=%dms",
    componentId,
    metrics.renderCount,
    metrics.totalActualDuration,
    metrics.avgActualDuration
  )

  return {
    renderCount: metrics.renderCount,
    totalDuration: metrics.totalActualDuration,
    avgDuration: metrics.avgActualDuration,
  }
}

// ============================================================================
// CDP-based CPU Profiling
// ============================================================================

/**
 * Start CPU profiling via Chrome DevTools Protocol
 */
export async function startCPUProfile(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page)
  await client.send("Profiler.enable")
  await client.send("Profiler.start")
  debug("CPU profiling started")
  return client
}

/**
 * Stop CPU profiling and get the profile
 */
export async function stopCPUProfile(client: CDPSession): Promise<CPUProfile> {
  const {profile} = (await client.send("Profiler.stop")) as {profile: CPUProfile}
  await client.send("Profiler.disable")
  debug("CPU profiling stopped, got %d samples", profile.samples?.length || 0)
  return profile
}

/**
 * Analyze a CPU profile and get summary of hot functions
 */
export function analyzeCPUProfile(profile: CPUProfile, topN = 10): CPUProfileSummary {
  const totalTime = profile.endTime - profile.startTime

  // Calculate self time for each node
  const selfTimes = new Map<number, number>()
  const nodeMap = new Map(profile.nodes.map((n) => [n.id, n]))

  // Count samples per node
  for (const sampleId of profile.samples) {
    selfTimes.set(sampleId, (selfTimes.get(sampleId) || 0) + 1)
  }

  // Convert to function-level aggregation
  const functionTimes = new Map<string, number>()
  for (const [nodeId, count] of selfTimes) {
    const node = nodeMap.get(nodeId)
    if (node) {
      const name = node.callFrame.functionName || "(anonymous)"
      functionTimes.set(name, (functionTimes.get(name) || 0) + count)
    }
  }

  // Sort by time and get top N
  const sortedFunctions = Array.from(functionTimes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)

  const totalSamples = profile.samples.length
  const hotFunctions = sortedFunctions.map(([name, samples]) => ({
    name,
    selfTime: Math.round((samples / totalSamples) * totalTime),
    percentage: Math.round((samples / totalSamples) * 100 * 10) / 10,
  }))

  return {totalTime, hotFunctions}
}

/**
 * Profile CPU during an action and return summary
 */
export async function profileCPUDuringAction(
  page: Page,
  action: () => Promise<void>,
  topN = 10
): Promise<CPUProfileSummary> {
  const client = await startCPUProfile(page)
  await action()
  const profile = await stopCPUProfile(client)
  return analyzeCPUProfile(profile, topN)
}

// ============================================================================
// Long Task Detection (via PerformanceObserver)
// ============================================================================

/**
 * Start observing long tasks (>50ms) on the page
 * Returns a function to stop observing and get results
 */
export async function observeLongTasks(
  page: Page
): Promise<{stop: () => Promise<Array<{duration: number; startTime: number}>>}> {
  await page.evaluate(() => {
    ;(
      window as unknown as {__LONG_TASKS__: Array<{duration: number; startTime: number}>}
    ).__LONG_TASKS__ = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        ;(
          window as unknown as {
            __LONG_TASKS__: Array<{duration: number; startTime: number}>
          }
        ).__LONG_TASKS__.push({
          duration: entry.duration,
          startTime: entry.startTime,
        })
      }
    })
    observer.observe({entryTypes: ["longtask"]})
    ;(
      window as unknown as {__LONG_TASK_OBSERVER__: PerformanceObserver}
    ).__LONG_TASK_OBSERVER__ = observer
  })

  return {
    stop: async () => {
      return await page.evaluate(() => {
        const observer = (
          window as unknown as {__LONG_TASK_OBSERVER__?: PerformanceObserver}
        ).__LONG_TASK_OBSERVER__
        if (observer) {
          observer.disconnect()
        }
        return (
          (
            window as unknown as {
              __LONG_TASKS__?: Array<{duration: number; startTime: number}>
            }
          ).__LONG_TASKS__ || []
        )
      })
    },
  }
}

/**
 * Measure long tasks during an action
 */
export async function measureLongTasksDuringAction(
  page: Page,
  action: () => Promise<void>
): Promise<{count: number; totalDuration: number; maxDuration: number}> {
  const observer = await observeLongTasks(page)
  await action()
  const tasks = await observer.stop()

  const count = tasks.length
  const totalDuration = tasks.reduce((sum, t) => sum + t.duration, 0)
  const maxDuration = tasks.length > 0 ? Math.max(...tasks.map((t) => t.duration)) : 0

  debug("Long tasks: count=%d, total=%dms, max=%dms", count, totalDuration, maxDuration)

  return {
    count,
    totalDuration: Math.round(totalDuration),
    maxDuration: Math.round(maxDuration),
  }
}

// ============================================================================
// Web Worker Profiling
// ============================================================================

export interface WorkerInfo {
  url: string
  id: string
}

export interface WorkerMessageMetrics {
  messageType: string
  count: number
  totalDuration: number
  avgDuration: number
  maxDuration: number
}

/**
 * Get list of active web workers via CDP
 */
export async function getActiveWorkers(page: Page): Promise<WorkerInfo[]> {
  const client = await page.context().newCDPSession(page)
  await client.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  })

  const workers: WorkerInfo[] = []

  // Get all targets
  const {targetInfos} = await client.send("Target.getTargets")
  for (const target of targetInfos) {
    if (target.type === "worker" || target.type === "service_worker") {
      workers.push({
        url: target.url,
        id: target.targetId,
      })
    }
  }

  debug("Found %d workers", workers.length)
  return workers
}

/**
 * Profile a specific worker by target ID
 */
export async function profileWorker(
  page: Page,
  workerId: string,
  action: () => Promise<void>,
  topN = 10
): Promise<CPUProfileSummary | null> {
  const client = await page.context().newCDPSession(page)

  try {
    // Attach to worker
    const {sessionId} = await client.send("Target.attachToTarget", {
      targetId: workerId,
      flatten: true,
    })

    // Send profiler commands to the worker session
    await client.send("Runtime.runIfWaitingForDebugger", {}, sessionId)
    await client.send("Profiler.enable", {}, sessionId)
    await client.send("Profiler.start", {}, sessionId)

    debug("Started profiling worker %s", workerId)

    // Run the action
    await action()

    // Stop profiling
    const {profile} = (await client.send("Profiler.stop", {}, sessionId)) as {
      profile: CPUProfile
    }
    await client.send("Profiler.disable", {}, sessionId)

    debug("Worker profile: %d samples", profile.samples?.length || 0)
    return analyzeCPUProfile(profile, topN)
  } catch (err) {
    debug("Failed to profile worker: %s", err)
    return null
  }
}

/**
 * Measure relay worker message round-trip times
 * Injects timing instrumentation into postMessage
 */
export async function measureWorkerMessageLatency(
  page: Page,
  durationMs = 5000
): Promise<{messages: WorkerMessageMetrics[]; totalMessages: number}> {
  // Inject timing code
  await page.evaluate(() => {
    const messageTimings: Array<{type: string; duration: number}> = []
    const pendingMessages = new Map<string, number>()

    // Store original postMessage
    const workers = (window as unknown as {__RELAY_WORKER__?: Worker}).__RELAY_WORKER__
    if (!workers) {
      console.warn("No relay worker found")
      return
    }

    // Intercept worker messages
    const originalOnMessage = workers.onmessage
    workers.onmessage = (event) => {
      const data = event.data
      if (data.id && pendingMessages.has(data.id)) {
        const startTime = pendingMessages.get(data.id)!
        const duration = performance.now() - startTime
        messageTimings.push({type: data.type, duration})
        pendingMessages.delete(data.id)
      }
      if (originalOnMessage) {
        originalOnMessage.call(workers, event)
      }
    }

    // Intercept postMessage
    const originalPostMessage = workers.postMessage.bind(workers)
    workers.postMessage = (message: {type: string; id?: string}) => {
      if (message.id) {
        pendingMessages.set(message.id, performance.now())
      }
      originalPostMessage(message)
    }
    ;(
      window as unknown as {__WORKER_MESSAGE_TIMINGS__: typeof messageTimings}
    ).__WORKER_MESSAGE_TIMINGS__ = messageTimings
  })

  // Wait for measurements
  await page.waitForTimeout(durationMs)

  // Collect results
  const timings = await page.evaluate(() => {
    return (
      (
        window as unknown as {
          __WORKER_MESSAGE_TIMINGS__?: Array<{type: string; duration: number}>
        }
      ).__WORKER_MESSAGE_TIMINGS__ || []
    )
  })

  // Aggregate by message type
  const byType = new Map<string, number[]>()
  for (const timing of timings) {
    if (!byType.has(timing.type)) {
      byType.set(timing.type, [])
    }
    byType.get(timing.type)!.push(timing.duration)
  }

  const messages: WorkerMessageMetrics[] = Array.from(byType.entries()).map(
    ([type, durations]) => ({
      messageType: type,
      count: durations.length,
      totalDuration: Math.round(durations.reduce((a, b) => a + b, 0)),
      avgDuration:
        Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100,
      maxDuration: Math.round(Math.max(...durations) * 100) / 100,
    })
  )

  debug(
    "Worker message timings: %d types, %d total messages",
    messages.length,
    timings.length
  )

  return {messages, totalMessages: timings.length}
}

/**
 * Get relay worker stats (subscriptions, cache hits, etc)
 */
export async function getRelayWorkerStats(
  page: Page
): Promise<{totalEvents: number; eventsByKind: Record<number, number>} | null> {
  return await page.evaluate(async () => {
    const worker = (window as unknown as {__RELAY_WORKER__?: Worker}).__RELAY_WORKER__
    if (!worker) return null

    return new Promise((resolve) => {
      const id = `stats-${Date.now()}`
      const handler = (event: MessageEvent) => {
        if (event.data.type === "stats" && event.data.id === id) {
          worker.removeEventListener("message", handler)
          resolve(event.data.stats)
        }
      }
      worker.addEventListener("message", handler)
      worker.postMessage({type: "getStats", id})

      // Timeout after 5s
      setTimeout(() => {
        worker.removeEventListener("message", handler)
        resolve(null)
      }, 5000)
    })
  })
}

/**
 * Get relay connection statuses from worker
 */
export async function getRelayStatuses(
  page: Page
): Promise<Array<{url: string; status: number; stats: object}> | null> {
  return await page.evaluate(async () => {
    const worker = (window as unknown as {__RELAY_WORKER__?: Worker}).__RELAY_WORKER__
    if (!worker) return null

    return new Promise((resolve) => {
      const id = `relay-status-${Date.now()}`
      const handler = (event: MessageEvent) => {
        if (event.data.type === "relayStatus" && event.data.id === id) {
          worker.removeEventListener("message", handler)
          resolve(event.data.relayStatuses)
        }
      }
      worker.addEventListener("message", handler)
      worker.postMessage({type: "getRelayStatus", id})

      setTimeout(() => {
        worker.removeEventListener("message", handler)
        resolve(null)
      }, 5000)
    })
  })
}
