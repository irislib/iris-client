/* global ServiceWorkerGlobalScope */
import {expect, test} from "@playwright/test"
import {INVITE_EVENT_KIND} from "nostr-double-ratchet"
import {generateProxyUrl} from "../src/shared/utils/imgproxy"
import {KIND_REACTION} from "../src/utils/constants"

test("background notifications show the app badge and preserve sender photos", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(
    !["1", "true"].includes(
      process.env.IRIS_E2E_BUILT_DIST || process.env.IRIS_E2E_BUILT || ""
    ),
    "requires the production service worker"
  )
  await page.goto("/manifest.json")
  const origin = new URL(baseURL!).origin
  const appIcon = new URL("/img/iris-192.png", origin).href
  const session = await context.newCDPSession(page)
  const registered = new Promise<string>((resolve) => {
    session.on("ServiceWorker.workerRegistrationUpdated", ({registrations}) => {
      const registration = registrations.find(
        (r) => r.scopeURL === origin + "/" && !r.isDeleted
      )
      if (registration) resolve(registration.registrationId)
    })
  })
  await session.send("ServiceWorker.enable")
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js")
    await navigator.serviceWorker.ready
  })
  const registrationId = await registered
  const worker = context.serviceWorkers()[0]
  // Capture the browser notification options at the OS boundary. Headless Chromium
  // can receive push events but cannot display native notifications on every platform.
  const shown = await worker.evaluateHandle(() => {
    const calls: {title: string; icon?: string; badge?: string}[] = []
    const {registration} = self as unknown as ServiceWorkerGlobalScope
    registration.showNotification = async (title, options) => {
      calls.push({title, icon: options?.icon, badge: options?.badge})
    }
    return calls
  })
  // The worker suppresses pushes while any Iris window is visible.
  await page.goto("about:blank")

  const photo = "https://example.com/sender.png"
  for (const [id, kind, title, icon, expectedIcon] of [
    ["1", INVITE_EVENT_KIND, "New message request", "", appIcon],
    [
      "2",
      KIND_REACTION,
      "Reaction",
      "https://iris.to/img/android-chrome-192x192.png",
      appIcon,
    ],
    [
      "3",
      KIND_REACTION,
      "Sender photo",
      photo,
      generateProxyUrl(photo, {width: 128, square: true}),
    ],
    ["4", KIND_REACTION, "No photo", "", appIcon],
  ] as const) {
    await session.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId,
      data: JSON.stringify({
        title,
        icon,
        event: {
          id: id.repeat(64),
          pubkey: "a".repeat(64),
          kind,
          created_at: 1,
          tags: [],
          content: "",
          sig: "0".repeat(128),
        },
      }),
    })
    await expect
      .poll(() => shown.evaluate((calls) => calls.at(-1)))
      .toEqual({
        title,
        icon: expectedIcon,
        badge: appIcon,
      })
  }
})
