/* eslint-disable no-console */
import {spawn} from "node:child_process"
import {existsSync} from "node:fs"
import {mkdir, writeFile} from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import {setTimeout as sleep} from "node:timers/promises"
import {Builder, By, Key, until} from "selenium-webdriver"
import {nip19} from "nostr-tools"

const ROOT = process.cwd()
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const TAURI_DRIVER_BIN = process.env.TAURI_DRIVER_BIN || "tauri-driver"
const TAURI_DRIVER_PORT = Number(process.env.TAURI_DRIVER_PORT || 4444)
const TAURI_NATIVE_DRIVER_PORT = Number(process.env.TAURI_NATIVE_DRIVER_PORT || 4445)
const TAURI_DRIVER_PORT_SECONDARY = Number(
  process.env.TAURI_DRIVER_PORT_SECONDARY || TAURI_DRIVER_PORT + 2
)
const TAURI_NATIVE_DRIVER_PORT_SECONDARY = Number(
  process.env.TAURI_NATIVE_DRIVER_PORT_SECONDARY || TAURI_NATIVE_DRIVER_PORT + 2
)
const RELAY_PORT = Number(process.env.IRIS_DM_TEST_RELAY_PORT || 7777)
const FORCE_BUILD =
  process.env.IRIS_TAURI_FORCE_BUILD === "1" ||
  process.env.IRIS_TAURI_FORCE_BUILD === "true"
const SKIP_BUILD =
  process.env.IRIS_TAURI_SKIP_BUILD === "1" ||
  process.env.IRIS_TAURI_SKIP_BUILD === "true"

function defaultAppPath() {
  return path.join(ROOT, "src-tauri", "target", "debug", "iris")
}

function normalizeAppPath(appPath) {
  if (process.platform === "win32" && appPath.toLowerCase().endsWith(".exe")) {
    return appPath.slice(0, -4)
  }
  return appPath
}

function appExists(appPathNoExt) {
  if (process.platform === "win32") {
    return existsSync(appPathNoExt) || existsSync(`${appPathNoExt}.exe`)
  }
  return existsSync(appPathNoExt)
}

function appPathForCapability(appPathNoExt) {
  // tauri-driver appends ".exe" on Windows internally.
  return process.platform === "win32" ? appPathNoExt : appPathNoExt
}

function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  const parts = value.split("'").map((part) => `'${part}'`)
  return `concat(${parts.join(`, "'", `)})`
}

function startBackgroundProcess(command, args, label, env = process.env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  })

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`)
  })
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`)
  })

  return child
}

function terminateProcessTree(child, signal) {
  if (!child?.pid) return
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall back to direct child kill.
    }
  }
  child.kill(signal)
}

async function runCommand(command, args, label, env = process.env) {
  console.log(`$ ${command} ${args.join(" ")}`)
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
    })

    child.on("error", (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`))
    })

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `${label} failed (${code === null ? `signal ${signal || "unknown"}` : `exit ${code}`})`
        )
      )
    })
  })
}

async function waitForHttpOk(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = "unknown"

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `${response.status} ${response.statusText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(250)
  }

  throw new Error(`${label} did not become ready (${lastError})`)
}

async function terminateChild(child, label) {
  if (!child || child.killed) return
  if (child.exitCode !== null) return

  terminateProcessTree(child, "SIGTERM")
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(5_000).then(() => false),
  ])

  if (!exited) {
    console.warn(`${label} did not stop after SIGTERM; sending SIGKILL`)
    terminateProcessTree(child, "SIGKILL")
  }
}

