import {NDKEvent, NDKSigner} from "@/lib/ndk"
import {nip19} from "nostr-tools"
import {ndk} from "@/utils/ndk"

const NIP98_KIND = 27235

interface NPubCashInfo {
  mintUrl: string
  npub: string
  username: string
  error?: string
}

interface NPubCashBalance {
  error?: string
  data: number
}

interface NPubCashClaim {
  error?: string
  data: {
    token: string
  }
}

async function generateNip98Event(
  url: string,
  method: string,
  signer: NDKSigner
): Promise<string> {
  const nip98Event = new NDKEvent(ndk())
  nip98Event.kind = NIP98_KIND
  nip98Event.content = ""
  nip98Event.tags = [
    ["u", url],
    ["method", method],
  ]

  await nip98Event.sign(signer)
  const eventString = JSON.stringify(nip98Event.rawEvent())
  return btoa(eventString)
}

export async function getNPubCashInfo(
  signer: NDKSigner,
  domain = "npub.cash"
): Promise<NPubCashInfo | null> {
  const baseURL = `https://${domain}`
  const authHeader = await generateNip98Event(`${baseURL}/api/v1/info`, "GET", signer)

  try {
    const response = await fetch(`${baseURL}/api/v1/info`, {
      method: "GET",
      headers: {
        Authorization: `Nostr ${authHeader}`,
      },
    })
    const info: NPubCashInfo = await response.json()
    return info
  } catch (error) {
    console.error("Failed to get npub.cash info:", error)
    return null
  }
}

export async function getNPubCashBalance(
  signer: NDKSigner,
  domain = "npub.cash"
): Promise<number> {
  const baseURL = `https://${domain}`
  const authHeader = await generateNip98Event(`${baseURL}/api/v1/balance`, "GET", signer)

  try {
    const response = await fetch(`${baseURL}/api/v1/balance`, {
      method: "GET",
      headers: {
        Authorization: `Nostr ${authHeader}`,
      },
    })
    const balance: NPubCashBalance = await response.json()
    if (balance.error) {
      return 0
    }
    return balance.data
  } catch (error) {
    console.error("Failed to get npub.cash balance:", error)
    return 0
  }
}

export async function claimNPubCashTokens(
  signer: NDKSigner,
  domain = "npub.cash"
): Promise<string | null> {
  const baseURL = `https://${domain}`
  const authHeader = await generateNip98Event(`${baseURL}/api/v1/claim`, "GET", signer)

  try {
    const response = await fetch(`${baseURL}/api/v1/claim`, {
      method: "GET",
      headers: {
        Authorization: `Nostr ${authHeader}`,
      },
    })
    const claim: NPubCashClaim = await response.json()
    if (claim.error) {
      console.error("Claim error:", claim.error)
      return null
    }
    return claim.data.token
  } catch (error) {
    console.error("Failed to claim npub.cash tokens:", error)
    return null
  }
}

export function getLightningAddress(pubkey: string, domain = "npub.cash"): string {
  const npub = nip19.npubEncode(pubkey)
  return `${npub}@${domain}`
}

export async function extractMintFromToken(tokenString: string): Promise<string | null> {
  try {
    const {getTokenMetadata} = await import("@cashu/cashu-ts")
    return getTokenMetadata(tokenString).mint || null
  } catch (error) {
    console.error("Failed to extract mint from token:", error)
    return null
  }
}
