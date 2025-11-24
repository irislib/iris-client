import {execSync} from "child_process"
import path from "path"
import fs from "fs"

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

interface PerformanceResult {
  renderTimeMs?: number
  avgFrameTime?: number
  maxFrameTime?: number
  droppedFrames?: number
  usedHeapMB?: number
  growthMB?: number
  nodeCount?: number
}

function getLatestResults(): Map<string, PerformanceResult> {
  const resultsDir = path.join(process.cwd(), "performance-results")
  if (!fs.existsSync(resultsDir)) {
    return new Map()
  }

  const files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json"))
  const results = new Map<string, PerformanceResult>()

  // Group files by test name and get the latest for each
  const byTestName = new Map<string, string[]>()
  for (const file of files) {
    const testName = file.replace(/-\d{4}-\d{2}-\d{2}.*\.json$/, "")
    if (!byTestName.has(testName)) {
      byTestName.set(testName, [])
    }
    byTestName.get(testName)!.push(file)
  }

  // Get latest result for each test
  for (const [testName, testFiles] of byTestName) {
    testFiles.sort().reverse()
    const latestFile = testFiles[0]
    const content = fs.readFileSync(path.join(resultsDir, latestFile), "utf-8")
    results.set(testName, JSON.parse(content))
  }

  return results
}

function updateBaselines(dryRun = false) {
  const results = getLatestResults()

  if (results.size === 0) {
    console.log("No performance results found. Run performance tests first:")
    console.log("  yarn test:performance")
    process.exit(1)
  }

  const baselinePath = path.join(process.cwd(), "performance-baselines.json")
  const currentBaselines: PerformanceBaselines = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, "utf-8"))
    : {}

  // Build new baselines from results with 20% headroom
  const headroom = 1.2
  const newBaselines: PerformanceBaselines = {...currentBaselines}

  const feedRender = results.get("feed-render-first")
  if (feedRender?.renderTimeMs) {
    newBaselines.feedRenderTimeMs = Math.ceil(feedRender.renderTimeMs * headroom)
  }

  const feedRender10 = results.get("feed-render-10")
  if (feedRender10?.renderTimeMs) {
    newBaselines.feedRenderTime10ItemsMs = Math.ceil(feedRender10.renderTimeMs * headroom)
  }

  const scroll = results.get("scroll-performance")
  if (scroll) {
    if (scroll.avgFrameTime) {
      newBaselines.scrollAvgFrameTimeMs = Math.ceil(scroll.avgFrameTime * headroom)
    }
    if (scroll.maxFrameTime) {
      newBaselines.scrollMaxFrameTimeMs = Math.ceil(scroll.maxFrameTime * headroom)
    }
    if (scroll.droppedFrames !== undefined) {
      newBaselines.scrollDroppedFramesMax = Math.ceil(scroll.droppedFrames * headroom)
    }
  }

  const memory = results.get("memory-usage")
  if (memory?.usedHeapMB) {
    newBaselines.memoryUsageMaxMB = Math.ceil(memory.usedHeapMB * headroom)
  }

  const memoryGrowth = results.get("memory-growth")
  if (memoryGrowth?.growthMB) {
    newBaselines.memoryGrowthMaxMB = Math.ceil(
      Math.max(memoryGrowth.growthMB * headroom, 10)
    )
  }

  const domNodes = results.get("dom-nodes")
  if (domNodes?.nodeCount) {
    newBaselines.domNodeMaxCount = Math.ceil(domNodes.nodeCount * headroom)
  }

  console.log("\nCurrent baselines:")
  console.log(JSON.stringify(currentBaselines, null, 2))

  console.log("\nProposed baselines (with 20% headroom):")
  console.log(JSON.stringify(newBaselines, null, 2))

  if (dryRun) {
    console.log("\nDry run - no changes made")
  } else {
    fs.writeFileSync(baselinePath, JSON.stringify(newBaselines, null, 2) + "\n")

    const commit = execSync("git rev-parse --short HEAD", {encoding: "utf-8"}).trim()
    console.log(`\nBaselines updated at commit ${commit}`)
    console.log("Review changes and commit if appropriate:")
    console.log("  git diff performance-baselines.json")
  }
}

// CLI
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")

if (args.includes("--help")) {
  console.log(`
Usage: yarn performance:baseline [options]

Updates performance-baselines.json based on latest test results.

Options:
  --dry-run    Show proposed changes without writing
  --help       Show this help

Workflow:
  1. Run performance tests: yarn test:performance
  2. Review results in performance-results/
  3. Update baselines: yarn performance:baseline
  4. Commit: git add performance-baselines.json && git commit
`)
  process.exit(0)
}

updateBaselines(dryRun)