async function waitForVisible(driver, locator, timeout = 15_000) {
  try {
    const element = await driver.wait(until.elementLocated(locator), timeout)
    await driver.wait(until.elementIsVisible(element), timeout)
    return element
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Timed out waiting for visible element (${locator}) after ${timeout}ms: ${detail}`
    )
  }
}

async function isVisible(driver, locator, timeout = 1_000) {
  try {
    const element = await driver.wait(until.elementLocated(locator), timeout)
    return await element.isDisplayed()
  } catch {
    return false
  }
}

async function clickTextElement(driver, text, timeout = 15_000) {
  const literal = xpathLiteral(text)
  const locators = [
    By.xpath(`//button[normalize-space()=${literal}]`),
    By.xpath(`//a[normalize-space()=${literal}]`),
    By.xpath(`//*[@role='button' and normalize-space()=${literal}]`),
  ]

  let lastError = null
  for (const locator of locators) {
    try {
      const element = await waitForVisible(driver, locator, timeout)
      await element.click()
      return
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`Could not click text element "${text}": ${String(lastError)}`)
}

async function waitForUrlContains(driver, value, timeout = 15_000) {
  await driver.wait(async () => {
    const url = await driver.getCurrentUrl()
    return url.includes(value)
  }, timeout)
}

async function waitForConnectedRelays(driver) {
  await driver.wait(
    async () => {
      const count = await driver.executeScript(() => {
        const indicator = document.querySelector('[title*="relays connected"]')
        if (!indicator) return 0
        const text = indicator.textContent || ""
        const match = text.match(/\d+/)
        return match ? Number.parseInt(match[0], 10) : 0
      })

      return Number(count) > 0
    },
    30_000,
    "No relays connected"
  )
}

async function hardResetBrowserState(driver) {
  await driver.executeScript(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      // Best effort.
    }

    // Best effort cleanup for IndexedDB without blocking test startup.
    if (window.indexedDB && typeof indexedDB.databases === "function") {
      indexedDB
        .databases()
        .then((databases) =>
          Promise.all(
            databases
              .map((db) => db?.name)
              .filter(Boolean)
              .map(
                (name) =>
                  new Promise((resolve) => {
                    const request = indexedDB.deleteDatabase(name)
                    request.onsuccess = () => resolve(undefined)
                    request.onerror = () => resolve(undefined)
                    request.onblocked = () => resolve(undefined)
                  })
              )
          )
        )
        .catch(() => {})
    }
  })
}

async function openLoginDialog(driver) {
  await driver.get("tauri://localhost/")
  await waitForVisible(driver, By.css("#main-content"), 20_000)

  await hardResetBrowserState(driver)
  await driver.navigate().refresh()
  await waitForVisible(driver, By.css("#main-content"), 20_000)
  await dismissTermsOfServiceIfPresent(driver)

  const signUpHeading = By.xpath(
    "//*[self::h1 or self::h2 or self::h3][normalize-space()='Sign up']"
  )
  const signInHeading = By.xpath(
    "//*[self::h1 or self::h2 or self::h3][normalize-space()='Sign in']"
  )
  if (
    (await isVisible(driver, signUpHeading, 2_000)) ||
    (await isVisible(driver, signInHeading, 2_000))
  ) {
    return
  }

  await clickTextElement(driver, "Sign up")
  await waitForVisible(driver, By.css("dialog.modal"), 10_000)
}

async function dismissTermsOfServiceIfPresent(driver) {
  const termsHeading = By.xpath(
    "//*[self::h1 or self::h2 or self::h3][contains(normalize-space(), 'Terms of Service')]"
  )
  if (!(await isVisible(driver, termsHeading, 2_000))) return

  const agreementLabel = By.xpath(
    "//label[contains(normalize-space(), 'I have read and agree to the Terms of Service')]"
  )
  if (await isVisible(driver, agreementLabel, 2_000)) {
    const label = await waitForVisible(driver, agreementLabel, 5_000)
    await label.click()
  } else {
    const clicked = await driver.executeScript(() => {
      const checkbox =
        document.querySelector("dialog.modal input[type='checkbox']") ||
        document.querySelector("input[type='checkbox']")
      if (!checkbox) return false
      checkbox.click()
      return true
    })
    if (!clicked) {
      throw new Error("Terms of Service modal shown but agreement checkbox was not found")
    }
  }

  const continueButton = await waitForVisible(
    driver,
    By.xpath("//button[normalize-space()='Continue']"),
    10_000
  )
  await driver.wait(async () => continueButton.isEnabled(), 10_000)
  await continueButton.click()
  await driver.wait(async () => !(await isVisible(driver, termsHeading, 500)), 10_000)
}

async function ensureSignUpDialog(driver) {
  const signUpHeading = By.xpath(
    "//*[self::h1 or self::h2 or self::h3][normalize-space()='Sign up']"
  )
  if (await isVisible(driver, signUpHeading, 1_500)) return

  const signInHeading = By.xpath(
    "//*[self::h1 or self::h2 or self::h3][normalize-space()='Sign in']"
  )
  if (await isVisible(driver, signInHeading, 1_500)) {
    await clickTextElement(driver, "Sign up")
  }

  await waitForVisible(driver, signUpHeading, 10_000)
}

