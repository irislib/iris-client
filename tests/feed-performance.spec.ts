import {test, expect, Page, CDPSession} from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const OUTPUT_DIR = "/tmp/iris-perf"

interface HeapSummary {
  totalSize: number
  totalCount: number
  byType: Record<string, {size: number; count: number}>
}

interface PerformanceReport {
  timestamp: string
  feedRenderTime: number
  scrollFrameTime: number
  memoryUsage: {
    jsHeapUsedSize: number
    jsHeapTotalSize: number
  }
  cpuProfile?: {
    hotspots: Array<{
      functionName: string
      url: string
      lineNumber: number
      selfTime: number
      totalTime: number
    }>
  }
  heapSnapshot?: HeapSummary
}

// Ensure output directory exists
function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, {recursive: true})
  }
}

async function startCPUProfile(cdp: CDPSession) {
  await cdp.send("Profiler.enable")
  await cdp.send("Profiler.start")
}

async function stopCPUProfile(cdp: CDPSession): Promise<PerformanceReport["cpuProfile"]> {
  const {profile} = await cdp.send("Profiler.stop")

  // Process profile to find hotspots
  const nodes = profile.nodes || []
  const samples = profile.samples || []
  const timeDeltas = profile.timeDeltas || []

  // Build node map
  const nodeMap = new Map<number, (typeof nodes)[0]>()
  nodes.forEach((node: (typeof nodes)[0]) => nodeMap.set(node.id, node))

  // Calculate time per node
  const nodeTime = new Map<number, number>()
  samples.forEach((nodeId: number, index: number) => {
    const delta = timeDeltas[index] || 0
    nodeTime.set(nodeId, (nodeTime.get(nodeId) || 0) + delta)
  })

  // Convert to hotspots list
  const hotspots: PerformanceReport["cpuProfile"]["hotspots"] = []
  nodeTime.forEach((selfTime, nodeId) => {
    const node = nodeMap.get(nodeId)
    if (node && node.callFrame) {
      const {functionName, url, lineNumber} = node.callFrame
      // Skip native/internal functions
      if (url && !url.startsWith("native") && functionName !== "(idle)") {
        hotspots.push({
          functionName: functionName || "(anonymous)",
          url,
          lineNumber,
          selfTime,
          totalTime: selfTime, // Simplified - would need tree traversal for accurate total
        })
      }
    }
  })

  // Sort by self time descending
  hotspots.sort((a, b) => b.selfTime - a.selfTime)

  return {hotspots: hotspots.slice(0, 50)} // Top 50 hotspots
}

async function takeHeapSnapshot(cdp: CDPSession): Promise<HeapSummary> {
  let snapshotData = ""

  cdp.on("HeapProfiler.addHeapSnapshotChunk", (params) => {
    snapshotData += params.chunk
  })

  await cdp.send("HeapProfiler.enable")
  await cdp.send("HeapProfiler.takeHeapSnapshot", {reportProgress: false})

  // Parse snapshot (simplified - full parsing is complex)
  try {
    const snapshot = JSON.parse(snapshotData)
    const summary: HeapSummary = {
      totalSize: 0,
      totalCount: 0,
      byType: {},
    }

    if (snapshot.nodes && snapshot.strings) {
      const nodeFields = snapshot.snapshot?.meta?.node_fields || []
      const typeIndex = nodeFields.indexOf("type")
      const nameIndex = nodeFields.indexOf("name")
      const selfSizeIndex = nodeFields.indexOf("self_size")
      const nodeFieldCount = nodeFields.length

      const nodeTypes = snapshot.snapshot?.meta?.node_types?.[0] || []

      for (let i = 0; i < snapshot.nodes.length; i += nodeFieldCount) {
        const typeIdx = snapshot.nodes[i + typeIndex]
        const nameIdx = snapshot.nodes[i + nameIndex]
        const selfSize = snapshot.nodes[i + selfSizeIndex]

        const typeName = nodeTypes[typeIdx] || "unknown"
        const name = snapshot.strings[nameIdx] || ""

        summary.totalSize += selfSize
        summary.totalCount++

        const key = `${typeName}:${name.substring(0, 50)}`
        if (!summary.byType[key]) {
          summary.byType[key] = {size: 0, count: 0}
        }
        summary.byType[key].size += selfSize
        summary.byType[key].count++
      }
    }

    return summary
  } catch {
    return {totalSize: 0, totalCount: 0, byType: {}}
  }
}

