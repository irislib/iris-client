import {Profiler, ProfilerOnRenderCallback, ReactNode} from "react"

/**
 * React render profiling for performance testing.
 * Only active when VITE_PERF_PROFILING=true or in test mode.
 *
 * Usage in tests:
 *   const metrics = await page.evaluate(() => window.__REACT_PERF__.getMetrics())
 *   expect(metrics.Feed.renderCount).toBeLessThan(10)
 */

export interface RenderMetric {
  id: string
  phase: "mount" | "update" | "nested-update"
  actualDuration: number
  baseDuration: number
  startTime: number
  commitTime: number
}

export interface ComponentMetrics {
  renderCount: number
  totalActualDuration: number
  totalBaseDuration: number
  avgActualDuration: number
  avgBaseDuration: number
  maxActualDuration: number
  renders: RenderMetric[]
}

export interface PerfMetrics {
  [componentId: string]: ComponentMetrics
}

interface ReactPerfCollector {
  renders: RenderMetric[]
  getMetrics: () => PerfMetrics
  getComponentMetrics: (id: string) => ComponentMetrics | null
  clear: () => void
  isEnabled: () => boolean
}

// Check if profiling is enabled
const isProfilingEnabled = (): boolean => {
  if (typeof window === "undefined") return false
  // Enable in test mode or when explicitly enabled
  return (
    import.meta.env.VITE_PERF_PROFILING === "true" ||
    import.meta.env.VITE_USE_TEST_RELAY === "true" ||
    import.meta.env.VITE_USE_LOCAL_RELAY === "true" ||
    import.meta.env.MODE === "test"
  )
}

// Create the collector
function createPerfCollector(): ReactPerfCollector {
  const renders: RenderMetric[] = []

  const getMetrics = (): PerfMetrics => {
    const metrics: PerfMetrics = {}

    for (const render of renders) {
      if (!metrics[render.id]) {
        metrics[render.id] = {
          renderCount: 0,
          totalActualDuration: 0,
          totalBaseDuration: 0,
          avgActualDuration: 0,
          avgBaseDuration: 0,
          maxActualDuration: 0,
          renders: [],
        }
      }

      const m = metrics[render.id]
      m.renderCount++
      m.totalActualDuration += render.actualDuration
      m.totalBaseDuration += render.baseDuration
      m.maxActualDuration = Math.max(m.maxActualDuration, render.actualDuration)
      m.renders.push(render)
    }

    // Calculate averages
    for (const id of Object.keys(metrics)) {
      const m = metrics[id]
      m.avgActualDuration = m.totalActualDuration / m.renderCount
      m.avgBaseDuration = m.totalBaseDuration / m.renderCount
      // Round for readability
      m.avgActualDuration = Math.round(m.avgActualDuration * 100) / 100
      m.avgBaseDuration = Math.round(m.avgBaseDuration * 100) / 100
      m.totalActualDuration = Math.round(m.totalActualDuration * 100) / 100
      m.totalBaseDuration = Math.round(m.totalBaseDuration * 100) / 100
      m.maxActualDuration = Math.round(m.maxActualDuration * 100) / 100
    }

    return metrics
  }

  const getComponentMetrics = (id: string): ComponentMetrics | null => {
    const metrics = getMetrics()
    return metrics[id] || null
  }

  const clear = () => {
    renders.length = 0
  }

  return {
    renders,
    getMetrics,
    getComponentMetrics,
    clear,
    isEnabled: isProfilingEnabled,
  }
}

// Global collector instance
let collector: ReactPerfCollector | null = null

export function getReactPerfCollector(): ReactPerfCollector {
  if (!collector) {
    collector = createPerfCollector()
    // Expose to window for test access
    if (typeof window !== "undefined" && isProfilingEnabled()) {
      ;(window as unknown as {__REACT_PERF__: ReactPerfCollector}).__REACT_PERF__ =
        collector
    }
  }
  return collector
}

// Initialize on import if profiling is enabled
if (isProfilingEnabled()) {
  getReactPerfCollector()
}

/**
 * Profiler onRender callback that collects metrics
 */
export const onRenderCallback: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime
) => {
  if (!isProfilingEnabled()) return

  const collector = getReactPerfCollector()
  collector.renders.push({
    id,
    phase: phase as RenderMetric["phase"],
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  })
}

/**
 * Props for PerfProfiler component
 */
interface PerfProfilerProps {
  id: string
  children: ReactNode
}

/**
 * Conditional profiler wrapper - only profiles when enabled
 *
 * Usage:
 *   <PerfProfiler id="Feed">
 *     <Feed {...props} />
 *   </PerfProfiler>
 */
export function PerfProfiler({id, children}: PerfProfilerProps): ReactNode {
  if (!isProfilingEnabled()) {
    return children
  }

  return (
    <Profiler id={id} onRender={onRenderCallback}>
      {children}
    </Profiler>
  )
}

// Type declaration for window
declare global {
  interface Window {
    __REACT_PERF__?: ReactPerfCollector
  }
}
