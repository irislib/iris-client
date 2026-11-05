import {createServer} from "node:http"
import type {AddressInfo} from "node:net"
import type {Page} from "@playwright/test"
import {WebSocketServer} from "ws"
import ts from "typescript"

export interface FixtureSocket {
  worker?: boolean
  url(): string
  send(message: string): void
  close(): void
  onClose(callback: () => void): void
  onMessage(callback: (message: string | Buffer) => void | Promise<void>): void
}

/** Dedicated workers bypass Playwright's WebSocket routing. Redirect their
 * transport to loopback while retaining the app-selected URL for assertions.
 * Tests must also use a denying browser proxy, independently of this rewrite.
 */
export async function loopbackWorkerRelays(
  page: Page,
  onSocket: (socket: FixtureSocket) => void
) {
  const server = createServer()
  const sockets = new WebSocketServer({server})
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`
  sockets.on("connection", (socket, request) => {
    const url = new URL(new URL(request.url!, endpoint).searchParams.get("relay")!).href
    onSocket({
      worker: true,
      url: () => url,
      send: (message) => socket.send(message),
      close: () => socket.close(),
      onClose: (callback) => {
        socket.on("close", callback)
      },
      onMessage: (callback) => {
        socket.on("message", (data) => void callback(data.toString()))
      },
    })
  })
  await page
    .context()
    .route(/\/assets\/relay-worker-[^/]+\.js(?:\?.*)?$/, async (route) => {
      // Chromium checks local-network permission for the intercepted worker's
      // loopback transport, even when the app itself is served on loopback.
      // Grant only this app origin; the denying proxy and OS guard remain in place.
      await page.context().grantPermissions(["local-network-access"], {
        origin: new URL(route.request().url()).origin,
      })
      const response = await route.fetch()
      const source = await response.text()
      const module = ts.createSourceFile(
        "relay-worker.js",
        source,
        ts.ScriptTarget.ESNext,
        false,
        ts.ScriptKind.JS
      )
      if (
        module.statements.some(
          (statement) =>
            ts.isImportDeclaration(statement) ||
            (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
        )
      ) {
        await route.abort()
        throw new Error(
          "Worker loopback requires a self-contained bundle; static imports may capture WebSocket before the redirect"
        )
      }
      const prefix = `self.WebSocket = class extends self.WebSocket {
      constructor(url, protocols) {
        super(${JSON.stringify(endpoint)} + '?relay=' + encodeURIComponent(String(url)), protocols);
      }
    };\n`
      const headers = {...response.headers()}
      for (const name of [
        "content-encoding",
        "content-length",
        "transfer-encoding",
        "etag",
      ])
        delete headers[name]
      await route.fulfill({status: response.status(), headers, body: prefix + source})
    })
  return async () => {
    for (const socket of sockets.clients) socket.terminate()
    await new Promise<void>((resolve) => sockets.close(() => resolve()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
