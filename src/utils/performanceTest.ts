interface PerformanceMetrics {
  profileLoadTime: number
  subscriptionCount: number
  renderTime: number
  networkRequests: number
  timestamp: number
}

interface ComponentRenderCounts {
  [componentName: string]: number
}

class ProfilePerformanceTest {
  private metrics: PerformanceMetrics[] = []
  private startTime: number = 0
  private networkRequestCount: number = 0
  private originalFetch: typeof fetch
  private componentRenderCounts: ComponentRenderCounts = {}

  constructor() {
    this.originalFetch = window.fetch
    this.setupNetworkMonitoring()
  }

  private setupNetworkMonitoring() {
    window.fetch = async (...args) => {
      this.networkRequestCount++
      console.log(`[PERF] Network request #${this.networkRequestCount}:`, args[0])
      return this.originalFetch.apply(window, args)
    }
  }

  startProfileTest(profileId: string) {
    console.log(`[PERF] Starting profile performance test for: ${profileId}`)
    this.startTime = performance.now()
    this.networkRequestCount = 0

    performance.mark("profile-load-start")
  }

  endProfileTest(profileId: string) {
    const endTime = performance.now()
    const totalTime = endTime - this.startTime

    performance.mark("profile-load-end")
    performance.measure("profile-load-duration", "profile-load-start", "profile-load-end")

    const metrics: PerformanceMetrics = {
      profileLoadTime: totalTime,
      subscriptionCount: this.getActiveSubscriptionCount(),
      renderTime: this.getRenderTime(),
      networkRequests: this.networkRequestCount,
      timestamp: Date.now(),
    }

    this.metrics.push(metrics)

    console.log(`[PERF] Profile test completed for ${profileId}:`, {
      "Load Time (ms)": totalTime.toFixed(2),
      "Network Requests": this.networkRequestCount,
      "Active Subscriptions": metrics.subscriptionCount,
      "Render Time (ms)": metrics.renderTime.toFixed(2),
    })

    return metrics
  }

  private getActiveSubscriptionCount(): number {
    try {
      const ndk = (window as unknown as {ndk?: unknown}).ndk
      if (ndk && typeof ndk === "object" && ndk !== null) {
        const ndkObj = ndk as {
          pool?: {relays?: Map<string, {subscriptions?: Set<unknown>}>}
        }
        if (ndkObj.pool && ndkObj.pool.relays) {
          let totalSubs = 0
          for (const relay of ndkObj.pool.relays.values()) {
            if (relay.subscriptions) {
              totalSubs += relay.subscriptions.size
            }
          }
          return totalSubs
        }
      }
    } catch (e) {
      console.warn("[PERF] Could not access NDK subscription count:", e)
    }
    return 0
  }

  private getRenderTime(): number {
    const entries = performance.getEntriesByType("measure")
    const renderEntry = entries.find((entry) => entry.name === "profile-load-duration")
    return renderEntry ? renderEntry.duration : 0
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  getAverageMetrics(): Partial<PerformanceMetrics> {
    if (this.metrics.length === 0) return {}

    const totals = this.metrics.reduce(
      (acc, metric) => ({
        profileLoadTime: acc.profileLoadTime + metric.profileLoadTime,
        subscriptionCount: acc.subscriptionCount + metric.subscriptionCount,
        renderTime: acc.renderTime + metric.renderTime,
        networkRequests: acc.networkRequests + metric.networkRequests,
      }),
      {profileLoadTime: 0, subscriptionCount: 0, renderTime: 0, networkRequests: 0}
    )

    const count = this.metrics.length
    return {
      profileLoadTime: totals.profileLoadTime / count,
      subscriptionCount: totals.subscriptionCount / count,
      renderTime: totals.renderTime / count,
      networkRequests: totals.networkRequests / count,
    }
  }

  reset() {
    this.metrics = []
    performance.clearMarks()
    performance.clearMeasures()
  }

  trackComponentRender(componentName: string) {
    this.componentRenderCounts[componentName] =
      (this.componentRenderCounts[componentName] || 0) + 1
    console.log(
      `[PERF] ${componentName} rendered (count: ${this.componentRenderCounts[componentName]})`
    )
  }

  getComponentRenderCounts(): ComponentRenderCounts {
    return {...this.componentRenderCounts}
  }

  exportData() {
    return {
      metrics: this.getMetrics(),
      averageMetrics: this.getAverageMetrics(),
      componentRenderCounts: this.getComponentRenderCounts(),
      timestamp: Date.now(),
    }
  }

  cleanup() {
    window.fetch = this.originalFetch
  }
}

export const profilePerformanceTest = new ProfilePerformanceTest()

if (typeof window !== "undefined") {
  ;(
    window as unknown as {profilePerformanceTest?: ProfilePerformanceTest}
  ).profilePerformanceTest = profilePerformanceTest
}
