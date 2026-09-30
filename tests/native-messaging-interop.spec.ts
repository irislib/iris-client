import {test, expect} from "@playwright/test"
import {execFile, spawn} from "node:child_process"
import {promisify} from "node:util"
import {mkdtemp, writeFile, rm} from "node:fs/promises"
import path from "node:path"
import {tmpdir} from "node:os"
import {generateSecretKey, getPublicKey} from "nostr-tools"
import {signUp} from "./auth.setup"
import {ensureCurrentDeviceRegistered} from "./private-messaging-helpers"

const execute = promisify(execFile)
const binary = process.env.IRIS_CHAT_RS_BIN

test("exchanges direct and group messages with the native Iris Chat runtime", async ({
  page,
}) => {
  test.skip(!binary, "Set IRIS_CHAT_RS_BIN to a current iris-chat-rs CLI build")
  test.setTimeout(180000)

  const dataDir = await mkdtemp(path.join(tmpdir(), "iris-"))
  const relay = "ws://127.0.0.1:7777"
  await writeFile(path.join(dataDir, "config.json"), JSON.stringify({relays: [relay]}))
  const nativeEnv = {
    ...process.env,
    NOSTR_PREFER_LOCAL: "0",
    IRIS_FIPS_WEBSOCKET_SEED_URLS: "",
    IRIS_DEMO_RELAYS: relay,
    IRIS_REQUIRE_SERVICE: "1",
  }
  const service = spawn(binary!, ["--json", "--data-dir", dataDir, "service", "run"], {
    env: nativeEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let serviceOutput = ""
  service.stdout.on("data", (data) => {
    serviceOutput += data.toString()
  })
  service.stderr.on("data", () => {})
  const serviceExit = new Promise<void>((resolve) =>
    service.once("exit", () => resolve())
  )
  const native = async (...args: string[]) => {
    const {stdout} = await execute(binary!, ["--json", "--data-dir", dataDir, ...args], {
      timeout: 30000,
      env: nativeEnv,
    }).catch((error) => {
      throw new Error(
        `Native ${args[0]} failed: ${error.stdout || error.stderr || error.code}`
      )
    })
    const line = stdout
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"))
    const response = JSON.parse(line || "{}")
    expect(response.status).toBe("ok")
    return response.data
  }
  try {
    await expect
      .poll(() => serviceOutput.includes('"ready":true'), {timeout: 15000})
      .toBe(true)
    const secret = generateSecretKey()
    const nativeOwner = getPublicKey(secret)
    await native("login", Buffer.from(secret).toString("hex"))
    const invite = await native("invite", "create")
    await signUp(page)
    await ensureCurrentDeviceRegistered(page)
    await page.goto("/chats/new")
    await page
      .getByPlaceholder("Search users, paste npub or chat invite link")
      .fill(invite.url)
    await page
      .getByPlaceholder("Search users, paste npub or chat invite link")
      .press("Enter")
    let directChat = ""
    await expect
      .poll(
        async () => {
          await native("sync", "--wait-ms", "1000")
          const list = await native("chat", "list")
          directChat =
            list.chats.find((chat: {kind: string}) => chat.kind === "direct")?.chat_id ||
            ""
          return directChat
        },
        {timeout: 45000}
      )
      .not.toBe("")
    await expect(page).toHaveURL(/\/chats\/chat/)
    const fromWeb = `Web direct ${Date.now()}`
    await page.getByPlaceholder("Message").last().fill(fromWeb)
    await page.getByPlaceholder("Message").last().press("Enter")
    const expectNativeMessage = async (chat: string, text: string) => {
      await expect
        .poll(
          async () => {
            await native("sync", "--wait-ms", "1000")
            const read = await native("read", chat)
            return read.messages.map((message: {body: string}) => message.body)
          },
          {timeout: 45000, message: `Native peer receives ${text}`}
        )
        .toContain(text)
    }
    await expectNativeMessage(directChat, fromWeb)
    const fromNative = `Native direct ${Date.now()}`
    await native("send", directChat, fromNative)
    await expect(
      page.locator(".whitespace-pre-wrap:visible").getByText(fromNative)
    ).toBeVisible({
      timeout: 30000,
    })

    await page.goto("/chats/new/group")
    await page.getByRole("button", {name: /Next/}).click()
    await page.getByPlaceholder("Enter group name").fill("Native interop group")
    await page.getByRole("button", {name: "Create Group"}).click()
    await expect(page).toHaveURL(/\/chats\/group\//)
    const groupId = new URL(page.url()).pathname.split("/").at(-1)!
    await page.goto(`/chats/group/${groupId}/details`)
    await page.getByRole("button", {name: "Edit group"}).click()
    await page.getByPlaceholder(/npub|hex/i).fill(nativeOwner)
    await page.getByRole("button", {name: "Add member"}).click()
    await page.getByRole("button", {name: "Save changes"}).click()
    await expect(page.getByRole("button", {name: "Edit group"})).toBeVisible()
    await expect
      .poll(
        async () => {
          await native("sync", "--wait-ms", "1000")
          const list = await native("group", "list")
          return list.groups.some(
            (group: {chat_id: string}) => group.chat_id === `group:${groupId}`
          )
        },
        {timeout: 45000}
      )
      .toBe(true)
    await page.goto(`/chats/group/${groupId}`)
    const webGroup = `Web group ${Date.now()}`
    await page.getByPlaceholder("Message").last().fill(webGroup)
    await page.getByPlaceholder("Message").last().press("Enter")
    await expectNativeMessage(`group:${groupId}`, webGroup)
    const nativeGroup = `Native group ${Date.now()}`
    await native("group", "send", groupId, nativeGroup)
    await expect(
      page.locator(".whitespace-pre-wrap:visible").getByText(nativeGroup)
    ).toBeVisible({
      timeout: 30000,
    })
  } finally {
    await native("service", "stop").catch(() => {})
    if (service.exitCode === null) service.kill("SIGTERM")
    await serviceExit
    await rm(dataDir, {recursive: true, force: true})
  }
})
