import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {setTimeout as sleep} from 'node:timers/promises'
import WebSocket from 'ws'

const cdpHttp = process.env.CDP_HTTP || 'http://127.0.0.1:9223'
const outDir = process.env.OUT_DIR || '/tmp/iris-android-smoke'

await fs.mkdir(outDir, {recursive: true})

async function resolveWsUrl(endpoint) {
  if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
    return endpoint
  }

  const base = endpoint.replace(/\/+$/, '')
  const response = await fetch(`${base}/json/list`)
  if (!response.ok) {
    throw new Error(`Failed to list CDP targets from ${base}: ${response.status} ${response.statusText}`)
  }
  const targets = await response.json()
  const preferred = targets.find(
    (target) => target.type === 'page' && String(target.url || '').includes('tauri.localhost')
  )
  const target = preferred || targets.find((item) => item.type === 'page') || targets[0]
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No debuggable page target found at ${base}`)
  }
  return target.webSocketDebuggerUrl
}

const wsUrl = await resolveWsUrl(cdpHttp)
console.log('[info] cdp websocket:', wsUrl)

const ws = new WebSocket(wsUrl)
let nextId = 1
const pending = new Map()

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 15_000)

    pending.set(id, (msg) => {
      clearTimeout(timeout)
      if (msg.error) {
        reject(new Error(`${method} failed: ${JSON.stringify(msg.error)}`))
      } else {
        resolve(msg.result)
      }
    })

    ws.send(JSON.stringify({id, method, params}))
  })
}

function wsReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 10_000)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (!msg.id) return
  const handler = pending.get(msg.id)
  if (!handler) return
  pending.delete(msg.id)
  handler(msg)
})

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`Evaluate exception: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result?.value
}

async function waitFor(name, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await evaluate(expression)
    if (last) return last
    await sleep(400)
  }
  throw new Error(`Timeout waiting for ${name}; last=${JSON.stringify(last)}`)
}

async function screenshot(name) {
  const {data} = await send('Page.captureScreenshot', {format: 'png'})
  const file = path.join(outDir, `${name}.png`)
  await fs.writeFile(file, Buffer.from(data, 'base64'))
  return file
}

await wsReady()
await send('Runtime.enable')
await send('Page.enable')

const currentUrl = await evaluate('location.href')
console.log('[info] url:', currentUrl)
await screenshot('00-initial')

const tosSeen = await evaluate('document.body && /Terms of Service/i.test(document.body.innerText)')
if (tosSeen) {
  console.log('[info] terms screen detected')
  await evaluate(`(() => {
    const checkbox = document.querySelector('input[type="checkbox"]')
    if (checkbox && !checkbox.checked) checkbox.click()
    return !!checkbox
  })()`)
  await sleep(300)
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /continue/i.test(b.textContent || ''))
    if (btn) btn.click()
    return !!btn
  })()`)
  await screenshot('01-after-terms')
}

let username = null
const hasNewPostButton = await evaluate(`!!document.querySelector('[data-testid="new-post-button"]')`)
if (!hasNewPostButton) {
  await sleep(800)
  await evaluate(`(() => {
    const hasSignUpHeading = [...document.querySelectorAll('h1,h2,h3')].some((e) =>
      /sign up/i.test(e.textContent || '')
    )
    if (hasSignUpHeading) return 'already-open'
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /sign up/i.test((b.textContent || '').trim())
    )
    if (btn) {
      btn.click()
      return 'clicked'
    }
    return 'not-found'
  })()`)

  await waitFor(
    'signup input',
    `!!document.querySelector('input[placeholder*="name"]')`,
    25_000
  )

  username = `AndroidSmoke${Date.now()}`
  console.log('[info] username:', username)

  await evaluate(`(() => {
    const input = document.querySelector('input[placeholder*="name"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, ${JSON.stringify(username)})
    else input.value = ${JSON.stringify(username)}
    input.dispatchEvent(new InputEvent('input', {bubbles: true, data: 'x', inputType: 'insertText'}))
    input.dispatchEvent(new Event('change', {bubbles: true}))
    return true
  })()`)

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /^go$/i.test((b.textContent || '').trim())
    )
    if (btn) {
      btn.click()
      return true
    }
    return false
  })()`)
}

await waitFor('home new-post button', `!!document.querySelector('[data-testid="new-post-button"]')`, 30_000)
await screenshot('02-home')

const postText = `android smoke post ${Date.now()}`
await evaluate(`(() => {
  const btn = document.querySelector('[data-testid="new-post-button"]')
  if (!btn) return false
  btn.click()
  return true
})()`)

await waitFor('post editor', `!!document.querySelector('dialog textarea') || !!document.querySelector('textarea')`, 15_000)

await evaluate(`(() => {
  const textarea = document.querySelector('dialog textarea') || document.querySelector('textarea')
  if (!textarea) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(textarea, ${JSON.stringify(postText)})
  else textarea.value = ${JSON.stringify(postText)}
  textarea.dispatchEvent(new InputEvent('input', {bubbles: true, data: 'x', inputType: 'insertText'}))
  textarea.dispatchEvent(new Event('change', {bubbles: true}))
  return true
})()`)

await waitFor(
  'post button enabled',
  `(() => {
    const dialog = document.querySelector('dialog') || document
    const postBtn = [...dialog.querySelectorAll('button')].find((b) =>
      /^post$/i.test((b.textContent || '').trim())
    )
    return !!postBtn && !postBtn.disabled
  })()`,
  10_000
)

await evaluate(`(() => {
  const dialog = document.querySelector('dialog') || document
  const buttons = [...dialog.querySelectorAll('button')]
  const postBtn = buttons.find((b) => /^post$/i.test((b.textContent || '').trim()))
  if (postBtn) { postBtn.click(); return true }
  return false
})()`)

await waitFor('posted content visible', `document.body && document.body.innerText.includes(${JSON.stringify(postText)})`, 30_000)
await screenshot('03-posted')

const feedCount = await evaluate(`document.querySelectorAll('[data-testid="feed-item"]').length`)
console.log('[pass] smoke ok')
console.log(JSON.stringify({username, postText, feedCount, outDir}, null, 2))

ws.close()