async function getMemoryMetrics(
  cdp: CDPSession
): Promise<PerformanceReport["memoryUsage"]> {
  const metrics = await cdp.send("Performance.getMetrics")
  const metricsMap = new Map(
    metrics.metrics.map((m: {name: string; value: number}) => [m.name, m.value])
  )

  return {
    jsHeapUsedSize: (metricsMap.get("JSHeapUsedSize") as number) || 0,
    jsHeapTotalSize: (metricsMap.get("JSHeapTotalSize") as number) || 0,
  }
}

async function measureFeedRenderTime(page: Page): Promise<number> {
  // Wait for page to stabilize first
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(500)

  const startTime = Date.now()

  // Wait for feed items with a selector
  try {
    await page.waitForSelector(
      '[data-event-id], .feed-item, [class*="FeedItem"], [data-scrollable]',
      {timeout: 30000}
    )
  } catch {
    // Continue even if no items found
  }

  return Date.now() - startTime
}

async function measureScrollPerformance(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      const frameTimes: number[] = []
      let lastFrameTime = performance.now()
      let frameCount = 0
      const targetFrames = 60

      const measureFrame = () => {
        const now = performance.now()
        frameTimes.push(now - lastFrameTime)
        lastFrameTime = now
        frameCount++

        if (frameCount < targetFrames) {
          requestAnimationFrame(measureFrame)
        } else {
          const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
          resolve(avgFrameTime)
        }
      }

      // Find scrollable container
      const scrollable =
        document.querySelector("[data-scrollable]") ||
        document.querySelector('[data-main-scroll-container="middle-column"]') ||
        document.documentElement

      // Perform scroll
      if (scrollable && "scrollBy" in scrollable) {
        ;(scrollable as HTMLElement).scrollBy({top: 500, behavior: "smooth"})
      } else {
        window.scrollBy({top: 500, behavior: "smooth"})
      }

      requestAnimationFrame(measureFrame)
    })
  })
}

