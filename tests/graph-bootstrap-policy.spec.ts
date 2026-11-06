import type {Page} from "@playwright/test"
import {expect, test, assertWorkerNetworkBlocked} from "./fixtures/isolatedBrowser"
import {writeFile} from "node:fs/promises"
import {SocialGraph} from "nostr-social-graph"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
  type Event,
  type Filter,
} from "nostr-tools"
import {Session} from "nostr-double-ratchet"
import {
  Negentropy,
  NegentropyStorageVector,
} from "../node_modules/nostr-social-graph/src/vendor/negentropy.js"
import manifest from "../src/assets/socialGraph.json" with {type: "json"}
import {freshGraphBootstrap} from "./utils/graph-bootstrap"
import {signUp} from "./auth.setup"
import {loopbackWorkerRelays, type FixtureSocket} from "./utils/worker-relay-loopback"

test.use({
  serviceWorkers: "block",
  launchOptions: {args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"]},
})
const closeLoopbacks = new WeakMap<Page, () => Promise<void>>()
test.afterEach(async ({page}) => {
  await closeLoopbacks.get(page)?.()
})
test.skip(
  ![process.env.IRIS_E2E_BUILT_DIST, process.env.IRIS_E2E_BUILT].some((value) =>
    ["true", "1"].includes(value || "")
  ),
  "Verify the production bundle, including its real bootstrap import"
)

const previousPublicRelays = [
  "wss://temp.iris.to/",
  "wss://vault.iris.to/",
  "wss://relay.damus.io/",
  "wss://relay.snort.social/",
  "wss://relay.primal.net/",
  "wss://nos.lol/",
]
const publicRelays = [
  previousPublicRelays[0],
  "wss://relay.ditto.pub/",
  ...previousPublicRelays.slice(1),
]
const account = "a".repeat(64)
const friend = "b".repeat(64)
const muted = "c".repeat(64)
const discovered = "d".repeat(64)

function setList(graph: SocialGraph, pubkey: string, kind: 3 | 10000, targets: string[]) {
  graph.handleEvent(
    {
      pubkey,
      kind,
      tags: targets.map((key) => ["p", key]),
      created_at: 20,
      content: "",
      id: "",
      sig: "",
    },
    true,
    Infinity
  )
}

async function fixtureGraph(discovery = discovered) {
  const graph = new SocialGraph(manifest.root)
  setList(graph, manifest.root, 3, [discovery])
  return Buffer.from(await graph.toBinary())
}

async function seedGraph(page: Page, graph: SocialGraph) {
  await page.route("**/__graph-seed", (route) =>
    route.fulfill({contentType: "text/html", body: "<!doctype html>"})
  )
  await page.goto("/__graph-seed")
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("localforage", 2)
        opening.onupgradeneeded = () => opening.result.createObjectStore("keyvaluepairs")
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result
          const tx = db.transaction("keyvaluepairs", "readwrite")
          tx.objectStore("keyvaluepairs").put(new Uint8Array(data), "socialGraph")
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    Array.from(await graph.toBinary())
  )
}

async function exportedGraph(page: Page) {
  const downloaded = page.waitForEvent("download")
  await page.getByRole("button", {name: "Save to file", exact: true}).click()
  const stream = await (await downloaded).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return SocialGraph.fromBinary(manifest.root, Buffer.concat(chunks))
}

type Negotiation = "unsupported" | "malformed" | "disconnect" | "silent" | "success"
type RelayTrace = {
  url: string
  worker: boolean
  catchup: boolean
  closed: boolean
  requests: Filter[]
  published: Event[]
}
type SavedSettings = {version: number; state: Record<string, unknown>}

