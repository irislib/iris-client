import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

test.use({serviceWorkers: "block"})

test("a slow initial feed read stays open and never reports an empty feed", async ({
  page,
}, testInfo) => {
  const viewer = generateSecretKey()
  const followed = generateSecretKey()
  const author = getPublicKey(followed)
  const created_at = Math.floor(Date.now() / 1000) - 60
  const note = finalizeEvent(
    {kind: 1, content: "A slow cached post still arrives", tags: [], created_at},
    followed
  )
  const relay = await startNostrRelay({
    port: 0,
    initialEvents: [
      finalizeEvent({kind: 3, content: "", tags: [["p", author]], created_at}, viewer),
      note,
    ],
  })
  try {
    await page.addInitScript(
      ({port, author, noteId}) => {
        window.__HTREE_SERVER_URL__ = `http://127.0.0.1:${port}`
        const state = {requests: 0, received: 0, release: () => {}}
        Object.assign(window, {__feedStartupTest: state})
        const NativeWorker = window.Worker
        window.Worker = class extends NativeWorker {
          constructor(
            url: string | URL,
            options?: ConstructorParameters<typeof Worker>[1]
          ) {
            super(url, options)
            if (!String(url).includes("relay-worker")) return
            const pending: MessageEvent[] = []
            let released = false
            this.addEventListener("message", (message) => {
              if (
                !released &&
                message.data.type === "event" &&
                message.data.event?.id === noteId
              ) {
                message.stopImmediatePropagation()
                pending.push(message)
                state.received++
              }
            })
            state.release = () => {
              released = true
              for (const message of pending)
                this.dispatchEvent(new MessageEvent("message", {data: message.data}))
            }
          }
          postMessage(...args: Parameters<Worker["postMessage"]>) {
            const [message] = args
            const data = message as {
              type?: string
              filters?: Array<{authors?: string[]; kinds?: number[]}>
            }
            if (
              data.type === "subscribe" &&
              data.filters?.some(
                (f) => f.authors?.includes(author) && f.kinds?.includes(1)
              )
            )
              state.requests++
            super.postMessage(...args)
          }
        }
      },
      {port: relay.port, author, noteId: note.id}
    )
    await signUp(page, nip19.npubEncode(getPublicKey(viewer)))
    await expect
      .poll(() => page.evaluate(() => (window as any).__feedStartupTest.received))
      .toBeGreaterThan(0)
    // Hold a real worker response beyond the old five-second cancellation timer.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 6000)))
    await expect(page.getByText("No posts found for you", {exact: true})).toBeHidden()
    expect(await page.evaluate(() => (window as any).__feedStartupTest.requests)).toBe(1)
    await page.evaluate(() => (window as any).__feedStartupTest.release())
    await expect(
      page.getByTestId("feed-item").filter({hasText: note.content}).first()
    ).toBeVisible({timeout: 3000})
    await page.screenshot({path: testInfo.outputPath("slow-feed-recovered.png")})
  } finally {
    await relay.close()
  }
})
