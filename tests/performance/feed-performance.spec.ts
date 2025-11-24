import {test, expect} from "@playwright/test"
import {signUp} from "../auth.setup"
import {
  measureFeedRenderTime,
  measureFeedRenderTimeForCount,
  measureScrollPerformance,
  getMemoryUsage,
  measureMemoryGrowthDuringScroll,
  getDOMNodeCount,
  getComponentMetrics,
  clearReactMetrics,
  isReactProfilingEnabled,
  profileCPUDuringAction,
  measureLongTasksDuringAction,
} from "../utils/performance"
import * as fs from "fs"
import * as path from "path"

interface PerformanceBaselines {
  feedRenderTimeMs: number
  feedRenderTime10ItemsMs: number
  scrollAvgFrameTimeMs: number
  scrollMaxFrameTimeMs: number
  scrollDroppedFramesMax: number
  memoryUsageMaxMB: number
  memoryGrowthMaxMB: number
  domNodeMaxCount: number
}

// Load baselines from file
function loadBaselines(): PerformanceBaselines {
  const baselinePath = path.join(process.cwd(), "performance-baselines.json")
  if (fs.existsSync(baselinePath)) {
    const content = fs.readFileSync(baselinePath, "utf-8")
    return JSON.parse(content)
  }
  // Default baselines if file doesn't exist
  return {
    feedRenderTimeMs: 3000,
    feedRenderTime10ItemsMs: 5000,
    scrollAvgFrameTimeMs: 20,
    scrollMaxFrameTimeMs: 50,
    scrollDroppedFramesMax: 5,
    memoryUsageMaxMB: 150,
    memoryGrowthMaxMB: 50,
    domNodeMaxCount: 5000,
  }
}

// Save results for comparison (not committed to git)
function saveResults(testName: string, results: Record<string, number | string>) {
  const resultsDir = path.join(process.cwd(), "performance-results")
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, {recursive: true})
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const resultFile = path.join(resultsDir, `${testName}-${timestamp}.json`)

  fs.writeFileSync(
    resultFile,
    JSON.stringify(
      {
        ...results,
        timestamp: new Date().toISOString(),
        commit: process.env.GIT_COMMIT || "unknown",
      },
      null,
      2
    )
  )
}

