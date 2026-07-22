import {NDKEvent, NDKSigner} from "@/lib/ndk"
import {decode} from "light-bolt11-decoder"
import {nip19, type NostrEvent} from "nostr-tools"
import {makeZapRequest} from "nostr-tools/nip57"
import {ndk, DEFAULT_RELAYS} from "@/utils/ndk"
import {KIND_ZAP_RECEIPT} from "@/utils/constants"
import {bech32} from "@scure/base"
import {NDKSubscriptionCacheUsage} from "@/lib/ndk/subscription"
import debug from "debug"

const log = debug("iris:zapUtils")

export function getZappingUser(event: NDKEvent, npub = true) {
  const description = event.tags?.find((t) => t[0] === "description")?.[1]
  if (!description) {
    return null
  }
  let obj
  try {
    obj = JSON.parse(description)
  } catch (e) {
    return null
  }
  if (npub) {
    nip19.npubEncode(obj.pubkey)
  }
  return obj.pubkey
}

export async function getZapAmount(event: NDKEvent) {
  const invoice = event.tagValue("bolt11")
  if (invoice) {
    const decodedInvoice = decode(invoice)
    const amountSection = decodedInvoice.sections.find(
      (section: {name: string}) => section.name === "amount"
    )
    if (amountSection && "value" in amountSection) {
      // Convert millisatoshis to bits
      return Math.floor(parseInt(amountSection.value) / 1000)
    }
  }
  return 0
}

export const fetchZappedAmount = async (event: NDKEvent): Promise<number> => {
  return new Promise((resolve) => {
    let zappedAmount = 0
    const filter = {
      kinds: [KIND_ZAP_RECEIPT],
      ["#e"]: [event.id],
    }
    try {
      const sub = ndk().subscribe(filter)

      sub?.on("event", async (event) => {
        const invoice = event.tagValue("bolt11")
        if (invoice) {
          const decodedInvoice = decode(invoice)
          const amountSection = decodedInvoice.sections.find(
            (section: {name: string}) => section.name === "amount"
          )
          if (amountSection && "value" in amountSection) {
            // Convert millisatoshis to bits
            zappedAmount = zappedAmount + Math.floor(parseInt(amountSection.value) / 1000)
          }
        }
      })
      sub?.on("eose", () => {
        sub?.stop()
        resolve(zappedAmount)
      })
    } catch (error) {
      console.warn(error)
    }
  })
}

/**
 * Creates a zap invoice manually by fetching LNURL data and creating a zap request
 * @param target - Either {event: NDKEvent} for event zap or {pubkey: string} for profile zap
 * @param amountMsats - Amount in millisatoshis
 * @param comment - Optional zap comment
 * @param lud16 - Lightning address (e.g. user@domain.com)
 * @param signer - NDK signer to sign the zap request
 * @param isDonation - If true, adds "irisdonation" tag to the zap request
 * @returns Lightning invoice string
 */