async function configure(
  page: Page,
  scope = "default",
  negotiation: Negotiation = "unsupported",
  remoteEvents: Event[] = [],
  savedSettings?: SavedSettings
) {
  const sockets: string[] = []
  const catchupRequests: string[] = []
  const connections: RelayTrace[] = []
  const onSocket = (socket: FixtureSocket) => {
    sockets.push(socket.url())
    const trace: RelayTrace = {
      url: socket.url(),
      worker: socket.worker ?? false,
      catchup: false,
      closed: false,
      requests: [],
      published: [],
    }
    connections.push(trace)
    let server: Negentropy | undefined
    socket.onClose(() => {
      trace.closed = true
    })
    socket.onMessage(async (raw) => {
      if (typeof raw !== "string" || !raw.startsWith("[")) return
      const [type, id, filter, initialMessage] = JSON.parse(raw)
      if (
        type === "NEG-OPEN" &&
        filter?.kinds?.includes(3) &&
        filter.kinds.includes(10000)
      ) {
        trace.catchup = true
        catchupRequests.push(socket.url())
        if (negotiation === "unsupported") {
          socket.send(
            JSON.stringify(["NEG-ERR", id, "unsupported: reconciliation unavailable"])
          )
        } else if (negotiation === "malformed") {
          socket.send(JSON.stringify(["NEG-MSG", id, "not-hex"]))
        } else if (negotiation === "disconnect") {
          trace.closed = true
          socket.close()
        } else if (negotiation === "success") {
          const storage = new NegentropyStorageVector()
          for (const event of remoteEvents) {
            if (
              filter.authors.includes(event.pubkey) &&
              filter.kinds.includes(event.kind)
            ) {
              storage.insert(event.created_at, event.id)
            }
          }
          storage.seal()
          server = new Negentropy(storage, 16384)
          socket.send(
            JSON.stringify(["NEG-MSG", id, (await server.reconcile(initialMessage))[0]])
          )
        }
      } else if (type === "NEG-MSG" && server) {
        socket.send(JSON.stringify(["NEG-MSG", id, (await server.reconcile(filter))[0]]))
      } else if (type === "EVENT") {
        trace.published.push(id)
        socket.send(JSON.stringify(["OK", id.id, true, ""]))
      } else if (type === "REQ") {
        const filters: Filter[] = JSON.parse(raw).slice(2)
        trace.requests.push(...filters)
        if (trace.catchup) {
          // Model relays that return at most 100 events before EOSE, even when
          // an exact-ID request asks for more.
          const matching = remoteEvents.filter((event) =>
            filters.some((candidate) => candidate.ids?.includes(event.id))
          )
          for (const event of matching.slice(0, 100)) {
            socket.send(JSON.stringify(["EVENT", id, event]))
          }
        }
        socket.send(JSON.stringify(["EOSE", id]))
      }
    })
  }
  await page.context().routeWebSocket(/^(?:wss?:\/\/)/, onSocket)
  closeLoopbacks.set(page, await loopbackWorkerRelays(page, onSocket))
  await page.addInitScript(
    ({scope, publicRelays, savedSettings}) => {
      if (scope === "native") window.__HTREE_SERVER_URL__ = "http://127.0.0.1:7799"
      if (sessionStorage.getItem("relay-policy-seeded")) return
      sessionStorage.setItem("relay-policy-seeded", "true")
      if (scope === "fresh") {
        localStorage.removeItem("user-storage")
        return
      }
      let relays = publicRelays
      if (scope === "custom") relays = ["wss://custom.test/"]
      if (scope === "empty") relays = []
      localStorage.setItem(
        "user-storage",
        JSON.stringify({
          version: savedSettings?.version ?? 3,
          state: {
            publicKey: "",
            privateKey: "",
            relays: scope === "disabled" ? [] : relays,
            relayConfigs: relays.map((url) => ({url, disabled: scope === "disabled"})),
            ndkOutboxModel: false,
            autoConnectUserRelays: false,
            followRelayHints: false,
            ...savedSettings?.state,
          },
        })
      )
      // Exercise legacy field absence through real Zustand hydration.
      if (savedSettings) {
        const saved = JSON.parse(localStorage.getItem("user-storage")!)
        for (const key of ["relays", "relayConfigs"]) {
          if (!(key in savedSettings.state)) delete saved.state[key]
        }
        localStorage.setItem("user-storage", JSON.stringify(saved))
      }
    },
    {scope, publicRelays, savedSettings}
  )
  return {sockets, catchupRequests, connections}
}

