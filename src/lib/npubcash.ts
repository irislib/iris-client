import {AppEvent, Signer} from "@/lib/nostr"
import {nip19} from "nostr-tools"
import {nostr} from "@/utils/nostrClient"

const NIP98_KIND = 27235

export interface NPubCashQuote {
  mintUrl: string
  quoteId: string
  request: string
  amount: number
  state: "PAID" | "ISSUED" | "INFLIGHT"
  locked: boolean
  expiresAt: number
}

async function generateNip98Event(
  url: string,
  method: string,
  signer: Signer
): Promise<string> {
  const nip98Event = new AppEvent(nostr())
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

async function request<T>(signer: Signer, path: string, domain: string): Promise<T> {
  const url = new URL(path, `https://${domain}`)
  // npub.cash authenticates the origin and path, excluding pagination parameters.
  const auth = await generateNip98Event(`${url.origin}${url.pathname}`, "GET", signer)
  const response = await fetch(url, {
    headers: {Authorization: `Nostr ${auth}`},
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`npub.cash request failed (${response.status})`)
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("npub.cash returned an invalid response")
  }
  const body = await response.json()
  if (body.error || !body.data) throw new Error("npub.cash could not load payments")
  return body as T
}

export async function getNPubCashInfo(signer: Signer, domain = "npub.cash") {
  const body = await request<{
    data: {user: {pubkey: string; mintUrl: string; lockQuote: boolean}}
  }>(signer, "/api/v2/user/info", domain)
  return body.data.user
}

export async function getNPubCashQuotes(
  signer: Signer,
  domain = "npub.cash"
): Promise<NPubCashQuote[]> {
  const quotes = new Map<string, NPubCashQuote>()
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const body = await request<{
      data: {quotes: NPubCashQuote[]}
      metadata: {total: number; limit: number}
    }>(signer, `/api/v2/wallet/quotes?limit=50&offset=${offset}`, domain)
    const page = body.data.quotes
    if (
      !Array.isArray(page) ||
      !Number.isSafeInteger(body.metadata?.total) ||
      body.metadata.total < 0
    ) {
      throw new Error("npub.cash returned invalid payment history")
    }
    total = body.metadata.total
    for (const quote of page) {
      const mint = new URL(quote.mintUrl)
      if (
        (mint.protocol !== "https:" &&
          !(
            mint.protocol === "http:" &&
            ["127.0.0.1", "localhost"].includes(mint.hostname)
          )) ||
        mint.username ||
        mint.password ||
        !quote.quoteId ||
        !quote.request ||
        !Number.isSafeInteger(quote.amount) ||
        quote.amount <= 0 ||
        !Number.isFinite(quote.expiresAt) ||
        !["PAID", "ISSUED", "INFLIGHT"].includes(quote.state) ||
        typeof quote.locked !== "boolean"
      )
        throw new Error("npub.cash returned an invalid payment")
      quotes.set(`${quote.mintUrl}\0${quote.quoteId}`, quote)
    }
    offset += page.length
    if (!page.length && offset < total)
      throw new Error("npub.cash payment history is incomplete")
  }
  return [...quotes.values()]
}

export function getLightningAddress(pubkey: string, domain = "npub.cash"): string {
  return `${nip19.npubEncode(pubkey)}@${domain}`
}
