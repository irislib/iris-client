import {expect} from "@playwright/test"

async function signUp(page, username = "Test User") {
  // Start from the home page
  await page.goto("/")

  // Wait for any signup button to be visible and click it
  const signUpButtons = page.locator(".signup-btn")
  const visibleButton = signUpButtons.filter({hasText: "Sign up"}).first()
  await visibleButton.waitFor({state: "visible", timeout: 10000})
  await visibleButton.click()

  // Wait for the signup dialog to appear
  await expect(page.getByRole("heading", {name: "Sign up"})).toBeVisible()

  // Enter a name/key (supports npub, nsec, or name)
  const nameInput = page.getByPlaceholder("What's your name?")
  await nameInput.fill(username)

  // Wait for auto-login if it's a key, otherwise click Go
  // If it's a key, the dialog should close automatically after some delay
  const isKey = username.startsWith("npub") || username.startsWith("nsec")

  if (!isKey) {
    // Click the Go button for new accounts
    const goButton = page.getByRole("button", {name: "Go"})
    await goButton.click()
  } else {
    // For keys, wait a bit for auto-login to trigger
    await page.waitForTimeout(1000)
  }

  // Wait for signup to complete
  await expect(page.getByRole("heading", {name: "Sign up"})).not.toBeVisible({
    timeout: 10000,
  })

  // For npub logins, just wait for the main content to load
  if (isKey) {
    await page.waitForLoadState("networkidle")
    // Just check that we have main content loaded
    await expect(page.locator("#main-content")).toBeVisible({timeout: 10000})
  } else {
    await expect(
      page.locator("#main-content").getByTestId("new-post-button")
    ).toBeVisible({
      timeout: 10000,
    })
  }

  // Get the private key or public key from store
  const storeData = await page.evaluate(() => {
    const userStore = localStorage.getItem("user-storage")
    if (!userStore) return null
    const parsed = JSON.parse(userStore)
    return {
      privateKey: parsed?.state?.privateKey || null,
      publicKey: parsed?.state?.publicKey || null,
    }
  })

  return {username, ...storeData}
}

async function signIn(page, privateKey: string) {
  await page.goto("/")

  // Click "Sign up" button to open dialog
  await page.getByRole("button", {name: "Sign up"}).click()

  // Wait for signup dialog to appear
  await expect(page.getByRole("heading", {name: "Sign up"})).toBeVisible()

  // Click "Already have an account?" to switch to sign in
  await page.getByText("Already have an account?").click()

  // Wait for sign in dialog
  await expect(page.getByRole("heading", {name: "Sign in"})).toBeVisible({timeout: 10000})

  // Paste the private key - should auto-login
  const keyInput = page.getByPlaceholder(/paste.*key/i)
  await keyInput.fill(privateKey)

  // Wait for sign in to complete (dialog closes automatically)
  await expect(page.getByRole("heading", {name: "Sign in"})).not.toBeVisible({
    timeout: 10000,
  })
  await expect(page.locator("#main-content").getByTestId("new-post-button")).toBeVisible({
    timeout: 10000,
  })
}

export {signUp, signIn}