test("worker network boundary rejects unmodified worker connections", async ({
  page,
  networkBoundary,
}, testInfo) => {
  const rejected = await assertWorkerNetworkBlocked(page, networkBoundary)
  const path = testInfo.outputPath("worker-network-denial.json")
  await writeFile(path, JSON.stringify(rejected, null, 2))
  await testInfo.attach("worker-network-denial", {path, contentType: "application/json"})
})

test("fresh shipped defaults route reading, graph sync and signed public posts to Ditto", async ({
  page,
  networkBoundary,
}, testInfo) => {
  await assertWorkerNetworkBlocked(page, networkBoundary)
  const {connections, catchupRequests} = await configure(page, "fresh")
  const body = await fixtureGraph()
  await page.route(freshGraphBootstrap, (route) =>
    route.fulfill({
      body,
      contentType: "application/octet-stream",
      headers: {
        "x-graph-root": manifest.root,
        "access-control-expose-headers": "x-graph-root",
      },
    })
  )
  await page.goto("/settings/social-graph")
  await expect.poll(() => catchupRequests.length).toBe(3)
  expect(catchupRequests).toEqual([
    "wss://graph-relay.iris.to/",
    "wss://temp.iris.to/",
    "wss://relay.ditto.pub/",
  ])
  await page.goto("/")
  await expect
    .poll(() => page.workers().some((worker) => worker.url().includes("relay-worker-")))
    .toBe(true)
  const relayWorker = page
    .workers()
    .find((worker) => worker.url().includes("relay-worker-"))
  expect(relayWorker, "The real relay worker must be running").toBeDefined()
  expect(await relayWorker!.evaluate(() => WebSocket.toString())).toContain(
    "encodeURIComponent"
  )
  expect(
    await relayWorker!.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket("wss://worker-loopback-control.invalid/")
          const timer = setTimeout(() => {
            socket.close()
            resolve("timeout")
          }, 3000)
          socket.onopen = () => {
            clearTimeout(timer)
            socket.close()
            resolve("open")
          }
          socket.onerror = () => {
            clearTimeout(timer)
            resolve("error")
          }
        })
    )
  ).toBe("open")
  try {
    await expect
      .poll(() =>
        connections.some(
          (connection) =>
            connection.url === "wss://relay.ditto.pub/" &&
            connection.worker &&
            !connection.catchup &&
            connection.requests.some((filter) =>
              filter.kinds?.some((kind) => [0, 1, 3, 7, 10000].includes(kind))
            )
        )
      )
      .toBe(true)
  } finally {
    await writeFile(
      testInfo.outputPath("reading-routing.json"),
      JSON.stringify(
        {
          connections: connections.map(({url, worker, requests, closed}) => ({
            url,
            worker,
            requests,
            closed,
          })),
          rejected: networkBoundary.rejected,
        },
        null,
        2
      )
    )
  }

  // The independent proxy denies external traffic; worker sockets use loopback.
  // Exercise the production signing/worker path with an ephemeral identity.
  await signUp(page, nip19.nsecEncode(new Uint8Array(32).fill(23)), {
    preserveRelayPolicy: true,
  })
  await page.goto("/new")
  const content = "Synthetic default-relay routing check"
  await page.getByPlaceholder("What's on your mind?").fill(content)
  await page.getByRole("button", {name: "Post", exact: true}).last().click()
  try {
    await expect
      .poll(() =>
        connections
          .filter(
            (connection) =>
              connection.worker &&
              connection.published.some((event) => event.content === content)
          )
          .map((connection) => connection.url)
      )
      .toContain("wss://relay.ditto.pub/")
  } finally {
    const path = testInfo.outputPath("relay-routing.json")
    await writeFile(
      path,
      JSON.stringify(
        connections.map(({url, worker, catchup, closed, requests, published}) => ({
          url,
          worker,
          catchup,
          closed,
          requests: requests.length,
          published: published.map(({kind, content}) => ({kind, content})),
        })),
        null,
        2
      )
    )
    await testInfo.attach("relay-routing", {path, contentType: "application/json"})
  }
  const post = connections
    .flatMap((connection) => connection.published)
    .find((event) => event.content === content)!
  expect(verifyEvent(post)).toBe(true)
  const authorization = finalizeEvent(
    {
      kind: 37368,
      content: "Synthetic authorization fixture",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    },
    new Uint8Array(32).fill(23)
  )
  const envelope = Session.init(
    getPublicKey(generateSecretKey()),
    generateSecretKey(),
    true,
    generateSecretKey()
  ).sendEvent({kind: 14, content: "Synthetic private fixture"}, [
    ["p", authorization.pubkey],
  ]).event
  const postingWorker = page
    .workers()
    .find((worker) => worker.url().includes("relay-worker-"))!
  // Enter through the actual compiled worker protocol used by NDR. Its caller
  // flags are covered separately; the wire proof catches lost initialization
  // options, connected-only scope widening, and default private subscriptions.
  await postingWorker.evaluate(
    ({envelope, authorization}) => {
      for (const event of [envelope, authorization]) {
        self.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "subscribe",
              id: `private-scope-${event.kind}`,
              filters: [{kinds: [event.kind], authors: [event.pubkey]}],
              subscribeOpts: {privateRelayScope: true},
            },
          })
        )
        self.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "publish",
              id: `private-publish-${event.kind}`,
              event,
              publishOpts: {
                privateRelayScope: true,
                requireAck: true,
                connectedOnly: true,
              },
            },
          })
        )
      }
    },
    {envelope, authorization}
  )
  const privateRouting: {kind: number; publishedTo: string[]; requestedFrom: string[]}[] =
    []
  for (const event of [envelope, authorization]) {
    const publishedTo = () =>
      [
        ...new Set(
          connections
            .filter(
              (connection) =>
                connection.worker &&
                connection.published.some((published) => published.id === event.id)
            )
            .map((connection) => connection.url)
        ),
      ].sort()
    const requestedFrom = () =>
      [
        ...new Set(
          connections
            .filter(
              (connection) =>
                connection.worker &&
                connection.requests.some(
                  (filter) =>
                    filter.kinds?.includes(event.kind) &&
                    filter.authors?.includes(event.pubkey)
                )
            )
            .map((connection) => connection.url)
        ),
      ].sort()
    // Private transports may deliberately choose a subset of allowed relays.
    await expect.poll(() => publishedTo().length).toBeGreaterThan(0)
    await expect.poll(() => requestedFrom().length).toBeGreaterThan(0)
    expect(
      [...publishedTo(), ...requestedFrom()].every((url) =>
        previousPublicRelays.includes(url)
      )
    ).toBe(true)
    privateRouting.push({
      kind: event.kind,
      publishedTo: publishedTo(),
      requestedFrom: requestedFrom(),
    })
  }
  const privateProofPath = testInfo.outputPath("private-relay-routing.json")
  await writeFile(privateProofPath, JSON.stringify(privateRouting, null, 2))
  await testInfo.attach("private-relay-routing", {
    path: privateProofPath,
    contentType: "application/json",
  })
  await page.goto("/settings/network")
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("user-storage")!).state
  )
  expect(saved.privateRelays).toEqual(previousPublicRelays)
  const ditto = page.getByText("relay.ditto.pub", {exact: true})
  await expect(ditto).toBeVisible()
  await ditto.scrollIntoViewIfNeeded()
  await page.screenshot({path: testInfo.outputPath("default-relays.png")})
})