test.describe("Feed Performance", () => {
  const baselines = loadBaselines()

  test.beforeEach(async ({page}) => {
    // Use a known npub with content for consistent testing
    const targetNpub = "npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk"
    await signUp(page, targetNpub)
  })

  test("feed renders first item within threshold", async ({page}) => {
    const renderTime = await measureFeedRenderTime(page)

    console.log(
      `Feed render time: ${renderTime}ms (threshold: ${baselines.feedRenderTimeMs}ms)`
    )
    saveResults("feed-render-first", {renderTimeMs: renderTime})

    expect(
      renderTime,
      `Feed should render first item within ${baselines.feedRenderTimeMs}ms`
    ).toBeLessThanOrEqual(baselines.feedRenderTimeMs)
  })

  test("feed renders 10 items within threshold", async ({page}) => {
    const renderTime = await measureFeedRenderTimeForCount(page, 10)

    console.log(
      `Feed render time (10 items): ${renderTime}ms (threshold: ${baselines.feedRenderTime10ItemsMs}ms)`
    )
    saveResults("feed-render-10", {renderTimeMs: renderTime})

    expect(
      renderTime,
      `Feed should render 10 items within ${baselines.feedRenderTime10ItemsMs}ms`
    ).toBeLessThanOrEqual(baselines.feedRenderTime10ItemsMs)
  })

  test("scroll performance meets frame time targets", async ({page}) => {
    // Wait for feed to have content
    await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
    await page.waitForTimeout(1000) // Let feed stabilize

    const scrollMetrics = await measureScrollPerformance(page, 2000, 60)

    console.log(
      `Scroll performance: avg=${scrollMetrics.avgFrameTime}ms, max=${scrollMetrics.maxFrameTime}ms, dropped=${scrollMetrics.droppedFrames}`
    )
    saveResults("scroll-performance", scrollMetrics)

    expect(
      scrollMetrics.avgFrameTime,
      `Average frame time should be under ${baselines.scrollAvgFrameTimeMs}ms`
    ).toBeLessThanOrEqual(baselines.scrollAvgFrameTimeMs)

    expect(
      scrollMetrics.maxFrameTime,
      `Max frame time should be under ${baselines.scrollMaxFrameTimeMs}ms`
    ).toBeLessThanOrEqual(baselines.scrollMaxFrameTimeMs)

    expect(
      scrollMetrics.droppedFrames,
      `Should have fewer than ${baselines.scrollDroppedFramesMax} dropped frames`
    ).toBeLessThanOrEqual(baselines.scrollDroppedFramesMax)
  })

  test("memory usage stays within limits", async ({page}) => {
    // Wait for feed to load
    await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
    await page.waitForTimeout(1000)

    const memory = await getMemoryUsage(page)

    console.log(
      `Memory usage: ${memory.usedHeapMB}MB (threshold: ${baselines.memoryUsageMaxMB}MB)`
    )
    saveResults("memory-usage", {
      usedHeapMB: memory.usedHeapMB,
      totalHeapMB: memory.totalHeapMB,
    })

    // Only assert if memory API is available (Chrome with flag)
    if (memory.usedHeapMB > 0) {
      expect(
        memory.usedHeapMB,
        `Memory usage should be under ${baselines.memoryUsageMaxMB}MB`
      ).toBeLessThanOrEqual(baselines.memoryUsageMaxMB)
    }
  })

  test("memory growth during scroll stays within limits", async ({page}) => {
    // Wait for feed to load
    await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
    await page.waitForTimeout(1000)

    const memoryGrowth = await measureMemoryGrowthDuringScroll(page, 5, 3000)

    console.log(
      `Memory growth: initial=${memoryGrowth.initialMB}MB, final=${memoryGrowth.finalMB}MB, growth=${memoryGrowth.growthMB}MB, peak=${memoryGrowth.peakMB}MB`
    )
    saveResults("memory-growth", memoryGrowth)

    // Only assert if memory API is available
    if (memoryGrowth.initialMB > 0) {
      expect(
        memoryGrowth.growthMB,
        `Memory growth during scroll should be under ${baselines.memoryGrowthMaxMB}MB`
      ).toBeLessThanOrEqual(baselines.memoryGrowthMaxMB)
    }
  })

  test("DOM node count stays reasonable", async ({page}) => {
    // Wait for feed to load
    await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
    await page.waitForTimeout(1000)

    const nodeCount = await getDOMNodeCount(page)

    console.log(`DOM nodes: ${nodeCount} (threshold: ${baselines.domNodeMaxCount})`)
    saveResults("dom-nodes", {nodeCount})

    expect(
      nodeCount,
      `DOM node count should be under ${baselines.domNodeMaxCount}`
    ).toBeLessThanOrEqual(baselines.domNodeMaxCount)
  })
})

test.describe("Navigation Performance", () => {
  const baselines = loadBaselines()

  test("navigation stack doesn't leak memory", async ({page}) => {
    await signUp(page)

    // Get initial memory
    const initialMemory = await getMemoryUsage(page)

    // Navigate through several pages
    const routes = ["/search", "/notifications", "/chats", "/"]
    for (const route of routes) {
      await page.goto(`http://localhost:5173${route}`)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(500)
    }

    // Navigate back through stack
    for (let i = 0; i < routes.length - 1; i++) {
      await page.goBack()
      await page.waitForTimeout(500)
    }

    const finalMemory = await getMemoryUsage(page)
    const growth = finalMemory.usedHeapMB - initialMemory.usedHeapMB

    console.log(
      `Navigation memory: initial=${initialMemory.usedHeapMB}MB, final=${finalMemory.usedHeapMB}MB, growth=${growth}MB`
    )
    saveResults("navigation-memory", {
      initialMB: initialMemory.usedHeapMB,
      finalMB: finalMemory.usedHeapMB,
      growthMB: growth,
    })

    // Only assert if memory API is available
    if (initialMemory.usedHeapMB > 0) {
      expect(
        growth,
        `Navigation should not leak more than ${baselines.memoryGrowthMaxMB}MB`
      ).toBeLessThanOrEqual(baselines.memoryGrowthMaxMB)
    }
  })
})

