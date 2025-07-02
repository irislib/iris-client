import { test, expect } from '@playwright/test'
import { measureFeedRenderTime, measureScrollPerformance, getMemoryUsage } from './utils/performance.js'

test.describe('Feed Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('feed renders within acceptable time', async ({ page }) => {
    const renderTime = await measureFeedRenderTime(page)
    
    console.log(`Feed render time: ${renderTime}ms`)
    
    expect(renderTime).toBeLessThan(6000)
  })

  test('scroll performance is smooth', async ({ page }) => {
    await page.waitForSelector('[data-testid="feed-item"]', { timeout: 10000 })
    
    const avgFrameTime = await measureScrollPerformance(page)
    
    console.log(`Average frame time during scroll: ${avgFrameTime}ms`)
    
    expect(avgFrameTime).toBeLessThan(33.33)
  })

  test('memory usage stays reasonable', async ({ page }) => {
    const initialMemory = await getMemoryUsage(page)
    
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 500)
      await page.waitForTimeout(100)
    }
    
    const finalMemory = await getMemoryUsage(page)
    const memoryIncrease = finalMemory - initialMemory
    
    console.log(`Memory usage: ${initialMemory}MB -> ${finalMemory}MB (+${memoryIncrease}MB)`)
    
    expect(memoryIncrease).toBeLessThan(50)
  })

  test('note rendering with embeds performs well', async ({ page }) => {
    await page.waitForSelector('img, video, iframe', { timeout: 5000 })
    
    const startTime = await page.evaluate(() => performance.now())
    
    await page.mouse.wheel(0, 1000)
    await page.waitForTimeout(500)
    
    const endTime = await page.evaluate(() => performance.now())
    const renderTime = endTime - startTime
    
    console.log(`Note with embeds render time: ${renderTime}ms`)
    
    expect(renderTime).toBeLessThan(1000)
  })

  test('HyperText expand/collapse performance', async ({ page }) => {
    const showMoreLink = page.locator('a:has-text("show more")').first()
    
    if (await showMoreLink.count() > 0) {
      const startTime = await page.evaluate(() => performance.now())
      
      await showMoreLink.click()
      await page.waitForSelector('a:has-text("show less")')
      
      const endTime = await page.evaluate(() => performance.now())
      const expandTime = endTime - startTime
      
      console.log(`HyperText expand time: ${expandTime}ms`)
      
      expect(expandTime).toBeLessThan(100)
    }
  })
})
