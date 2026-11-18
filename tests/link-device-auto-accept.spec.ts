import {test, expect} from "./fixtures/isolatedBrowser"
import {generateSecretKey, getPublicKey} from "nostr-tools"
import {METADATA_PRIVACY_VERSION} from "nostr-double-ratchet"
import {bytesToHex} from "@noble/hashes/utils.js"
import {signUp} from "./auth.setup"
import {usingBuiltDist} from "./utils/built-dist"

test.skip(
  usingBuiltDist && process.env.IRIS_E2E_LOCAL_RELAY !== "true",
  "requires local-relay private messaging device setup"
)

test("link device invite auto-accepts on paste", async ({page}) => {
  const {publicKey} = await signUp(page)

  await page.goto("/settings/devices")
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
    version: METADATA_PRIVACY_VERSION,
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
