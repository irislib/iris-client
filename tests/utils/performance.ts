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