const savedChoices = [
  {
    name: "custom",
    state: {
      relayConfigs: [
        {url: "wss://custom.test/"},
        {url: "wss://disabled.test/", disabled: true},
      ],
      relays: ["wss://custom.test/"],
    },
  },
  {name: "empty", state: {relayConfigs: [], relays: []}},
  {
    name: "disabled",
    state: {
      relayConfigs: previousPublicRelays.map((url) => ({url, disabled: true})),
      relays: [],
    },
  },
  {name: "legacy custom", state: {relays: ["wss://custom.test/"]}},
  {name: "legacy empty", state: {relays: []}},
] satisfies {
  name: string
  state: {relayConfigs?: {url: string; disabled?: boolean}[]; relays: string[]}
}[]

for (const version of [0, 1, 2, 3]) {
  for (const choice of savedChoices) {
    test(`saved version ${version} ${choice.name} relay choices survive hydration and reload`, async ({
      page,
    }) => {
      const {sockets} = await configure(page, "saved", "unsupported", [], {
        version,
        state: choice.state,
      })
      let publicBootstraps = 0
      await page.route(freshGraphBootstrap, (route) => {
        publicBootstraps++
        return route.fulfill({status: 503, body: "Unexpected bootstrap"})
      })
      const configs: {url: string; disabled?: boolean}[] =
        choice.state.relayConfigs ?? choice.state.relays.map((url) => ({url}))
      const enabled = configs
        .filter((config) => !config.disabled)
        .map((config) => config.url)
      for (let load = 0; load < 2; load++) {
        await page.goto("/settings/network")
        await expect(
          page.getByRole("checkbox", {name: "Follow relay hints", exact: true})
        ).toBeVisible()
        await expect(page.getByTitle("Disconnect from relay", {exact: true})).toHaveCount(
          enabled.length
        )
        await expect(page.getByTitle("Connect to relay", {exact: true})).toHaveCount(
          configs.length - enabled.length
        )
        // Persist through an unrelated setting, so reload checks the app's own
        // normalized storage rather than reseeding the original fixture.
        await Promise.all([
          page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
          page
            .getByRole("checkbox", {name: "Follow relay hints", exact: true})
            .setChecked(load === 0),
        ])
        await expect(
          page.getByRole("checkbox", {name: "Follow relay hints", exact: true})
        ).toBeChecked({checked: load === 0})
        const saved = await page.evaluate(
          () => JSON.parse(localStorage.getItem("user-storage")!).state
        )
        expect(saved.relayConfigs).toEqual(configs)
        expect(saved.relays).toEqual(enabled)
        expect(saved.privateRelays).toEqual(enabled)
        if (enabled.length)
          await expect.poll(() => sockets.includes(enabled[0])).toBe(true)
        expect(
          sockets.some(
            (url) =>
              publicRelays.includes(url) || url.startsWith("wss://graph-relay.iris.to")
          )
        ).toBe(false)
        expect(sockets).not.toContain("wss://disabled.test/")
        expect(publicBootstraps).toBe(0)
      }
    })
  }
}

