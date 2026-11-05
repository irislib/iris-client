import {expect, test} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {Relay} from "nostr-tools/relay"
import {startNostrRelay} from "../dev-relay/nostr-relay"
import {signUp} from "./auth.setup"

for (const width of [1280, 390]) {
  test(`people search keeps an exact stranger above a familiar partial name at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({width, height: 900})
    const relay = await startNostrRelay({port: 0})
    const viewer = generateSecretKey()
    const friend = generateSecretKey()
    const stranger = generateSecretKey()
    const profiles = [
      {key: friend, name: "Ben Friend"},
      {key: stranger, name: "Ben"},
    ]
    const hits = profiles.map(({key, name}) => ({
      item: {pubKey: getPublicKey(key), name},
      score: 0,
      source: "local",
    }))
    const client = await Relay.connect(relay.url)
    try {
      const created_at = Math.floor(Date.now() / 1000) - 10
      await client.publish(
        finalizeEvent(
          {kind: 3, created_at, content: "", tags: [["p", getPublicKey(friend)]]},
          viewer
        )
      )
      for (const {key, name} of profiles) {
        await client.publish(
          finalizeEvent(
            {kind: 0, created_at, content: JSON.stringify({name}), tags: []},
            key
          )
        )
      }
      await page.addInitScript(
        ({url, hits}) => {
          window.__HTREE_SERVER_URL__ = url
          // Fix candidate retrieval while exercising real graph loading, ranking,
          // worker replies, profile subscriptions and both search interfaces.
          const original = Worker.prototype.postMessage
          Worker.prototype.postMessage = function (message, ...args) {
            if (message?.type !== "search") return original.call(this, message, ...args)
            queueMicrotask(() =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    type: "searchResult",
                    searchRequestId: message.searchRequestId,
                    searchResults: hits,
                    searchComplete: true,
                  },
                })
              )
            )
          }
        },
        {url: `http://127.0.0.1:${relay.port}`, hits}
      )
      await signUp(page, nip19.nsecEncode(viewer))
      if (width === 1280) {
        const search = page.getByPlaceholder("Search", {exact: true}).first()
        await search.fill("warmup")
        const rows = page.locator(".dropdown-content").getByTestId("sidebar-user-row")
        // Wait for a real contact list before issuing the query under test.
        await expect(
          rows.filter({hasText: "Ben Friend"}).getByTitle("Following", {exact: true})
        ).toBeVisible()
        await search.fill("ben")
        await expect(rows.first()).not.toContainText("Ben Friend")
        await expect(rows.first()).toContainText("Ben")
        await page.screenshot({path: testInfo.outputPath("top-search-ranking.png")})
      }
      await page.goto("/u")
      const input = page.getByPlaceholder("Search people...").filter({visible: true})
      // The empty query shows follows. Scope to the people pane so the desktop
      // account row isn't mistaken for a result, and wait for its graph badge.
      const rows = input
        .locator("xpath=ancestor::form/../..")
        .getByTestId("sidebar-user-row")
      await expect(
        rows.filter({hasText: "Ben Friend"}).getByTitle("Following", {exact: true})
      ).toBeVisible()
      await input.fill("ben")
      await expect(rows).toHaveCount(2)
      await expect(rows.first()).not.toContainText("Ben Friend")
      await expect(rows.first()).toContainText("Ben")
      await page.screenshot({path: testInfo.outputPath(`people-ranking-${width}.png`)})
      await rows.first().getByRole("link").first().click()
      await expect(page).toHaveURL(new RegExp(nip19.npubEncode(getPublicKey(stranger))))
    } finally {
      client.close()
      await relay.close()
    }
  })
}
