import {Page} from "@playwright/test"
import createDebug from "debug"

const debug = createDebug("test:performance")

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