test.describe("Feed Performance Analysis", () => {
  test.beforeAll(() => {
    ensureOutputDir()
  })

  test("CPU and Memory profiling during feed load", async ({page}) => {
    test.setTimeout(120000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")

    // Navigate to home page first
    await page.goto("/", {waitUntil: "domcontentloaded"})
    await page.waitForTimeout(1000)

    // Start profiling after page is stable
    await startCPUProfile(cdp)

    // Wait for feed to load
    const feedRenderTime = await measureFeedRenderTime(page)
    console.log(`Feed render time: ${feedRenderTime.toFixed(2)}ms`)

    // Continue profiling during scroll
    const scrollFrameTime = await measureScrollPerformance(page)
    console.log(`Average scroll frame time: ${scrollFrameTime.toFixed(2)}ms`)

    // Stop CPU profiling
    const cpuProfile = await stopCPUProfile(cdp)

    // Get memory metrics
    const memoryUsage = await getMemoryMetrics(cdp)
    console.log(
      `Memory: ${(memoryUsage.jsHeapUsedSize / 1024 / 1024).toFixed(2)}MB used / ${(memoryUsage.jsHeapTotalSize / 1024 / 1024).toFixed(2)}MB total`
    )

    // Take heap snapshot
    console.log("Taking heap snapshot...")
    const heapSnapshot = await takeHeapSnapshot(cdp)
    console.log(
      `Heap: ${(heapSnapshot.totalSize / 1024 / 1024).toFixed(2)}MB, ${heapSnapshot.totalCount} objects`
    )

    // Build report
    const report: PerformanceReport = {
      timestamp: new Date().toISOString(),
      feedRenderTime,
      scrollFrameTime,
      memoryUsage,
      cpuProfile,
      heapSnapshot,
    }

    // Write report
    const reportPath = path.join(OUTPUT_DIR, "performance-report.json")
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`Report saved to ${reportPath}`)

    // Print CPU hotspots
    console.log("\n=== CPU HOTSPOTS (Top 20) ===")
    cpuProfile?.hotspots.slice(0, 20).forEach((h, i) => {
      const shortUrl = h.url.split("/").slice(-2).join("/")
      console.log(
        `${i + 1}. ${h.functionName} (${shortUrl}:${h.lineNumber}) - ${(h.selfTime / 1000).toFixed(2)}ms`
      )
    })

    // Print memory by type (top 20)
    console.log("\n=== MEMORY BY TYPE (Top 20) ===")
    const sortedTypes = Object.entries(heapSnapshot.byType)
      .sort(([, a], [, b]) => b.size - a.size)
      .slice(0, 20)
    sortedTypes.forEach(([type, data]) => {
      console.log(`${type}: ${(data.size / 1024).toFixed(2)}KB (${data.count} objects)`)
    })

    // Assertions - relaxed for test environment without actual feed data
    expect(scrollFrameTime).toBeLessThan(50) // Target 20fps minimum (50ms/frame)
  })

  test("Memory leak detection during navigation", async ({page}) => {
    test.setTimeout(120000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")

    // Initial load
    await page.goto("/", {waitUntil: "domcontentloaded"})
    await page.waitForTimeout(1000)

    // Force GC
    await cdp.send("HeapProfiler.enable")
    await cdp.send("HeapProfiler.collectGarbage")
    await page.waitForTimeout(500)

    const initialMemory = await getMemoryMetrics(cdp)
    console.log(
      `Initial memory: ${(initialMemory.jsHeapUsedSize / 1024 / 1024).toFixed(2)}MB`
    )

    // Navigate multiple times
    const memorySnapshots: number[] = [initialMemory.jsHeapUsedSize]

    for (let i = 0; i < 5; i++) {
      // Scroll down to load more content
      await page.evaluate(() => {
        const scrollable =
          document.querySelector("[data-scrollable]") ||
          document.querySelector('[data-main-scroll-container="middle-column"]')
        if (scrollable) {
          ;(scrollable as HTMLElement).scrollBy({top: 1000, behavior: "instant"})
        } else {
          window.scrollBy({top: 1000, behavior: "instant"})
        }
      })
      await page.waitForTimeout(1000)

      // Scroll back up
      await page.evaluate(() => {
        const scrollable =
          document.querySelector("[data-scrollable]") ||
          document.querySelector('[data-main-scroll-container="middle-column"]')
        if (scrollable) {
          ;(scrollable as HTMLElement).scrollTo({top: 0, behavior: "instant"})
        } else {
          window.scrollTo({top: 0, behavior: "instant"})
        }
      })
      await page.waitForTimeout(500)

      // Force GC and measure
      await cdp.send("HeapProfiler.collectGarbage")
      await page.waitForTimeout(500)

      const memory = await getMemoryMetrics(cdp)
      memorySnapshots.push(memory.jsHeapUsedSize)
      console.log(
        `After iteration ${i + 1}: ${(memory.jsHeapUsedSize / 1024 / 1024).toFixed(2)}MB`
      )
    }

    // Check for memory growth
    const memoryGrowth = memorySnapshots[memorySnapshots.length - 1] - memorySnapshots[0]
    const growthPercent = (memoryGrowth / memorySnapshots[0]) * 100

    console.log(
      `\nMemory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB (${growthPercent.toFixed(1)}%)`
    )

    // Save memory trend
    const trendPath = path.join(OUTPUT_DIR, "memory-trend.json")
    fs.writeFileSync(
      trendPath,
      JSON.stringify(
        {
          snapshots: memorySnapshots.map((m, i) => ({
            iteration: i,
            heapUsedMB: m / 1024 / 1024,
          })),
          growthMB: memoryGrowth / 1024 / 1024,
          growthPercent,
        },
        null,
        2
      )
    )

    // Warn if significant memory growth (>50%)
    if (growthPercent > 50) {
      console.warn(
        `WARNING: Significant memory growth detected (${growthPercent.toFixed(1)}%)`
      )
    }

    expect(growthPercent).toBeLessThan(100) // Memory shouldn't double
  })

  test("Detailed CPU profiling with function timings", async ({page}) => {
    const cdp = await page.context().newCDPSession(page)

    // Enable performance and profiler
    await cdp.send("Performance.enable")
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.setSamplingInterval", {interval: 100}) // 100μs sampling

    // Start CPU profiling
    await cdp.send("Profiler.start")

    // Navigate and interact
    await page.goto("/", {waitUntil: "domcontentloaded"})

    // Wait for content
    await page.waitForTimeout(3000)

    // Scroll interaction
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const scrollable =
          document.querySelector("[data-scrollable]") || document.documentElement
        if (scrollable && "scrollBy" in scrollable) {
          ;(scrollable as HTMLElement).scrollBy({top: 300, behavior: "smooth"})
        }
      })
      await page.waitForTimeout(500)
    }

    // Stop profiling
    const {profile} = await cdp.send("Profiler.stop")

    // Analyze profile
    const functionStats = new Map<
      string,
      {selfTime: number; hitCount: number; url: string; line: number}
    >()

    const nodes = profile.nodes || []
    const samples = profile.samples || []
    const timeDeltas = profile.timeDeltas || []

    const nodeMap = new Map<number, (typeof nodes)[0]>()
    nodes.forEach((node: (typeof nodes)[0]) => nodeMap.set(node.id, node))

    samples.forEach((nodeId: number, index: number) => {
      const node = nodeMap.get(nodeId)
      if (!node?.callFrame) return

      const {functionName, url, lineNumber} = node.callFrame
      const delta = timeDeltas[index] || 0

      // Skip idle and native
      if (functionName === "(idle)" || functionName === "(program)") return
      if (!url || url.startsWith("native")) return

      const key = `${functionName}@${url}:${lineNumber}`
      const existing = functionStats.get(key) || {
        selfTime: 0,
        hitCount: 0,
        url,
        line: lineNumber,
      }
      existing.selfTime += delta
      existing.hitCount++
      functionStats.set(key, existing)
    })

    // Sort and output
    const sortedFunctions = Array.from(functionStats.entries())
      .sort(([, a], [, b]) => b.selfTime - a.selfTime)
      .slice(0, 30)

    console.log("\n=== DETAILED CPU PROFILE (Top 30 Functions) ===")
    console.log(
      "Function                                      | Self Time | Hits  | Location"
    )
    console.log("-".repeat(100))

    sortedFunctions.forEach(([key, stats]) => {
      const funcName = key.split("@")[0].substring(0, 40).padEnd(42)
      const time = `${(stats.selfTime / 1000).toFixed(2)}ms`.padStart(9)
      const hits = `${stats.hitCount}`.padStart(5)
      const shortUrl = stats.url.split("/").slice(-2).join("/")
      console.log(`${funcName} | ${time} | ${hits} | ${shortUrl}:${stats.line}`)
    })

    // Save detailed profile
    const profilePath = path.join(OUTPUT_DIR, "cpu-profile-detailed.json")
    fs.writeFileSync(
      profilePath,
      JSON.stringify(
        {
          functions: sortedFunctions.map(([key, stats]) => ({
            name: key.split("@")[0],
            selfTimeMs: stats.selfTime / 1000,
            hitCount: stats.hitCount,
            url: stats.url,
            line: stats.line,
          })),
          totalSamples: samples.length,
          profileDuration: timeDeltas.reduce((a: number, b: number) => a + b, 0) / 1000,
        },
        null,
        2
      )
    )
    console.log(`\nDetailed profile saved to ${profilePath}`)

    expect(sortedFunctions.length).toBeGreaterThan(0)
  })

  test("Profile app initialization and React rendering", async ({page}) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.setSamplingInterval", {interval: 100})

    // Start profiling BEFORE navigation to capture initialization
    await cdp.send("Profiler.start")

    // Navigate
    await page.goto("/", {waitUntil: "load"})

    // Wait for React to render and app to initialize
    await page.waitForTimeout(5000)

    // Interact with the app to trigger more code paths
    try {
      // Click sign up button if visible
      const signUpBtn = page.locator(".signup-btn").first()
      if (await signUpBtn.isVisible({timeout: 2000})) {
        await signUpBtn.click()
        await page.waitForTimeout(1000)
        // Close dialog
        await page.keyboard.press("Escape")
        await page.waitForTimeout(500)
      }
    } catch {
      // Continue even if elements not found
    }

    // More scrolling interactions
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 200))
      await page.waitForTimeout(200)
    }

    // Stop profiling
    const {profile} = await cdp.send("Profiler.stop")

    // Process profile more thoroughly - include src files
    const functionStats = new Map<
      string,
      {selfTime: number; hitCount: number; url: string; line: number}
    >()

    const nodes = profile.nodes || []
    const samples = profile.samples || []
    const timeDeltas = profile.timeDeltas || []

    const nodeMap = new Map<number, (typeof nodes)[0]>()
    nodes.forEach((node: (typeof nodes)[0]) => nodeMap.set(node.id, node))

    samples.forEach((nodeId: number, index: number) => {
      const node = nodeMap.get(nodeId)
      if (!node?.callFrame) return

      const {functionName, url, lineNumber} = node.callFrame
      const delta = timeDeltas[index] || 0

      if (functionName === "(idle)" || functionName === "(program)") return
      if (!url) return

      const key = `${functionName || "(anonymous)"}@${url}:${lineNumber}`
      const existing = functionStats.get(key) || {
        selfTime: 0,
        hitCount: 0,
        url,
        line: lineNumber,
      }
      existing.selfTime += delta
      existing.hitCount++
      functionStats.set(key, existing)
    })

    // Sort by self time
    const allFunctions = Array.from(functionStats.entries()).sort(
      ([, a], [, b]) => b.selfTime - a.selfTime
    )

    // Filter to application code (Vite dev server URLs contain the file path)
    const appFunctions = allFunctions.filter(
      ([, stats]) =>
        (stats.url.includes("/src/") ||
          stats.url.includes(".tsx") ||
          stats.url.includes(".ts")) &&
        !stats.url.includes("node_modules") &&
        !stats.url.includes("@vite") &&
        !stats.url.includes("@react-refresh")
    )

    console.log("\n=== APPLICATION CODE CPU HOTSPOTS (Top 30) ===")
    console.log(
      "Function                                      | Self Time | Hits  | Location"
    )
    console.log("-".repeat(100))

    appFunctions.slice(0, 30).forEach(([key, stats]) => {
      const funcName = key.split("@")[0].substring(0, 40).padEnd(42)
      const time = `${(stats.selfTime / 1000).toFixed(2)}ms`.padStart(9)
      const hits = `${stats.hitCount}`.padStart(5)
      const shortUrl =
        stats.url.split("/src/")[1] || stats.url.split("/").slice(-2).join("/")
      console.log(`${funcName} | ${time} | ${hits} | ${shortUrl}:${stats.line}`)
    })

    // Also show top React/library functions
    const reactFunctions = allFunctions.filter(
      ([, stats]) =>
        stats.url.includes("node_modules/react") ||
        stats.url.includes("node_modules/zustand") ||
        stats.url.includes("node_modules/@nostr")
    )

    if (reactFunctions.length > 0) {
      console.log("\n=== LIBRARY CPU HOTSPOTS (Top 15) ===")
      reactFunctions.slice(0, 15).forEach(([key, stats]) => {
        const funcName = key.split("@")[0].substring(0, 40).padEnd(42)
        const time = `${(stats.selfTime / 1000).toFixed(2)}ms`.padStart(9)
        const shortUrl =
          stats.url.split("node_modules/")[1]?.split("/").slice(0, 2).join("/") ||
          "unknown"
        console.log(`${funcName} | ${time} | ${shortUrl}`)
      })
    }

    // Save detailed app profile
    const appProfilePath = path.join(OUTPUT_DIR, "app-cpu-profile.json")
    fs.writeFileSync(
      appProfilePath,
      JSON.stringify(
        {
          appFunctions: appFunctions.slice(0, 100).map(([key, stats]) => ({
            name: key.split("@")[0],
            selfTimeMs: stats.selfTime / 1000,
            hitCount: stats.hitCount,
            url: stats.url,
            line: stats.line,
          })),
          reactFunctions: reactFunctions.slice(0, 50).map(([key, stats]) => ({
            name: key.split("@")[0],
            selfTimeMs: stats.selfTime / 1000,
            hitCount: stats.hitCount,
            url: stats.url,
            line: stats.line,
          })),
          totalSamples: samples.length,
          profileDuration: timeDeltas.reduce((a: number, b: number) => a + b, 0) / 1000,
        },
        null,
        2
      )
    )
    console.log(`\nApp profile saved to ${appProfilePath}`)

    // Debug: show all URLs captured
    console.log("\n=== ALL CAPTURED URLs (sample) ===")
    const uniqueUrls = [...new Set(allFunctions.map(([, s]) => s.url))]
    uniqueUrls.slice(0, 20).forEach((url) => console.log(url))

    // Test passes as long as we got some profile data
    expect(allFunctions.length).toBeGreaterThan(0)
  })
})
