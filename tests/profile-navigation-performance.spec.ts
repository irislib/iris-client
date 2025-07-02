import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("profile navigation performance", async ({page}) => {
  const username = "Performance Test User"
  await signUp(page, username)
  
  const currentUrl = page.url()
  const profileUrl = currentUrl.replace(/\/$/, '') + '/profile'
  
  await page.goto('/')
  
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
    performance.mark('navigation-start')
  })
  
  await page.goto(profileUrl)
  
  await expect(page.getByTestId('profile-header-actions')).toBeVisible()
  
  await page.evaluate(() => {
    performance.mark('navigation-complete')
  })
  
  await expect(page.getByText(username, {exact: true})).toBeVisible()
  
  await page.evaluate(() => {
    performance.mark('profile-data-loaded')
  })
  
  await expect(page.locator('img[alt="User Avatar"], img[alt=""]').first()).toBeVisible()
  
  await page.evaluate(() => {
    performance.mark('avatar-loaded')
  })
  
  await expect(page.locator('[data-testid="profile-header-actions"]')).toBeVisible()
  
  const performanceMetrics = await page.evaluate(() => {
    performance.mark('profile-complete')
    performance.measure('total-navigation', 'navigation-start', 'navigation-complete')
    performance.measure('profile-data-fetch', 'navigation-complete', 'profile-data-loaded')
    performance.measure('avatar-loading', 'profile-data-loaded', 'avatar-loaded')
    performance.measure('full-profile-load', 'navigation-start', 'profile-complete')
    
    const entries = performance.getEntriesByType('measure')
    const metrics = {}
    entries.forEach(entry => {
      metrics[entry.name] = entry.duration
    })
    return metrics
  })
  
  console.log('Profile Navigation Performance Metrics:')
  console.log(`Total Navigation: ${performanceMetrics['total-navigation']?.toFixed(2)}ms`)
  console.log(`Profile Data Fetch: ${performanceMetrics['profile-data-fetch']?.toFixed(2)}ms`)
  console.log(`Avatar Loading: ${performanceMetrics['avatar-loading']?.toFixed(2)}ms`)
  console.log(`Full Profile Load: ${performanceMetrics['full-profile-load']?.toFixed(2)}ms`)
  
  expect(performanceMetrics['full-profile-load']).toBeLessThan(5000)
  expect(performanceMetrics['total-navigation']).toBeLessThan(2000)
})

test("profile navigation performance for existing user", async ({page}) => {
  const publicKey = "npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk"
  
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
    performance.mark('existing-profile-start')
  })
  
  await page.goto(`/${publicKey}`)
  
  await expect(page.locator('[data-testid="profile-header-actions"]')).toBeVisible()
  
  const performanceMetrics = await page.evaluate(() => {
    performance.mark('existing-profile-complete')
    performance.measure('existing-profile-load', 'existing-profile-start', 'existing-profile-complete')
    
    const entries = performance.getEntriesByType('measure')
    const metrics = {}
    entries.forEach(entry => {
      metrics[entry.name] = entry.duration
    })
    return metrics
  })
  
  console.log('Existing Profile Navigation Performance:')
  console.log(`Load Time: ${performanceMetrics['existing-profile-load']?.toFixed(2)}ms`)
  
  expect(performanceMetrics['existing-profile-load']).toBeLessThan(3000)
})