async function createZapInvoiceInternal(
  target: {event: NDKEvent} | {pubkey: string},
  amountMsats: number,
  comment: string,
  lud16: string,
  signer: NDKSigner,
  isDonation = false
): Promise<string> {
  // Fetch LNURL data
  const [name, domain] = lud16.split("@")
  const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${name}`

  const lnurlResponse = await fetch(lnurlEndpoint)
  if (!lnurlResponse.ok) {
    throw new Error(`Failed to fetch LNURL endpoint: ${lnurlResponse.status}`)
  }

  const lnurlData = await lnurlResponse.json()

  if (!lnurlData.allowsNostr) {
    throw new Error("This lightning address doesn't support Nostr zaps")
  }

  // Get relays from NDK pool or use defaults
  const ndkInstance = ndk()
  const connectedRelays = ndkInstance.pool?.connectedRelays()?.map((r) => r.url) || []
  const relaysToUse = connectedRelays.length > 0 ? connectedRelays : DEFAULT_RELAYS

  // Create zap request (event or profile)
  let zapRequest
  if ("event" in target) {
    const rawEvent = target.event.rawEvent ? target.event.rawEvent() : target.event
    zapRequest = makeZapRequest({
      event: rawEvent as NostrEvent,
      amount: amountMsats,
      comment: comment || "",
      relays: relaysToUse.slice(0, 4),
    })
  } else {
    zapRequest = makeZapRequest({
      pubkey: target.pubkey,
      amount: amountMsats,
      comment: comment || "",
      relays: relaysToUse.slice(0, 4),
    })
  }

  // Add donation tag if this is a donation zap
  if (isDonation) {
    if (!zapRequest.tags) {
      zapRequest.tags = []
    }
    zapRequest.tags.push(["t", "irisdonation"])
  }

  // Sign the zap request
  const zapRequestEvent = new NDKEvent(ndk(), zapRequest)
  await zapRequestEvent.sign(signer)

  // Get the invoice from the LNURL endpoint
  const invoiceUrl = new URL(lnurlData.callback)
  invoiceUrl.searchParams.append("amount", amountMsats.toString())
  invoiceUrl.searchParams.append("nostr", JSON.stringify(zapRequestEvent.rawEvent()))

  const invoiceResponse = await fetch(invoiceUrl.toString())
  if (!invoiceResponse.ok) {
    throw new Error(`Failed to fetch invoice: ${invoiceResponse.status}`)
  }

  const invoiceData = await invoiceResponse.json()
  const invoice = invoiceData.pr

  if (!invoice) {
    throw new Error("No invoice returned from LNURL endpoint")
  }

  return invoice
}

/**
 * Creates a zap invoice for an event
 * @param event - The event to zap
 * @param amountMsats - Amount in millisatoshis
 * @param comment - Optional zap comment
 * @param lud16 - Lightning address (e.g. user@domain.com)
 * @param signer - NDK signer to sign the zap request
 * @returns Lightning invoice string
 */
export async function createZapInvoice(
  event: NDKEvent,
  amountMsats: number,
  comment: string,
  lud16: string,
  signer: NDKSigner
): Promise<string> {
  return createZapInvoiceInternal({event}, amountMsats, comment, lud16, signer)
}

/**
 * Create and publish a zap request, then get the invoice
 * This combines creating the zap with publishing it to relays
 */
export async function createAndPublishZapInvoice(
  event: NDKEvent,
  amountMsats: number,
  comment: string,
  lud16: string,
  signer: NDKSigner
): Promise<string> {
  // Parse lightning address
  const [name, domain] = lud16.split("@")
  if (!name || !domain) {
    throw new Error("Invalid lightning address format")
  }

  const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${name}`

  const lnurlResponse = await fetch(lnurlEndpoint)
  if (!lnurlResponse.ok) {
    throw new Error(`Failed to fetch LNURL endpoint: ${lnurlResponse.status}`)
  }

  const lnurlData = await lnurlResponse.json()

  if (!lnurlData.allowsNostr) {
    throw new Error("This lightning address doesn't support Nostr zaps")
  }

  // Get relays from NDK pool or use defaults
  const ndkInstance = ndk()
  const connectedRelays = ndkInstance.pool?.connectedRelays()?.map((r) => r.url) || []
  const relaysToUse = connectedRelays.length > 0 ? connectedRelays : DEFAULT_RELAYS

  // Get the raw event which has all required properties
  const rawEvent = event.rawEvent ? event.rawEvent() : event

  // Create event zap request (not profile zap)
  const zapRequest = makeZapRequest({
    event: rawEvent as NostrEvent, // nostr-tools expects Event type
    amount: amountMsats, // nostr-tools expects number, not string
    comment: comment || "",
    relays: relaysToUse.slice(0, 4), // Use first 4 relays as per NIP-57
  })

  // Sign and PUBLISH the zap request
  const zapRequestEvent = new NDKEvent(ndk(), zapRequest)
  await zapRequestEvent.sign(signer)
  // Fire and forget - don't await relay confirmation for zap requests
  zapRequestEvent.publish().catch((err) => {
    console.warn("Zap request publish warning (non-fatal):", err)
  })

  // Get the invoice from the LNURL endpoint
  const invoiceUrl = new URL(lnurlData.callback)
  invoiceUrl.searchParams.append("amount", amountMsats.toString())
  invoiceUrl.searchParams.append("nostr", JSON.stringify(zapRequestEvent.rawEvent()))

  const invoiceResponse = await fetch(invoiceUrl.toString())
  if (!invoiceResponse.ok) {
    throw new Error(`Failed to fetch invoice: ${invoiceResponse.status}`)
  }

  const invoiceData = await invoiceResponse.json()
  const invoice = invoiceData.pr

  if (!invoice) {
    throw new Error("No invoice returned from LNURL endpoint")
  }

  return invoice
}

export interface ZapInfo {
  id: string
  amount: number
  pubkey: string
  comment: string
  event: NDKEvent
  bolt11?: string // invoice for deduplication
}