test("previous shipped relay choices retain graph bootstrap without adding Ditto", async ({
  page,
}) => {
  const {sockets, catchupRequests} = await configure(page, "saved", "unsupported", [], {
    version: 3,
    state: {
      relays: previousPublicRelays,
      relayConfigs: previousPublicRelays.map((url) => ({url})),
    },
  })
  const body = await fixtureGraph()
  let requests = 0
  await page.route(freshGraphBootstrap, (route) => {
    requests++
    return route.fulfill({
      body,
      contentType: "application/octet-stream",
      headers: {
        "x-graph-root": manifest.root,
        "access-control-expose-headers": "x-graph-root",
      },
    })
  })
  await page.goto("/settings/social-graph")
  await expect.poll(() => catchupRequests.length).toBe(3)
  expect(catchupRequests).toEqual([
    "wss://graph-relay.iris.to/",
    "wss://temp.iris.to/",
    "wss://vault.iris.to/",
  ])
  expect(requests).toBe(1)
  expect(sockets).not.toContain("wss://relay.ditto.pub/")
  const graph = await exportedGraph(page)
  expect(graph.getFollowedByUser(manifest.root)).toEqual(new Set([discovered]))
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("user-storage")!).state
  )
  expect(saved.relayConfigs).toEqual(previousPublicRelays.map((url) => ({url})))
})

