import {expect, test} from "./fixtures/isolatedBrowser"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"
import type {WorkerMessage, WorkerResponse} from "../src/lib/nostr-transport-types"

test("registered chats stay quiet while idle and after navigation", async ({
  page,
}, testInfo) => {
  test.skip(
    usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true",
    "requires an isolated relay"
  )
  test.setTimeout(60000)
  await page.addInitScript(() => {
    const activity = {subscriptions: 0, publications: 0, receivedEvents: 0, bytes: 0}
    Object.assign(window, {__chatIdleActivity: activity})
    const privateKinds = new Set([37368, 30078, 1059, 1060])
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args)
        this.addEventListener("message", ({data}: MessageEvent<WorkerResponse>) => {
          const event = data.event as {kind?: number} | undefined
          if (data.type === "event" && privateKinds.has(event?.kind ?? -1)) {
            activity.receivedEvents++
            activity.bytes += JSON.stringify(data).length
          }
        })
      }

      postMessage(...args: Parameters<Worker["postMessage"]>) {
        const message = args[0] as WorkerMessage
        if (
          message?.type === "subscribe" &&
          message.filters?.some((filter) =>
            filter.kinds?.some((kind) => privateKinds.has(kind))
          )
        ) {
          activity.subscriptions++
          activity.bytes += JSON.stringify(message).length
        }
        const event = message?.event as {kind?: number} | undefined
        if (message?.type === "publish" && privateKinds.has(event?.kind ?? -1)) {
          activity.publications++
          activity.bytes += JSON.stringify(message).length
        }
        super.postMessage(...args)
      }
    }
  })

  await signUp(page)
  await page.getByRole("link", {name: "Chats", exact: true}).click()
  await page.getByRole("button", {name: "Register this device", exact: true}).click()
  await expect(page.getByRole("link", {name: "New Chat", exact: true})).toBeVisible({
    timeout: 30000,
  })
  const activity = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            __chatIdleActivity: {
              subscriptions: number
              publications: number
              receivedEvents: number
              bytes: number
            }
          }
        ).__chatIdleActivity
    )

  // Let the one-time registration and invite exchange settle before measuring.
  await expect.poll(async () => (await activity()).publications).toBeGreaterThan(0)
  // Use the same warm-up and observation windows for before/after comparisons.
  // Registration is ready above; this lets its one-time relay exchange finish.
  await page.waitForTimeout(5000)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const before = await cdp.send("Performance.getMetrics")
  const baseline = await activity()
  expect(baseline.subscriptions).toBeGreaterThan(0)
  // A fixed observation window is intentional: no user/network work is pending.
  await page.waitForTimeout(10000)
  const after = await cdp.send("Performance.getMetrics")
  const idle = await activity()
  const metric = (snapshot: typeof before, name: string) =>
    snapshot.metrics.find((entry) => entry.name === name)?.value ?? 0
  const mainThreadTaskSeconds =
    metric(after, "TaskDuration") - metric(before, "TaskDuration")
  const elapsedSeconds = metric(after, "Timestamp") - metric(before, "Timestamp")
  const idleMetrics = {
    elapsedSeconds,
    mainThreadTaskSeconds,
    mainThreadBusyPercent: (100 * mainThreadTaskSeconds) / elapsedSeconds,
    subscriptions: idle.subscriptions - baseline.subscriptions,
    publications: idle.publications - baseline.publications,
    receivedEvents: idle.receivedEvents - baseline.receivedEvents,
    workerMessageBytes: idle.bytes - baseline.bytes,
  }
  await testInfo.attach("chat-idle-metrics", {
    body: JSON.stringify(idleMetrics, null, 2),
    contentType: "application/json",
  })
  console.log(`Chat idle metrics: ${JSON.stringify(idleMetrics)}`)
  expect(idleMetrics.subscriptions).toBe(0)
  expect(idleMetrics.publications).toBe(0)
  expect(idleMetrics.receivedEvents).toBe(0)
  expect(idleMetrics.workerMessageBytes).toBe(0)
  expect(mainThreadTaskSeconds).toBeLessThan(elapsedSeconds * 0.1)

  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole("link", {name: "About", exact: true}).click()
    await page.getByRole("link", {name: "Chats", exact: true}).click()
    await expect(page.getByRole("link", {name: "New Chat", exact: true})).toBeVisible()
  }
  expect((await activity()).subscriptions).toBe(idle.subscriptions)
  await cdp.detach()
})
