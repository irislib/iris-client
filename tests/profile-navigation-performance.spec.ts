import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test("profile navigation performance", async ({page}) => {
  const username = "Performance Test User"
  await signUp(page, username)
  
  await page.goto('/')
  
  const profileUrl = await page
    .locator('a[href*="/npub"]')
    .first()
    .getAttribute("href")
  
  if (!profileUrl) {
    throw new Error("Could not find user's profile link")
  }
  
  const navigationStart = Date.now()
  
  await page.goto(profileUrl)
  
  await expect(page.getByTestId('profile-header-actions')).toBeVisible()
  const navigationComplete = Date.now()
  
  await expect(page.getByRole('banner').getByText(username, {exact: true})).toBeVisible()
  const profileDataLoaded = Date.now()
  
  await expect(page.locator('img[alt="User Avatar"], img[alt=""]').first()).toBeVisible()
  const avatarLoaded = Date.now()
  
  await expect(page.locator('[data-testid="profile-header-actions"]')).toBeVisible()
  const profileComplete = Date.now()
  
  const performanceMetrics = {
    'total-navigation': navigationComplete - navigationStart,
    'profile-data-fetch': profileDataLoaded - navigationComplete,
    'avatar-loading': avatarLoaded - profileDataLoaded,
    'full-profile-load': profileComplete - navigationStart
  }
  
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
  
  const existingProfileStart = Date.now()
  
  await page.goto(`/${publicKey}`)
  
  await expect(page.locator('[data-testid="profile-header-actions"]')).toBeVisible()
  
  const existingProfileComplete = Date.now()
  
  const performanceMetrics = {
    'existing-profile-load': existingProfileComplete - existingProfileStart
  }
  
  console.log('Existing Profile Navigation Performance:')
  console.log(`Load Time: ${performanceMetrics['existing-profile-load']?.toFixed(2)}ms`)
  
  expect(performanceMetrics['existing-profile-load']).toBeLessThan(3000)
})