/**
 * Parse a zap receipt event (kind 9735) into structured data
 */
export function parseZapReceipt(zapEvent: NDKEvent): ZapInfo | null {
  const invoice = zapEvent.tagValue("bolt11")
  if (!invoice) return null

  try {
    const decodedInvoice = decode(invoice)
    const amountSection = decodedInvoice.sections.find(
      (section: {name: string}) => section.name === "amount"
    )

    if (!amountSection || !("value" in amountSection)) return null

    const amount = Math.floor(parseInt(amountSection.value) / 1000)
    const zappingUser = getZappingUser(zapEvent)

    // Extract comment from description tag
    let comment = ""
    const description = zapEvent.tagValue("description")
    if (description) {
      try {
        const descEvent = JSON.parse(description)
        comment = descEvent.content || ""
      } catch {
        // Ignore parse errors
      }
    }

    return {
      id: zapEvent.id,
      amount,
      pubkey: zappingUser,
      comment,
      event: zapEvent,
      bolt11: invoice,
    }
  } catch (error) {
    console.warn("Failed to parse zap receipt:", error)
    return null
  }
}

/**
 * Calculate total zap amount from a map of zaps grouped by user
 */
export function calculateTotalZapAmount(zapsByUser: Map<string, ZapInfo[]>): number {
  let total = 0
  for (const userZaps of zapsByUser.values()) {
    for (const zap of userZaps) {
      total += zap.amount
    }
  }
  return total
}

/**
 * Group zaps by user and accumulate amounts
 */
export function groupZapsByUser(
  zaps: ZapInfo[]
): Map<string, {totalAmount: number; zaps: ZapInfo[]}> {
  const grouped = new Map<string, {totalAmount: number; zaps: ZapInfo[]}>()

  for (const zap of zaps) {
    const existing = grouped.get(zap.pubkey)
    if (existing) {
      existing.totalAmount += zap.amount
      existing.zaps.push(zap)
    } else {
      grouped.set(zap.pubkey, {
        totalAmount: zap.amount,
        zaps: [zap],
      })
    }
  }

  return grouped
}

/**
 * Decode bech32 LNURL to https URL
 */
function decodeLNURL(lnurl: string): string {
  const decoded = bech32.decodeToBytes(lnurl)
  return new TextDecoder().decode(decoded.bytes)
}

/**
 * Get invoice from lightning address or LNURL with optional comment
 */
