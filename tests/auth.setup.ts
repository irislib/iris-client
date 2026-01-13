import {expect} from "@playwright/test"

async function openLoginDialog(page) {
  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await expect(page.locator("#main-content")).toBeVisible({timeout: 10000})

  const signUpHeading = page.getByRole("heading", {name: "Sign up"})
  const signInHeading = page.getByRole("heading", {name: "Sign in"})

  if ((await signUpHeading.isVisible()) || (await signInHeading.isVisible())) {
    return
  }

  const signUpButton = page.locator("button:visible", {hasText: "Sign up"}).first()
  await expect(signUpButton).toBeVisible({timeout: 10000})
  await signUpButton.click()
  await expect(page.locator("dialog.modal")).toBeVisible({timeout: 10000})
}

async function ensureSignUpDialog(page) {
  const signUpHeading = page.getByRole("heading", {name: "Sign up"})
  if (await signUpHeading.isVisible()) {
    return
  }

  const signInHeading = page.getByRole("heading", {name: "Sign in"})
  if (await signInHeading.isVisible()) {
    const dialog = page.locator("dialog.modal")
    await dialog.getByRole("button", {name: "Sign up"}).click()
  }

  await expect(signUpHeading).toBeVisible({timeout: 10000})
}

async function ensureSignInDialog(page) {
  const signInHeading = page.getByRole("heading", {name: "Sign in"})
  if (await signInHeading.isVisible()) {
    return
  }

  const signUpHeading = page.getByRole("heading", {name: "Sign up"})
  if (await signUpHeading.isVisible()) {
    await page.getByText("Already have an account?").click()
  }

  await expect(signInHeading).toBeVisible({timeout: 10000})
}

async function signUp(page, username = "Test User") {
  await openLoginDialog(page)
  await ensureSignUpDialog(page)

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
  }
  // For keys, auto-login triggers automatically - dialog will close

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
  await openLoginDialog(page)
  await ensureSignInDialog(page)

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
