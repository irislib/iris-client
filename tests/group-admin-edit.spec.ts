import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"
import {nip19} from "nostr-tools"
import WebSocket from "ws"

async function countRelayEvents(filter: Record<string, unknown>, timeoutMs = 5000) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:7777")
    const subId = `sub-${Math.random().toString(36).slice(2)}`
    let count = 0

    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error("Relay query timed out"))
    }, timeoutMs)

    ws.on("open", () => {
      ws.send(JSON.stringify(["REQ", subId, {...filter, limit: 50}]))
    })

    ws.on("message", (data) => {
      let msg: unknown
      try {
        msg = JSON.parse(String(data))
      } catch {
        return
      }
      if (!Array.isArray(msg)) return
      if (msg[0] === "EVENT" && msg[1] === subId) {
        count++
        return
      }
      if (msg[0] === "EOSE" && msg[1] === subId) {
        clearTimeout(timeout)
        ws.close()
        resolve(count)
      }
    })

    ws.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function ensureDeviceRegistered(page) {
  // Navigate to Chats and register device first (required for private messaging)
  await page.getByRole("link", {name: "Chats"}).click()

  // Go to Devices tab and register this device
  await page.getByRole("link", {name: "Devices"}).click()
  await expect(page).toHaveURL(/\/chats\/new\/devices/)
  await expect(page.getByRole("button", {name: "Link another device"})).toBeVisible({
    timeout: 10000,
  })

  const registerButton = page.getByRole("button", {name: "Register this device"})
  const thisDeviceBadge = page.getByText("This device").first()

  if (!(await thisDeviceBadge.isVisible().catch(() => false))) {
    if (await registerButton.isVisible({timeout: 2000}).catch(() => false)) {
      // The devices store starts out empty, so the register button can appear briefly even when
      // the current device is already registered. Give it a moment to settle before clicking.
      await Promise.race([
        thisDeviceBadge.waitFor({state: "visible", timeout: 3000}),
        registerButton.waitFor({state: "hidden", timeout: 3000}),
      ]).catch(() => {})

      if (
        !(await thisDeviceBadge.isVisible().catch(() => false)) &&
        (await registerButton.isVisible().catch(() => false))
      ) {
        await registerButton.click({timeout: 10000})

        // If there are existing devices, registration requires confirmation.
        const confirmHeading = page.getByRole("heading", {
          name: "Confirm Device Registration",
        })
        if (await confirmHeading.isVisible({timeout: 2000}).catch(() => false)) {
          await page
            .getByRole("button", {name: "Register Device"})
            .click({timeout: 10000})
        }

        await expect(thisDeviceBadge).toBeVisible({timeout: 20000})
        await expect(registerButton).not.toBeVisible({timeout: 20000})
      }
    }
  }
}

async function openChatFromProfile(page, targetPubkeyHex: string) {
  const targetNpub = nip19.npubEncode(targetPubkeyHex)

  await page.goto(`/${targetNpub}`)
  await page.waitForLoadState("domcontentloaded")

  // Wait for profile to load (and AppKeys subscription to detect invites).
  await expect(page.getByTestId("profile-header-actions")).toBeVisible({timeout: 15000})

  const messageButton = page
    .getByTestId("profile-header-actions")
    .locator("button")
    .filter({has: page.locator('use[href*="mail-outline"]')})
    .first()
  await expect(messageButton).toBeVisible({timeout: 30000})

  await messageButton.click()
  await expect(page).toHaveURL(/\/chats\/chat/, {timeout: 15000})

  const messageInput = page.getByPlaceholder("Message").last()
  await expect(messageInput).toBeVisible({timeout: 15000})
  await expect(messageInput).toBeEnabled({timeout: 20000})
}

