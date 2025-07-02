import { Page } from '@playwright/test'

export interface PerformanceMetrics {
  renderTime: number
  scrollPerformance: number
  componentRenderCount: number
  memoryUsage: number
}

export async function measureFeedRenderTime(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      const startTime = performance.now()
      
      const checkForFeedItems = () => {
        const feedItems = document.querySelectorAll('[data-testid="feed-item"]')
        if (feedItems.length > 0) {
          resolve(performance.now() - startTime)
        } else {
          setTimeout(checkForFeedItems, 100)
        }
      }
      
      checkForFeedItems()
      
      setTimeout(() => {
        resolve(performance.now() - startTime)
      }, 10000)
    })
  })
}

export async function measureScrollPerformance(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      const startTime = performance.now()
      let frameCount = 0
      
      const measureFrame = () => {
        frameCount++
        if (frameCount < 60) {
          requestAnimationFrame(measureFrame)
        } else {
          const endTime = performance.now()
          const avgFrameTime = (endTime - startTime) / frameCount
          resolve(avgFrameTime)
        }
      }
      
      window.scrollBy(0, 100)
      requestAnimationFrame(measureFrame)
    })
  })
}

export async function getMemoryUsage(page: Page): Promise<number> {
  return await page.evaluate(() => {
    if ('memory' in performance && performance.memory) {
      const memory = performance.memory as any
      return Math.round(memory.usedJSHeapSize / 1024 / 1024)
    }
    return 0
  })
}