for (const retained of [false, true]) {
  test(`default HTTP bootstrap imports real binary in ${retained ? "retained" : "empty"} graph`, async ({
    page,
  }, testInfo) => {
    const {sockets, catchupRequests} = await configure(page)
    const body = await fixtureGraph()
    let requests = 0
    await page.route(freshGraphBootstrap, (route) => {
      requests++
      return route.fulfill({
        body,
        contentType: "application/octet-stream",
        headers: {
          "x-graph-root": manifest.root,
          "access-control-expose-headers": "x-graph-root",
        },
      })
    })
    if (retained) {
      const personal = new SocialGraph(account)
      setList(personal, account, 3, [friend])
      setList(personal, account, 10000, [muted])
      await seedGraph(page, personal)
    }
    await page.goto("/settings/social-graph")
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText("1")
    const graph = await exportedGraph(page)
    expect(requests).toBe(1)
    expect(graph.getFollowedByUser(manifest.root)).toEqual(new Set([discovered]))
    await expect
      .poll(() => sockets.some((url) => url.startsWith("wss://graph-relay.iris.to")))
      .toBe(true)
    await expect.poll(() => catchupRequests.length).toBeGreaterThan(0)
    if (retained) {
      expect(graph.getFollowedByUser(account)).toEqual(new Set([friend]))
      expect(graph.getMutedByUser(account)).toEqual(new Set([muted]))
      expect(graph.getFollowListCreatedAt(account)).toBe(20)
      expect(graph.getMuteListCreatedAt(account)).toBe(20)
    }
    // A retained snapshot must remain the authority on reload, without another HTTP bootstrap.
    await seedGraph(page, graph)
    await page.goto("/settings/social-graph")
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText("1")
    expect(requests).toBe(1)
    await page.screenshot({path: testInfo.outputPath("fresh-graph-bootstrap.png")})
  })
}

for (const scope of ["custom", "disabled", "empty", "native"]) {
  test(`${scope} relay scope uses bundled graph without default graph traffic`, async ({
    page,
  }) => {
    const {sockets} = await configure(page, scope)
    let requests = 0
    await page.route(freshGraphBootstrap, (route) => {
      requests++
      return route.fulfill({status: 503, body: "Unexpected public bootstrap"})
    })
    await page.goto("/settings/social-graph")
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText(String(manifest.directFollows))
    const graph = await exportedGraph(page)
    expect(graph.getFollowedByUser(manifest.root).size).toBe(manifest.directFollows)
    expect(requests).toBe(0)
    expect(sockets.some((url) => url.startsWith("wss://graph-relay.iris.to"))).toBe(false)
    expect(sockets.filter((url) => publicRelays.includes(url))).toEqual([])
    if (scope === "custom")
      await expect.poll(() => sockets.includes("wss://custom.test/")).toBe(true)
  })
}

test("changing relay settings aborts a pending public bootstrap and preserves personal lists", async ({
  page,
}) => {
  const {sockets, catchupRequests} = await configure(page)
  const personal = new SocialGraph(account)
  setList(personal, account, 3, [friend])
  setList(personal, account, 10000, [muted])
  await seedGraph(page, personal)
  const body = await fixtureGraph()
  let requested = false
  let aborted = false
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("https://graph-api.iris.to/social-graph/mobile"))
      aborted = true
  })
  await page.route(freshGraphBootstrap, async (route) => {
    requested = true
    await held
    await route
      .fulfill({
        body,
        contentType: "application/octet-stream",
        headers: {
          "x-graph-root": manifest.root,
          "access-control-expose-headers": "x-graph-root",
        },
      })
      .catch(() => {})
  })
  try {
    await page.goto("/settings/network")
    await expect.poll(() => requested).toBe(true)
    await page.getByTitle("Disconnect from relay", {exact: true}).first().uncheck()
    await expect.poll(() => aborted).toBe(true)
    release()
    await page.getByRole("link", {name: "Social Graph", exact: true}).first().click()
    await expect(
      page.getByText("Distance 1", {exact: true}).locator("..").locator("span").last()
    ).toHaveText(String(manifest.directFollows))
    const graph = await exportedGraph(page)
    expect(graph.getFollowedByUser(account)).toEqual(new Set([friend]))
    expect(graph.getMutedByUser(account)).toEqual(new Set([muted]))
    expect(graph.getFollowedByUser(manifest.root).has(discovered)).toBe(false)
    expect(sockets.some((url) => url.startsWith("wss://graph-relay.iris.to"))).toBe(false)
    expect(catchupRequests).toEqual([])
  } finally {
    release()
  }
})

