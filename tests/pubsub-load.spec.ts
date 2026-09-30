import {expect, test} from "@playwright/test"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(usingBuiltDist, "the worker harness imports app modules from the source server")

test("worker batches 500 concurrent interests and releases them without blocking the app", async ({
  page,
}, testInfo) => {
  const requests: unknown[][] = []
  page.on("websocket", (socket) => {
    if (!socket.url().startsWith("ws://127.0.0.1:7777")) return
    socket.on("framesent", (frame) => {
      try {
        const message = JSON.parse(String(frame.payload))
        if (message[0] === "REQ") requests.push(message)
      } catch {
        // Only Nostr request frames contribute to this measurement.
      }
    })
  })
  await signUp(page, "Load test")
  const result = await page.evaluate(async () => {
    const {nostr, getWorkerTransport, initNostr} =
      await import("/src/utils/nostrClient.ts")
    const {CacheMode} = await import("/src/lib/nostr/index.ts")
    await initNostr()
    const baseline = (await getWorkerTransport()!.getStats()).pubsub!
    const started = performance.now()
    const interests = Array.from({length: 500}, (_, i) =>
      nostr().subscribe(
        {ids: ["f".repeat(60) + i.toString(16).padStart(4, "0")]},
        {cacheUsage: CacheMode.ONLY_RELAY}
      )
    )
    await Promise.all(
      interests.map((sub) => new Promise((resolve) => sub.once("eose", resolve)))
    )
    const elapsed = performance.now() - started
    const active = (await getWorkerTransport()!.getStats()).pubsub!
    for (const sub of interests) sub.stop()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const closed = (await getWorkerTransport()!.getStats()).pubsub!
    return {baseline, active, closed, elapsed}
  })
  expect(
    result.active.subscriptions - result.baseline.subscriptions
  ).toBeGreaterThanOrEqual(490)
  expect(
    result.active.relaySubscriptions - result.baseline.relaySubscriptions
  ).toBeLessThan(30)
  expect(result.closed.subscriptions).toBeLessThanOrEqual(
    result.baseline.subscriptions + 5
  )
  const loadRequests = requests.filter((request) =>
    request
      .slice(2)
      .some(
        (filter) =>
          Array.isArray((filter as {ids?: string[]}).ids) &&
          (filter as {ids: string[]}).ids.some((id) => id.startsWith("f".repeat(60)))
      )
  )
  expect(loadRequests.length).toBeLessThan(50)
  await expect(page.locator("#main-content").getByTestId("new-post-button")).toBeVisible()
  await testInfo.attach("pubsub-load-metrics", {
    body: JSON.stringify({...result, wireRequests: loadRequests.length}),
    contentType: "application/json",
  })
  console.log(
    "Pubsub load:",
    JSON.stringify({...result, wireRequests: loadRequests.length})
  )
})
