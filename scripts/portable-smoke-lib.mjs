import http from "node:http"
import path from "node:path"
import {readFile} from "node:fs/promises"
import {chromium} from "@playwright/test"

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
])

function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath)) ?? "application/octet-stream"
}

function shouldIgnoreConsoleError(text) {
  if (/^Failed to load resource: the server responded with a status of 404\b/.test(text)) {
    return true
  }
  if (/^Failed to load resource: the server responded with a status of 418\b/.test(text)) {
    return true
  }
  if (/^Failed to load resource: net::ERR_NAME_NOT_RESOLVED\b/.test(text)) {
    return true
  }
  if (/^WebSocket connection to 'wss?:\/\/[^']+' failed:/.test(text)) {
    return true
  }
  if (/^WebSocket is already in CLOSING or CLOSED state\.?$/.test(text)) {
    return true
  }
  return false
}

function safeJoin(rootDir, requestPath, entryHtml) {
  const normalized = requestPath === "/" ? `/${entryHtml}` : requestPath
  const fullPath = path.resolve(rootDir, `.${normalized}`)
  if (!fullPath.startsWith(rootDir + path.sep) && fullPath !== path.join(rootDir, entryHtml)) {
    throw new Error(`Refusing to serve path outside root: ${requestPath}`)
  }
  return fullPath
}

async function startServer(rootDir, entryHtml = "index.html") {
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1")
      const filePath = safeJoin(rootDir, decodeURIComponent(requestUrl.pathname), entryHtml)
      const body = await readFile(filePath)
      res.writeHead(200, {
        "content-type": contentTypeFor(filePath),
        "cache-control": "no-store",
      })
      res.end(body)
    } catch (error) {
      res.writeHead(404, {"content-type": "text/plain; charset=utf-8"})
      res.end(error instanceof Error ? error.message : "not found")
    }
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Failed to determine portable smoke server address")
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/${entryHtml}`,
  }
}

export async function runPortableSmoke({distDir, title, screenshotPath, validatePage, entryHtml = "index.html"}) {
  const {server, url} = await startServer(distDir, entryHtml)
  const browser = await chromium.launch({headless: true})
  const page = await browser.newPage()
  const documentResponses = []
  const localResponseFailures = []
  const pageErrors = []
  const consoleErrors = []
  const smokeOrigin = new URL(url).origin

  page.on("response", (response) => {
    if (response.request().resourceType() === "document") {
      documentResponses.push(response.url())
    }
    if (response.status() < 400) {
      return
    }
    let responseUrl
    try {
      responseUrl = new URL(response.url())
    } catch {
      return
    }
    if (responseUrl.origin !== smokeOrigin) {
      return
    }
    if (responseUrl.pathname.startsWith("/htree/")) {
      return
    }
    localResponseFailures.push(`${response.status()} ${response.request().resourceType()} ${response.url()}`)
  })
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message)
  })
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text()
      if (shouldIgnoreConsoleError(text)) {
        return
      }
      consoleErrors.push(text)
    }
  })

  try {
    const response = await page.goto(url, {waitUntil: "load", timeout: 60000})
    if (!response || response.status() !== 200) {
      throw new Error(`Portable build returned ${response?.status() ?? "no response"} for ${url}`)
    }

    await page.waitForTimeout(3000)
    await page.screenshot({path: screenshotPath, fullPage: true})

    if (title !== undefined) {
      const actualTitle = await page.title()
      if (actualTitle !== title) {
        throw new Error(`Portable build loaded unexpected title "${actualTitle}"`)
      }
    }

    if (documentResponses.length > 2) {
      throw new Error(`Portable build reloaded unexpectedly (${documentResponses.length} document responses)`)
    }

    if (localResponseFailures.length > 0) {
      throw new Error(`Portable build hit local asset failures:\n${localResponseFailures.join("\n")}`)
    }

    if (typeof validatePage === "function") {
      await validatePage(page)
    }

    if (pageErrors.length > 0) {
      throw new Error(`Portable build hit page errors:\n${pageErrors.join("\n")}`)
    }

    if (consoleErrors.length > 0) {
      throw new Error(`Portable build logged console errors:\n${consoleErrors.join("\n")}`)
    }

    console.log(`Portable smoke passed: ${url}`)
    console.log(`Screenshot: ${screenshotPath}`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