for (const negotiation of ["unsupported", "malformed", "disconnect", "silent"] as const) {
  test(`graph catch-up stops without list fetches when negotiation is ${negotiation}`, async ({
    page,
  }) => {
    test.setTimeout(40000)
    const {connections} = await configure(page, "default", negotiation)
    const body = await fixtureGraph()
    await page.route(freshGraphBootstrap, (route) =>
      route.fulfill({
        body,
        contentType: "application/octet-stream",
        headers: {
          "x-graph-root": manifest.root,
          "access-control-expose-headers": "x-graph-root",
        },
      })
    )
    await page.goto("/settings/social-graph")
    // Wait for a terminal state, not an arbitrary quiet period. In the silent
    // case this observes the real production reconciliation deadline.
    await expect
      .poll(() => connections.find((connection) => connection.catchup)?.closed, {
        timeout: 25000,
      })
      .toBe(true)
    const catchup = connections.filter((connection) => connection.catchup)
    expect(catchup.length).toBeGreaterThan(0)
    expect(catchup.flatMap((connection) => connection.requests)).toEqual([])
    const graph = await exportedGraph(page)
    expect(graph.getFollowedByUser(manifest.root)).toEqual(new Set([discovered]))
  })
}

test("graph reconciliation retrieves 130 exact IDs across relay response caps and preserves personal lists", async ({
  page,
}) => {
  const secrets = Array.from({length: 65}, (_, index) =>
    new Uint8Array(32).fill(index + 1)
  )
  const authors = secrets.map(getPublicKey)
  const events = secrets.flatMap((secret) => [
    finalizeEvent({kind: 3, created_at: 30, tags: [["p", friend]], content: ""}, secret),
    finalizeEvent(
      {kind: 10000, created_at: 31, tags: [["p", muted]], content: ""},
      secret
    ),
  ])
  const {connections} = await configure(page, "default", "success", events)
  const personal = new SocialGraph(account)
  setList(personal, account, 3, [friend])
  setList(personal, account, 10000, [muted])
  await seedGraph(page, personal)
  const discovery = new SocialGraph(manifest.root)
  setList(discovery, manifest.root, 3, authors)
  const body = Buffer.from(await discovery.toBinary())
  await page.route(freshGraphBootstrap, (route) =>
    route.fulfill({
      body,
      contentType: "application/octet-stream",
      headers: {
        "x-graph-root": manifest.root,
        "access-control-expose-headers": "x-graph-root",
      },
    })
  )
  await page.goto("/settings/social-graph")
  await expect
    .poll(
      () =>
        connections.filter((connection) => connection.catchup && connection.closed).length
    )
    .toBe(3)
  const requests = connections
    .filter((connection) => connection.catchup)
    .flatMap((connection) => connection.requests)
  expect(requests.length).toBeGreaterThan(0)
  for (const filter of requests) {
    expect(Object.keys(filter)).toEqual(["ids"])
    expect(filter.ids!.length).toBeLessThanOrEqual(64)
  }
  expect(requests.flatMap((filter) => filter.ids ?? []).sort()).toEqual(
    events.map((event) => event.id).sort()
  )
  const graph = await exportedGraph(page)
  for (const author of authors) {
    expect(graph.getFollowedByUser(author)).toEqual(new Set([friend]))
    expect(graph.getMutedByUser(author)).toEqual(new Set([muted]))
  }
  expect(graph.getFollowedByUser(account)).toEqual(new Set([friend]))
  expect(graph.getMutedByUser(account)).toEqual(new Set([muted]))
  expect(graph.getFollowListCreatedAt(account)).toBe(20)
  expect(graph.getMuteListCreatedAt(account)).toBe(20)
})
