import {test as base, expect, type Page} from "@playwright/test"
import {createServer} from "node:http"
import type {Socket} from "node:net"

export interface RejectedProxyRequest {
  method: string
  target: string
}

export interface DenyProxy {
  url: string
  rejected: readonly RejectedProxyRequest[]
  close(): Promise<void>
}

/** A real network boundary: this server never resolves or forwards a target. */
export async function createDenyProxy(): Promise<DenyProxy> {
  const rejected: RejectedProxyRequest[] = []
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    rejected.push({method: request.method || "UNKNOWN", target: request.url || ""})
    response.writeHead(403, {Connection: "close", "Content-Length": "0"})
    response.end()
  })
  server.on("connect", (request, socket) => {
    rejected.push({method: "CONNECT", target: request.url || ""})
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
  })
  server.on("upgrade", (request, socket) => {
    rejected.push({method: "UPGRADE", target: request.url || ""})
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("clientError", (_error, socket) => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Deny proxy did not bind")
  let closing: Promise<void> | undefined
  return {
    url: `http://127.0.0.1:${address.port}`,
    rejected,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}

function proxyBypass(allowedArtifactOrigin?: string): string {
  // Chromium accepts scheme + exact hostname + port bypass rules. Keep the
  // explicitly allowed HTTPS origin available, without bypassing WSS on that host.
  // No wildcard, suffix, relay-host, redirect-origin or CDN exception is added.
  const rules = ["127.0.0.1", "localhost", "[::1]"]
  if (allowedArtifactOrigin) {
    const app = new URL(allowedArtifactOrigin)
    if (
      app.protocol !== "https:" ||
      /[*;,<>]/.test(app.hostname) ||
      app.hostname.startsWith(".") ||
      app.username ||
      app.password ||
      app.pathname !== "/" ||
      app.search ||
      app.hash
    ) {
      throw new Error("Artifact bypass must be one exact HTTPS origin")
    }
    rules.push(`${app.protocol}//${app.hostname}:${app.port || "443"}`)
  }
  return rules.join(",")
}

/**
 * Page WebSocket routes do not cover dedicated workers. Keep this proxy in
 * place even when tests intercept page sockets or rewrite worker sockets to a
 * loopback relay. Service workers are blocked so a retained worker cannot
 * bypass the fixture's script interception or outlive its browser context.
 */
export const test = base.extend<{
  networkBoundary: DenyProxy
  /**
   * Explicit exception for reading a deployed app's artifacts. This bypass is
   * origin-wide for HTTPS; it cannot enforce GET-only access to encrypted
   * requests. Leave unset for loopback-only tests and OS-guarded runs.
   */
  allowedArtifactOrigin: string | undefined
}>({
  allowedArtifactOrigin: [undefined, {option: true}],
  networkBoundary: async ({browserName}, use) => {
    if (browserName !== "chromium") {
      throw new Error("The isolated browser fixture currently requires Chromium")
    }
    const boundary = await createDenyProxy()
    try {
      await use(boundary)
    } finally {
      await boundary.close()
    }
  },
  proxy: async ({networkBoundary, allowedArtifactOrigin}, use) => {
    await use({server: networkBoundary.url, bypass: proxyBypass(allowedArtifactOrigin)})
  },
  serviceWorkers: "block",
})

export {expect}

/**
 * Prove a raw worker is denied before running any signed publication fixture.
 * The worker sends no application data, and this helper requires the actual
 * proxy rejection as well as a failed connection. A JS interception alone
 * therefore cannot satisfy the control. Reserved .invalid hosts keep this
 * control from reaching a public endpoint even if the proxy regresses.
 */
export async function assertWorkerNetworkBlocked(
  page: Page,
  boundary: DenyProxy,
  externalWebSocketUrl = "wss://worker-websocket-denial.invalid/",
  externalFetchUrl = "https://worker-fetch-denial.invalid/"
): Promise<RejectedProxyRequest[]> {
  const targets = [new URL(externalWebSocketUrl), new URL(externalFetchUrl)]
  for (const [index, target] of targets.entries()) {
    if (
      target.protocol !== (index === 0 ? "wss:" : "https:") ||
      !target.hostname.endsWith(".invalid") ||
      target.username ||
      target.password
    ) {
      throw new Error("Worker denial controls require WSS and HTTPS .invalid URLs")
    }
  }
  const authorities = targets.map(
    (target) => `${target.hostname}:${target.port || "443"}`
  )
  const first = boundary.rejected.length
  const probe = await page.context().newPage()
  try {
    // Fulfill locally: the control does not load application code or a remote
    // document, and its Blob worker is not the rewritten application worker.
    const probeUrl = "http://127.0.0.1/__worker-network-denial"
    await probe.route(probeUrl, (route) =>
      route.fulfill({contentType: "text/html", body: "<!doctype html>"})
    )
    await probe.goto(probeUrl)
    const outcome = await probe.evaluate(
      ({websocket, fetchUrl}) =>
        new Promise<Record<string, string> | string>((resolve) => {
          const source = `
            const outcomes = {};
            let socket;
            const finish = (name, result) => {
              if (outcomes[name]) return;
              outcomes[name] = result;
              if (name === "websocket") socket?.close();
              if (Object.keys(outcomes).length === 2) postMessage(outcomes);
            };
            try {
              socket = new WebSocket(${JSON.stringify(websocket)});
              socket.onopen = () => finish("websocket", "opened");
              socket.onerror = () => finish("websocket", "blocked");
              socket.onclose = () => finish("websocket", "blocked");
            } catch { finish("websocket", "constructor-error"); }
            fetch(${JSON.stringify(fetchUrl)}, {redirect: "error", cache: "no-store"})
              .then(() => finish("fetch", "response"))
              .catch(() => finish("fetch", "blocked"));
          `
          const blob = URL.createObjectURL(new Blob([source], {type: "text/javascript"}))
          const worker = new Worker(blob)
          const finish = (result: Record<string, string> | string) => {
            clearTimeout(timer)
            worker.terminate()
            URL.revokeObjectURL(blob)
            resolve(result)
          }
          const timer = setTimeout(() => finish("timeout"), 8000)
          worker.onmessage = (event) => finish(event.data)
          worker.onerror = () => finish("worker-error")
        }),
      {websocket: externalWebSocketUrl, fetchUrl: externalFetchUrl}
    )
    expect(outcome, "Unmodified worker must fail both network operations").toEqual({
      websocket: "blocked",
      fetch: "blocked",
    })
    for (const authority of authorities) {
      await expect
        .poll(() =>
          boundary.rejected
            .slice(first)
            .some(
              (request) => request.method === "CONNECT" && request.target === authority
            )
        )
        .toBe(true)
    }
    return boundary.rejected
      .slice(first)
      .filter((request) => authorities.includes(request.target))
  } finally {
    await probe.close()
  }
}
