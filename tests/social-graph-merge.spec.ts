import {expect, test, type Page} from "@playwright/test"
import {SocialGraph} from "nostr-social-graph"

const root = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0"
const key = (id: number) => id.toString(16).padStart(64, "0")
const [author, oldTarget, newTarget, decoy, retained] = [1, 2, 3, 4, 5].map(key)

function list(
  graph: SocialGraph,
  pubkey: string,
  kind: 3 | 10000,
  targets: string[],
  created_at: number
) {
  graph.handleEvent(
    {
      pubkey,
      kind,
      created_at,
      tags: targets.map((id) => ["p", id]),
      content: "",
      id: "",
      sig: "",
    },
    true,
    Infinity
  )
}

async function saveGraph(page: Page) {
  const downloaded = page.waitForEvent("download")
  await page.getByRole("button", {name: "Save to file", exact: true}).click()
  const stream = await (await downloaded).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return SocialGraph.fromBinary(root, Buffer.concat(chunks))
}

test.use({serviceWorkers: "block"})

test("Load & merge preserves people and newer follow and mute lists after export", async ({
  page,
}) => {
  const destination = new SocialGraph(root)
  list(destination, root, 3, [decoy, author], 40)
  list(destination, author, 3, [oldTarget], 20)
  list(destination, author, 10000, [oldTarget], 20)
  list(destination, decoy, 3, [retained], 40)
  const incoming = new SocialGraph(root)
  list(incoming, root, 3, [author, decoy], 10)
  list(incoming, author, 3, [newTarget], 30)
  list(incoming, author, 10000, [newTarget], 30)
  list(incoming, decoy, 3, [], 30)
  await Promise.all([
    destination.recalculateFollowDistances(),
    incoming.recalculateFollowDistances(),
  ])
  const binary = Buffer.from(await destination.toBinary())
  await page.route(/socialGraph[^/]*\.bin(?:\?.*)?$/, (route) =>
    route.request().resourceType() === "script"
      ? route.continue()
      : route.fulfill({contentType: "application/octet-stream", body: binary})
  )
  // No live relay should replace the fixture's historical contact lists.
  await page.routeWebSocket(/^(?:wss?:\/\/)/, (socket) => socket.close())
  await page.goto("/settings/social-graph")
  await expect(
    page.getByRole("button", {name: "Load & merge", exact: true})
  ).toBeVisible()
  expect((await saveGraph(page)).getFollowedByUser(author)).toEqual(new Set([oldTarget]))
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", {name: "Load & merge", exact: true}).click()
  await (
    await chooser
  ).setFiles({
    name: "incoming-social-graph.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(await incoming.toBinary()),
  })
  await expect(async () => {
    const saved = await saveGraph(page)
    expect(saved.getRoot()).toBe(root)
    expect(saved.getFollowedByUser(root)).toEqual(new Set([decoy, author]))
    expect(saved.getFollowedByUser(author)).toEqual(new Set([newTarget]))
    expect(saved.getMutedByUser(author)).toEqual(new Set([newTarget]))
    expect(saved.getFollowersByUser(newTarget)).toEqual(new Set([author]))
    expect(saved.getUserMutedBy(newTarget)).toEqual(new Set([author]))
    expect(saved.getFollowersByUser(oldTarget)).toEqual(new Set())
    expect(saved.getUserMutedBy(oldTarget)).toEqual(new Set())
    expect(saved.getFollowedByUser(decoy)).toEqual(new Set([retained]))
    expect(saved.getFollowListCreatedAt(author)).toBe(30)
    expect(saved.getMuteListCreatedAt(author)).toBe(30)
  }).toPass({timeout: 5000})
})