async function signUp(driver, username) {
  await openLoginDialog(driver)
  await ensureSignUpDialog(driver)

  const nameInput = await waitForVisible(
    driver,
    By.css(
      'input[placeholder="What\'s your name?"], textarea[placeholder="What\'s your name?"]'
    ),
    10_000
  )
  await nameInput.clear()
  await nameInput.sendKeys(username)

  await clickTextElement(driver, "Go")

  await driver.wait(
    async () =>
      !(await isVisible(
        driver,
        By.xpath("//*[self::h1 or self::h2 or self::h3][normalize-space()='Sign up']"),
        500
      )),
    10_000
  )
  await waitForVisible(driver, By.css('[data-testid="new-post-button"]'), 20_000)

  const storeData = await driver.executeScript(() => {
    const userStore = localStorage.getItem("user-storage")
    const parsed = userStore ? JSON.parse(userStore) : null
    const privateKey =
      parsed?.state?.privateKey ||
      localStorage.getItem("cashu.ndk.privateKeySignerPrivateKey")
    const publicKey = parsed?.state?.publicKey || localStorage.getItem("cashu.ndk.pubkey")
    return {
      privateKey: privateKey || null,
      publicKey: publicKey || null,
    }
  })

  if (!storeData?.publicKey || !storeData?.privateKey) {
    throw new Error("Sign-up did not yield expected user keys")
  }

  return storeData
}

async function openChatFromProfile(driver, targetPubkeyHex) {
  const targetNpub = nip19.npubEncode(targetPubkeyHex)
  await driver.get(`tauri://localhost/${targetNpub}`)

  await waitForVisible(driver, By.css('[data-testid="profile-header-actions"]'), 30_000)

  const buttonLocators = [
    By.xpath(
      "//*[@data-testid='profile-header-actions']//button[.//*[contains(@href,'mail-outline')]]"
    ),
    By.xpath(
      "//*[@data-testid='profile-header-actions']//button[.//*[contains(@*,'mail-outline')]]"
    ),
    By.xpath(
      "//*[@data-testid='profile-header-actions']//button[contains(@class,'btn-circle')]"
    ),
  ]

  let clicked = false
  for (const locator of buttonLocators) {
    try {
      const button = await waitForVisible(driver, locator, 10_000)
      await button.click()
      clicked = true
      break
    } catch {
      // Try the next selector.
    }
  }

  if (!clicked) {
    throw new Error("Could not find profile message button")
  }

  await waitForUrlContains(driver, "/chats/chat", 20_000)
  await waitForVisible(
    driver,
    By.xpath(
      "(//textarea[@placeholder='Message'] | //input[@placeholder='Message'])[last()]"
    ),
    20_000
  )
}

async function sendMessage(driver, message) {
  await acceptMessageRequestIfVisible(driver)

  const input = await waitForVisible(
    driver,
    By.xpath(
      "(//textarea[@placeholder='Message'] | //input[@placeholder='Message'])[last()]"
    ),
    20_000
  )
  await driver.wait(async () => input.isEnabled(), 20_000)
  await input.click()
  await input.sendKeys(message, Key.ENTER)
}

async function waitForMessage(driver, message, timeout = 60_000) {
  await acceptMessageRequestIfVisible(driver, 1_500)
  await waitForVisible(
    driver,
    By.xpath(
      `//*[contains(@class,'whitespace-pre-wrap') and contains(normalize-space(.), ${xpathLiteral(message)})]`
    ),
    timeout
  )
}

async function acceptMessageRequestIfVisible(driver, timeout = 2_000) {
  const acceptButton = By.xpath("//button[normalize-space()='Accept']")
  if (!(await isVisible(driver, acceptButton, timeout))) return

  const button = await waitForVisible(driver, acceptButton, 10_000)
  await button.click()
  await driver.wait(async () => !(await isVisible(driver, acceptButton, 500)), 10_000)
}

async function newTauriDriverSession(appPathNoExt, driverPort = TAURI_DRIVER_PORT) {
  const capabilities = {
    browserName: "wry",
    "tauri:options": {
      application: appPathForCapability(appPathNoExt),
      args: [],
    },
  }

  return new Builder()
    .usingServer(`http://127.0.0.1:${driverPort}`)
    .withCapabilities(capabilities)
    .build()
}

async function saveFailureScreenshot(driver, name) {
  if (!driver) return
  try {
    const directory = "/tmp/iris-tauri-driver"
    await mkdir(directory, {recursive: true})
    const image = await driver.takeScreenshot()
    await writeFile(path.join(directory, name), image, "base64")
  } catch {
    // Best effort only.
  }
}