export async function getLNURLInvoice(
  input: string,
  amountSats: number,
  comment?: string
): Promise<string> {
  let lnurlEndpoint: string

  // Check if it's a bech32 LNURL
  if (input.toLowerCase().startsWith("lnurl")) {
    lnurlEndpoint = decodeLNURL(input)
  } else {
    // Lightning address format
    const [name, domain] = input.split("@")
    if (!name || !domain) {
      throw new Error("Invalid lightning address format")
    }
    lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${name}`
  }

  const lnurlResponse = await fetch(lnurlEndpoint)
  if (!lnurlResponse.ok) {
    throw new Error(`Failed to fetch LNURL endpoint: ${lnurlResponse.status}`)
  }

  const lnurlData = await lnurlResponse.json()

  const amountMsats = amountSats * 1000
  if (lnurlData.minSendable && amountMsats < lnurlData.minSendable) {
    throw new Error(
      `Amount ${amountSats} is below minimum ${lnurlData.minSendable / 1000} bits`
    )
  }
  if (lnurlData.maxSendable && amountMsats > lnurlData.maxSendable) {
    throw new Error(
      `Amount ${amountSats} exceeds maximum ${lnurlData.maxSendable / 1000} bits`
    )
  }

  const invoiceUrl = new URL(lnurlData.callback)
  invoiceUrl.searchParams.append("amount", amountMsats.toString())

  // Add comment if supported
  const maxCommentLength = lnurlData.commentAllowed || 0
  if (comment && maxCommentLength > 0) {
    const truncated = comment.slice(0, maxCommentLength)
    invoiceUrl.searchParams.append("comment", truncated)
    if (comment.length > maxCommentLength) {
      console.warn(
        `Comment truncated from ${comment.length} to ${maxCommentLength} chars`
      )
    }
  }

  const invoiceResponse = await fetch(invoiceUrl.toString())
  if (!invoiceResponse.ok) {
    throw new Error(`Failed to fetch invoice: ${invoiceResponse.status}`)
  }

  const invoiceData = await invoiceResponse.json()
  if (invoiceData.status === "ERROR") {
    throw new Error(invoiceData.reason || "LNURL server returned error")
  }

  if (!invoiceData.pr) {
    throw new Error("No invoice returned from LNURL endpoint")
  }

  return invoiceData.pr
}

/**
 * Calculate donation splits for multiple recipients
 * @param baseAmount - Original zap amount in bits (satoshis)
 * @param recipients - Array of recipients with their percentages
 * @param minAmount - Minimum donation amount in bits (default 1)
 * @returns Array of donation amounts for each recipient
 */
export function calculateMultiRecipientDonations(
  baseAmount: number,
  recipients: Array<{recipient: string; percentage: number}>,
  minAmount: number = 1
): Array<{recipient: string; amount: number}> {
  return recipients.map((r) => {
    const donationFromPercentage = Math.floor((baseAmount * r.percentage) / 100)
    const amount = Math.max(donationFromPercentage, minAmount)
    return {
      recipient: r.recipient,
      amount,
    }
  })
}

/**
 * Send donation zaps to multiple recipients
 * Handles both npub and lightning address recipients
 * - For npub: Creates profile zap to the donation recipient
 * - For lightning address: Sends regular Lightning payment (no zap event)
 * @param donations - Array of recipients with amounts to send
 * @param signer - NDK signer
 * @param originalEvent - The event that was zapped (unused, kept for compatibility)
 * @param sendPayment - Function to send payment (from wallet provider)
 * @returns Promise that resolves when all donations are processed
 */
export async function sendDonationZaps(
  donations: Array<{recipient: string; amount: number}>,
  signer: NDKSigner,
  originalEvent: NDKEvent,
  sendPayment: (invoice: string) => Promise<{preimage?: string} | void>
): Promise<void> {
  const {nip19} = await import("nostr-tools")

  log("💝 DONATION ZAPS: Starting", donations)

  for (const donation of donations) {
    try {
      let lightningAddress: string | null = null
      let recipientPubkey: string | null = null

      // Detect if recipient is npub or lightning address
      if (donation.recipient.startsWith("npub")) {
        // Convert npub to pubkey and fetch profile for lightning address
        const decoded = nip19.decode(donation.recipient)
        if (decoded.type === "npub") {
          recipientPubkey = decoded.data
          log("💝 DONATION: Decoded npub to pubkey:", recipientPubkey)
          // Fetch profile to get lightning address - force relay fetch
          const ndkInstance = ndk()
          const user = ndkInstance.getUser({pubkey: recipientPubkey})
          await user.fetchProfile({cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY})
          log("💝 DONATION: Full profile:", user.profile)
          lightningAddress = user.profile?.lud16 || user.profile?.lud06 || null
          log("💝 DONATION: Lightning address:", lightningAddress)
        }
      } else if (donation.recipient.includes("@")) {
        // Direct lightning address - just send payment, no zap
        lightningAddress = donation.recipient
        log("💝 DONATION: Direct lightning address:", lightningAddress)
      }

      if (!lightningAddress) {
        log(
          `💝 DONATION: No lightning address found for recipient: ${donation.recipient}`
        )
        continue
      }

      const amountMsats = donation.amount * 1000

      // For npub recipients: create profile zap
      // For lightning addresses: get regular invoice
      let invoice: string
      if (recipientPubkey) {
        log("💝 DONATION: Creating donation zap invoice for pubkey:", recipientPubkey)
        invoice = await createZapInvoiceInternal(
          {pubkey: recipientPubkey},
          amountMsats,
          `donation via iris.to`,
          lightningAddress,
          signer,
          true // Mark as donation zap
        )
        log("💝 DONATION: Created zap invoice:", invoice.slice(0, 50) + "...")
      } else {
        // Regular lightning payment (no zap event)
        log("💝 DONATION: Creating regular invoice for address:", lightningAddress)
        invoice = await getLNURLInvoice(
          lightningAddress,
          donation.amount,
          `donation via iris.to`
        )
        log("💝 DONATION: Created regular invoice:", invoice.slice(0, 50) + "...")
      }

      // Send payment
      log("💝 DONATION: Sending payment...")
      await sendPayment(invoice)
      log("💝 DONATION: Payment sent successfully")
    } catch (error) {
      log(`💝 DONATION: Failed to send donation to ${donation.recipient}:`, error)
      // Continue with other donations even if one fails
    }
  }

  log("💝 DONATION ZAPS: Completed all donations")
}