test.describe("Group admin edits", () => {
  test("group admins can edit metadata + members; non-admins cannot", async ({
    browser,
  }) => {
    test.setTimeout(180000)

    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      // Surface browser-side errors in the Playwright output (useful for debugging flakiness).
      const hookConsole = (page, label: string) => {
        page.on("pageerror", (err) => {
          console.error(`[${label}] pageerror:`, err)
        })
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            console.error(`[${label}] console.error:`, msg.text())
          }
        })
      }
      hookConsole(pageA, "admin")
      hookConsole(pageB, "member")

      const admin = await signUp(pageA, "Admin User")
      const member = await signUp(pageB, "Member User")
      if (!admin.publicKey) {
        throw new Error("Expected admin publicKey from signup")
      }
      if (!member.publicKey) {
        throw new Error("Expected member publicKey from signup")
      }

      await ensureDeviceRegistered(pageA)
      await ensureDeviceRegistered(pageB)

      // Establish a DM session first so group fanout to the member has an active channel.
      await openChatFromProfile(pageA, member.publicKey)
      const dmMessage = `hello ${Date.now()}`
      await pageA.getByPlaceholder("Message").last().fill(dmMessage)
      await pageA.getByPlaceholder("Message").last().press("Enter")

      await openChatFromProfile(pageB, admin.publicKey)
      await expect(
        pageB.locator(".whitespace-pre-wrap").getByText(dmMessage)
      ).toBeVisible({
        timeout: 60000,
      })

      // Debug: confirm the DM message was published (sentToRelays) on the sender side.

      console.log(
        "[debug] admin dm latest message status:",
        await pageA.evaluate(async (peer) => {
          const pmMod = await import("/src/stores/privateMessages.ts")
          const map = pmMod.usePrivateMessagesStore.getState().events.get(peer)
          if (!map) return null
          const last = map.last?.()
          const msg = last ? last[1] : null
          if (!msg) return null
          return {
            id: msg.id,
            kind: msg.kind,
            pubkey: msg.pubkey,
            ownerPubkey: msg.ownerPubkey,
            sentToRelays: msg.sentToRelays ?? false,
            nostrEventId: msg.nostrEventId ?? null,
            content: msg.content,
          }
        }, member.publicKey)
      )

      // Debug: verify we have an active SessionManager record for each other user.
      // (If these are missing, group metadata fanout can't work.)
      const debugSession = async (page, peerPubkey: string) => {
        try {
          return await page.evaluate(async (peer) => {
            const mod = await import("/src/shared/services/PrivateChats.ts")
            const mgr = mod.getSessionManager()
            if (!mgr) return {hasManager: false}
            await mgr.init()
            const rec = mgr.getUserRecords().get(peer)
            if (!rec) return {hasManager: true, hasRecord: false}
            const devices = Array.from(rec.devices.values()).map((d) => ({
              deviceId: d.deviceId,
              hasActiveSession: !!d.activeSession,
              inactiveSessions: d.inactiveSessions.length,
            }))
            return {hasManager: true, hasRecord: true, devices}
          }, peerPubkey)
        } catch {
          return {error: "debug import failed"}
        }
      }

      console.log(
        "[debug] admin session->member:",
        await debugSession(pageA, member.publicKey)
      )

      console.log(
        "[debug] member session->admin:",
        await debugSession(pageB, admin.publicKey)
      )

      // Admin: create group with self only.
      // Admin: create group with self only.
      await pageA.goto("/chats/new/group")
      await pageA.getByRole("button", {name: /Next/}).click()
      await pageA.getByPlaceholder("Enter group name").fill("Test Group")
      await pageA.getByRole("button", {name: "Create Group"}).click()
      await expect(pageA).toHaveURL(/\/chats\/group\//, {timeout: 15000})

      const url = pageA.url()
      const match = url.match(/\/chats\/group\/([^/]+)/)
      if (!match?.[1]) throw new Error(`Could not parse group id from url: ${url}`)
      const groupId = match[1]

      // Admin: edit group metadata + add member.
      await pageA.goto(`/chats/group/${groupId}/details`)
      await expect(pageA.getByText("Group Details")).toBeVisible({timeout: 15000})

      await expect(pageA.locator(".badge").getByText("Admin").first()).toBeVisible({
        timeout: 15000,
      })
      await pageA.getByRole("button", {name: "Edit group"}).click()

      await pageA.getByPlaceholder("Enter group name").fill("Renamed Group")
      await pageA.getByPlaceholder("Enter group description").fill("Updated description")
      await pageA.getByPlaceholder("Enter picture URL").fill("https://example.com/g.png")

      await pageA.getByPlaceholder(/npub|hex/i).fill(member.publicKey)
      await pageA.getByRole("button", {name: "Add member"}).click()
      await expect(pageA.getByRole("button", {name: "×"}).first()).toBeVisible({
        timeout: 15000,
      })

      // Debug: capture the current outer pubkey used for messages from admin->member.
      const adminOuterDebug = await pageA.evaluate(async (peer) => {
        const mod = await import("/src/shared/services/PrivateChats.ts")
        const mgr = mod.getSessionManager()
        if (!mgr) return null
        await mgr.init()
        const rec = mgr.getUserRecords().get(peer)
        if (!rec) return null
        const first = Array.from(rec.devices.values())[0]
        const s = first?.activeSession
        const state = s?.state as any
        return {
          hasSession: !!s,
          stateKeys: state ? Object.keys(state) : [],
          ourCurrentPublicKey: state?.ourCurrentNostrKey?.publicKey ?? null,
          ourNextPublicKey: state?.ourNextNostrKey?.publicKey ?? null,
          theirNextPublicKey: state?.theirNextNostrPublicKey ?? null,
          theirCurrentPublicKey: state?.theirCurrentNostrPublicKey ?? null,
        }
      }, member.publicKey)
      const saveSinceSeconds = Math.floor(Date.now() / 1000)

      await pageA.getByRole("button", {name: "Save changes"}).click()
      await expect(pageA.getByText("Renamed Group").first()).toBeVisible({timeout: 15000})

      // Debug: ensure admin's local group state includes the new member.

      console.log(
        "[debug] admin group members:",
        await pageA.evaluate(async (gid) => {
          const mod = await import("/src/stores/groups.ts")
          const g = mod.useGroupsStore.getState().groups[gid]
          return g ? {members: g.members, admins: g.admins, name: g.name} : null
        }, groupId)
      )

      // Debug: check whether the group metadata message was actually published to relays.

      console.log(
        "[debug] admin group latest message status:",
        await pageA.evaluate(async (gid) => {
          const pmMod = await import("/src/stores/privateMessages.ts")
          const map = pmMod.usePrivateMessagesStore.getState().events.get(gid)
          if (!map) return null
          const last = map.last?.()
          const msg = last ? last[1] : null
          if (!msg) return null
          return {
            id: msg.id,
            kind: msg.kind,
            pubkey: msg.pubkey,
            ownerPubkey: msg.ownerPubkey,
            sentToRelays: msg.sentToRelays ?? false,
            nostrEventId: msg.nostrEventId ?? null,
          }
        }, groupId)
      )

      console.log("[debug] admin outer session debug:", adminOuterDebug)
      const adminOuterPubkey = adminOuterDebug?.ourCurrentPublicKey ?? null

      console.log(
        "[debug] relay kind-1060 events from admin session pubkey since save:",
        adminOuterPubkey,
        adminOuterPubkey
          ? await countRelayEvents({
              kinds: [1060],
              authors: [adminOuterPubkey],
              since: saveSinceSeconds,
            })
          : null
      )

      // Member: should receive the group, see admin badge, but not be able to edit.
      await pageB.goto(`/chats/group/${groupId}/details`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      // Session establishment + relay propagation can be slow under parallel e2e load.
      const deadline = Date.now() + 60000
      let observedTitle = ""
      while (Date.now() < deadline) {
        const notFound = await pageB
          .getByText("Group not found")
          .isVisible()
          .catch(() => false)
        if (notFound) {
          observedTitle = "Group not found"
        } else {
          const titleLocator = pageB.locator("div.text-2xl.font-bold").first()
          const hasTitle = (await titleLocator.count()) > 0
          if (!hasTitle) {
            observedTitle = ""
          } else {
            const title = await titleLocator.textContent({timeout: 1000}).catch(() => "")
            observedTitle = (title || "").trim()
          }
        }

        if (observedTitle === "Renamed Group") break
        await pageB.waitForTimeout(500)
      }

      // Debug: re-check publish status after waiting for relay propagation.

      console.log(
        "[debug] admin group latest message status (post-wait):",
        await pageA.evaluate(async (gid) => {
          const pmMod = await import("/src/stores/privateMessages.ts")
          const map = pmMod.usePrivateMessagesStore.getState().events.get(gid)
          if (!map) return null
          const last = map.last?.()
          const msg = last ? last[1] : null
          if (!msg) return null
          return {
            id: msg.id,
            kind: msg.kind,
            pubkey: msg.pubkey,
            ownerPubkey: msg.ownerPubkey,
            sentToRelays: msg.sentToRelays ?? false,
            nostrEventId: msg.nostrEventId ?? null,
          }
        }, groupId)
      )

      console.log(
        "[debug] member has group in store:",
        await pageB.evaluate(async (gid) => {
          const groupsMod = await import("/src/stores/groups.ts")
          const group = groupsMod.useGroupsStore.getState().groups[gid]

          const pmMod = await import("/src/stores/privateMessages.ts")
          const hasMessages = pmMod.usePrivateMessagesStore.getState().events.has(gid)

          return {
            group: group
              ? {members: group.members, admins: group.admins, name: group.name}
              : null,
            hasMessages,
          }
        }, groupId)
      )
      expect(observedTitle).toBe("Renamed Group")
      await expect(pageB.locator(".badge").getByText("Admin").first()).toBeVisible({
        timeout: 15000,
      })
      await expect(pageB.getByRole("button", {name: "Edit group"})).not.toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