async function buildTauriIfNeeded(appPathNoExt) {
  if (process.env.IRIS_TAURI_APP_PATH) {
    if (!appExists(appPathNoExt)) {
      throw new Error(`IRIS_TAURI_APP_PATH does not exist: ${appPathNoExt}`)
    }
    return
  }

  if (SKIP_BUILD && appExists(appPathNoExt)) return

  if (!FORCE_BUILD && appExists(appPathNoExt)) {
    // Keep local iteration fast by default.
    return
  }

  await runCommand(
    PNPM_BIN,
    ["tauri", "build", "--debug", "--no-bundle"],
    "tauri build",
    {
      ...process.env,
      // Tauri CLI expects CI to be "true"/"false" (not "1"/"0").
      ...(process.env.CI === "1" ? {CI: "true"} : {}),
      VITE_USE_LOCAL_RELAY: "true",
    }
  )
}

async function main() {
  if (!["linux", "win32"].includes(process.platform)) {
    console.log(
      `[skip] tauri-driver is unsupported on ${process.platform}. ` +
        "Run this test on Linux or Windows."
    )
    process.exit(0)
  }

  const configuredPath = process.env.IRIS_TAURI_APP_PATH || defaultAppPath()
  const appPathNoExt = normalizeAppPath(configuredPath)

  await buildTauriIfNeeded(appPathNoExt)

  if (!appExists(appPathNoExt)) {
    throw new Error(
      `Tauri app binary missing at ${appPathNoExt}. ` +
        "Build with: VITE_USE_LOCAL_RELAY=true pnpm tauri build --debug --no-bundle"
    )
  }

  console.log(`Using Tauri app: ${appPathNoExt}`)

  const relay = startBackgroundProcess(
    PNPM_BIN,
    ["relay:start", "--", "--seed", "0", "--port", String(RELAY_PORT)],
    "relay"
  )

  const tauriDriverPrimary = startBackgroundProcess(
    TAURI_DRIVER_BIN,
    [
      "--port",
      String(TAURI_DRIVER_PORT),
      "--native-port",
      String(TAURI_NATIVE_DRIVER_PORT),
    ],
    "tauri-driver-primary"
  )

  const tauriDriverSecondary = startBackgroundProcess(
    TAURI_DRIVER_BIN,
    [
      "--port",
      String(TAURI_DRIVER_PORT_SECONDARY),
      "--native-port",
      String(TAURI_NATIVE_DRIVER_PORT_SECONDARY),
    ],
    "tauri-driver-secondary"
  )

  let sender
  let receiver

  try {
    await waitForHttpOk(`http://127.0.0.1:${RELAY_PORT}/health`, "local relay", 30_000)
    await waitForHttpOk(
      `http://127.0.0.1:${TAURI_DRIVER_PORT}/status`,
      "primary tauri-driver",
      30_000
    )
    await waitForHttpOk(
      `http://127.0.0.1:${TAURI_DRIVER_PORT_SECONDARY}/status`,
      "secondary tauri-driver",
      30_000
    )

    sender = await newTauriDriverSession(appPathNoExt, TAURI_DRIVER_PORT)
    receiver = await newTauriDriverSession(appPathNoExt, TAURI_DRIVER_PORT_SECONDARY)

    const senderName = `Sender ${Date.now()}`
    const receiverName = `Receiver ${Date.now()}`

    const senderKeys = await signUp(sender, senderName)
    const receiverKeys = await signUp(receiver, receiverName)

    await waitForConnectedRelays(sender)
    await waitForConnectedRelays(receiver)

    const message = `tauri-driver dm smoke ${Date.now()}`

    await openChatFromProfile(sender, receiverKeys.publicKey)
    await sendMessage(sender, message)
    await waitForMessage(sender, message, 20_000)

    await openChatFromProfile(receiver, senderKeys.publicKey)
    await waitForMessage(receiver, message, 60_000)

    console.log("[pass] tauri-driver DM smoke test passed")
  } catch (error) {
    await saveFailureScreenshot(sender, "sender-failure.png")
    await saveFailureScreenshot(receiver, "receiver-failure.png")
    throw error
  } finally {
    if (receiver) {
      await receiver.quit().catch(() => {})
    }
    if (sender) {
      await sender.quit().catch(() => {})
    }

    await terminateChild(tauriDriverPrimary, "tauri-driver-primary")
    await terminateChild(tauriDriverSecondary, "tauri-driver-secondary")
    await terminateChild(relay, "relay")
  }
}

main().catch((error) => {
  console.error("[fail] tauri-driver DM smoke test failed")
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