test.describe("React Render Profiling", () => {
  test.beforeEach(async ({page}) => {
    const targetNpub = "npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk"
    await signUp(page, targetNpub)
  })

  test("Feed component render count during initial load", async ({page}) => {
    // Check if profiling is enabled
    const profilingEnabled = await isReactProfilingEnabled(page)
    if (!profilingEnabled) {
      console.log("React profiling not enabled, skipping test")
      test.skip()
      return
    }

    // Wait for feed to load
    await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
    await page.waitForTimeout(1000)

    const metrics = await getComponentMetrics(page, "Feed")
    if (!metrics) {
      console.log("No Feed metrics available")
      return
    }

    console.log(
      `Feed renders: count=${metrics.renderCount}, total=${metrics.totalActualDuration}ms, avg=${metrics.avgActualDuration}ms, max=${metrics.maxActualDuration}ms`
    )
    saveResults("feed-render-count", {
      renderCount: metrics.renderCount,
      totalDuration: metrics.totalActualDuration,
      avgDuration: metrics.avgActualDuration,
      maxDuration: metrics.maxActualDuration,
    })

    // Soft assertion - log warning if too many renders
    if (metrics.renderCount > 20) {
      console.warn(
        `Warning: Feed rendered ${metrics.renderCount} times during initial load (expected <20)`
      )
    }
  })

  test("Feed render count during scroll", async ({page}) => {
    const profilingEnabled = await isReactProfilingEnabled(page)
    if (!profilingEnabled) {
      test.skip()
      return
    }

    // Wait for feed to load
    await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
    await page.waitForTimeout(1000)

    // Clear metrics before scroll test
    await clearReactMetrics(page)

    // Perform scroll action
    await page.evaluate(() => {
      window.scrollBy(0, 2000)
    })
    await page.waitForTimeout(1000)

    const metrics = await getComponentMetrics(page, "Feed")
    if (!metrics) {
      console.log("No Feed metrics available after scroll")
      return
    }

    console.log(
      `Feed renders during scroll: count=${metrics.renderCount}, total=${metrics.totalActualDuration}ms`
    )
    saveResults("feed-render-scroll", {
      renderCount: metrics.renderCount,
      totalDuration: metrics.totalActualDuration,
    })

    // Scrolling shouldn't cause excessive re-renders
    if (metrics.renderCount > 10) {
      console.warn(
        `Warning: Feed rendered ${metrics.renderCount} times during scroll (expected <10)`
      )
    }
  })
})

test.describe("CPU Profiling", () => {
  test.beforeEach(async ({page}) => {
    const targetNpub = "npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk"
    await signUp(page, targetNpub)
  })

  test("CPU profile during feed scroll", async ({page}) => {
    // Wait for feed to load
    await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
    await page.waitForTimeout(1000)

    const cpuProfile = await profileCPUDuringAction(
      page,
      async () => {
        // Scroll down and up
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000))
          await page.waitForTimeout(200)
        }
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, -1000))
          await page.waitForTimeout(200)
        }
      },
      15
    )

    console.log(`CPU profile: totalTime=${cpuProfile.totalTime}µs`)
    console.log("Hot functions:")
    for (const fn of cpuProfile.hotFunctions.slice(0, 10)) {
      console.log(`  ${fn.name}: ${fn.percentage}% (${fn.selfTime}µs)`)
    }

    saveResults("cpu-profile-scroll", {
      totalTime: cpuProfile.totalTime,
      hotFunctions: JSON.stringify(cpuProfile.hotFunctions),
    })
  })

  test("long tasks during feed load", async ({page}) => {
    // Start observing before navigation
    await page.goto("http://localhost:5173/")

    const longTasks = await measureLongTasksDuringAction(page, async () => {
      // Wait for feed to fully load
      await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000})
      await page.waitForTimeout(2000)
    })

    console.log(
      `Long tasks: count=${longTasks.count}, total=${longTasks.totalDuration}ms, max=${longTasks.maxDuration}ms`
    )
    saveResults("long-tasks-load", longTasks)

    // Warn if there are many long tasks
    if (longTasks.count > 5) {
      console.warn(`Warning: ${longTasks.count} long tasks (>50ms) detected during load`)
    }
    if (longTasks.maxDuration > 200) {
      console.warn(
        `Warning: Longest task was ${longTasks.maxDuration}ms (expected <200ms)`
      )
    }
  })
})
