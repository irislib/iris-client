import {expect, test, type Page} from "@playwright/test"
import {signUp} from "./auth.setup"
import {expectPersistedDraft} from "./utils/drafts"

test.use({serviceWorkers: "block"})

async function sessionStorageFingerprints(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("iris-session-manager")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("session-private")) {
            db.close()
            resolve([])
            return
          }
          const transaction = db.transaction("session-private", "readonly")
          const records = transaction.objectStore("session-private").getAll()
          records.onerror = () => reject(records.error)
          records.onsuccess = () => {
            Promise.all(
              records.result.map(async (record) => {
                const bytes = new TextEncoder().encode(JSON.stringify(record))
                const digest = await crypto.subtle.digest("SHA-256", bytes)
                return Array.from(new Uint8Array(digest), (byte) =>
                  byte.toString(16).padStart(2, "0")
                ).join("")
              })
            ).then(resolve, reject)
          }
          transaction.oncomplete = () => db.close()
        }
      })
  )
}

test("logout without a service worker is fast and clears private data", async ({
  page,
}, testInfo) => {
  await signUp(page, "Logout Test")
  await expect.poll(() => sessionStorageFingerprints(page)).not.toEqual([])

  const draft = "Private draft to erase on logout"
  await page.locator("#main-content").getByTestId("new-post-button").click()
  await page.getByRole("dialog").getByPlaceholder("What's on your mind?").fill(draft)
  await page.keyboard.press("Escape")
  await expectPersistedDraft(page, draft)

  await page.goto("/settings/logout")
  expect(
    await page.evaluate(() => navigator.serviceWorker.getRegistration())
  ).toBeUndefined()
  const logout = page.getByRole("button", {name: "Log out", exact: true})
  await expect(logout).toBeVisible()
  const previousSessions = await sessionStorageFingerprints(page)
  await page.screenshot({path: testInfo.outputPath("before-logout.png")})

  page.once("dialog", (dialog) => dialog.accept())
  const startedAt = Date.now()
  await Promise.all([
    page.waitForEvent("request", (request) => request.isNavigationRequest()),
    logout.click(),
  ])
  const elapsedMs = Date.now() - startedAt

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId("sidebar-user-row")).toBeHidden()
  await expect(
    page.getByRole("button", {name: "Sign up", exact: true}).first()
  ).toBeVisible()
  expect(
    await page.evaluate(() => {
      const user = JSON.parse(localStorage.getItem("user-storage") || "{}").state
      return Boolean(
        user?.publicKey || user?.privateKey || user?.nip07Login || user?.linkedDevice
      )
    })
  ).toBe(false)
  await expectPersistedDraft(page, draft, false)
  // Startup may create a fresh anonymous device after the reload. None of the
  // signed-in account's session records should survive.
  const remainingSessions = await sessionStorageFingerprints(page)
  expect(remainingSessions.filter((record) => previousSessions.includes(record))).toEqual(
    []
  )
  await page.screenshot({path: testInfo.outputPath("after-logout.png")})
  await testInfo.attach("logout-duration", {
    body: `${elapsedMs} ms`,
    contentType: "text/plain",
  })
  expect(
    elapsedMs,
    "logout should not wait for an unregistered service worker"
  ).toBeLessThan(3000)
})

test("logout still removes browser push when the notification server fails", async ({
  page,
}) => {
  await signUp(page, "Push Logout Test")
  await page.goto("/settings/logout")
  const logout = page.getByRole("button", {name: "Log out", exact: true})
  await expect(logout).toBeVisible()

  let subscriptionRequests = 0
  await page.route("**/subscriptions/", async (route) => {
    subscriptionRequests++
    await route.abort("failed")
  })
  // Browser push services are external; substitute just the browser boundary
  // while exercising the real authenticated request and logout cleanup.
  await page.evaluate(() => {
    const subscription = {
      endpoint: "https://push.example/logout-test",
      unsubscribe: async () => {
        sessionStorage.setItem("logout-push-unsubscribed", "true")
        return true
      },
    }
    const registration = {
      pushManager: {
        getSubscription: async () =>
          sessionStorage.getItem("logout-push-unsubscribed") ? null : subscription,
      },
    }
    Object.defineProperty(navigator.serviceWorker, "ready", {
      value: Promise.resolve(registration),
    })
    Object.defineProperty(navigator.serviceWorker, "getRegistration", {
      value: async () => registration,
    })
  })

  page.once("dialog", (dialog) => dialog.accept())
  await logout.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("button", {name: "Sign up", exact: true}).first()
  ).toBeVisible()
  expect(subscriptionRequests).toBeGreaterThan(0)
  expect(
    await page.evaluate(() => sessionStorage.getItem("logout-push-unsubscribed"))
  ).toBe("true")
})
