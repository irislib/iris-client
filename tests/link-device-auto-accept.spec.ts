import {test, expect} from "@playwright/test"
import {generateSecretKey, getPublicKey} from "nostr-tools"
import {bytesToHex} from "@noble/hashes/utils"
import {signUp} from "./auth.setup"

test("link device invite auto-accepts on paste", async ({page}) => {
  const {publicKey} = await signUp(page)

  await page.goto("/chats/new/devices")
  await page.waitForLoadState("domcontentloaded")

  const openButton = page.getByRole("button", {name: "Link another device"})
  await expect(openButton).toBeVisible({timeout: 10000})
  await openButton.click()

  await expect(page.getByRole("heading", {name: "Link another device"})).toBeVisible({
    timeout: 10000,
  })

  const inviterPubkey = getPublicKey(generateSecretKey())
  const ephemeralKey = getPublicKey(generateSecretKey())
  const sharedSecret = bytesToHex(generateSecretKey())
  const invitePayload = {
    inviter: inviterPubkey,
    ephemeralKey,
    sharedSecret,
    purpose: "link",
    owner: publicKey,
  }
  const inviteUrl = `https://iris.to/#${encodeURIComponent(
    JSON.stringify(invitePayload)
  )}`

  const input = page.getByPlaceholder("Paste link invite")
  await input.fill(inviteUrl)

  await expect(page.getByText("Linking...")).toBeVisible({timeout: 5000})
})
