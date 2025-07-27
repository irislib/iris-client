import {NostrEvent} from "nostr-tools"
import {formatAmount} from "@/utils/utils"
import {getTagValue} from "@/utils/nostr"

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  INR: "₹",
  RUB: "₽",
  KRW: "₩",
  BTC: "₿",
}

/**
 * Formats a price tag for display
 */
export const formatPrice = (priceTag: string[]) => {
  const amount = priceTag[1]
  const currency = priceTag[2]?.toUpperCase() || ""
  const frequency = priceTag[3] || ""
  const symbol = CURRENCY_SYMBOLS[currency]
  const parsedPrice = parseInt(amount)

  if (!isNaN(parsedPrice)) {
    if (currency === "SATS" || currency === "SAT") {
      return `${formatAmount(parsedPrice)} sats${frequency ? `/ ${frequency}` : ""}`
    }
    return symbol
      ? `${symbol}${formatAmount(parsedPrice)}${frequency ? `/ ${frequency}` : ""}`
      : `${formatAmount(parsedPrice)} ${currency}${frequency ? `/ ${frequency}` : ""}`
  }
  return `${amount} ${currency}${frequency ? `/ ${frequency}` : ""}`
}

/**
 * Extracts market listing data from an NostrEvent
 */
export const extractMarketData = (event: NostrEvent) => {
  const title = getTagValue(event, "title")
  const priceTag = event?.tags?.find((tag) => tag[0] === "price")
  const price = priceTag ? formatPrice(priceTag) : null
  const imageTag = event?.tags?.find((tag) => tag[0] === "image")
  const imageUrl = imageTag ? imageTag[1] : null
  const summary = getTagValue(event, "summary") || event?.content || ""
  const cleanSummary = imageUrl ? summary.replace(imageUrl, "").trim() : summary

  return {
    title,
    price,
    imageUrl,
    summary: cleanSummary,
    content: event?.content || "",
    tags: event?.tags?.filter((tag) => tag[0] !== "title") || [],
  }
}

/**
 * Gets all image URLs from a market listing
 */
export const getMarketImageUrls = (event: NostrEvent) => {
  if (!isMarketListing(event)) return []
  return event.tags.filter((tag) => tag[0] === "image").map((tag) => tag[1])
}

/**
 * Formats a tag value for display
 */
export const formatTagValue = (tag: string[]) => {
  if (tag[0] === "price") {
    return formatPrice(tag)
  }
  return tag[1]
}

/**
 * Checks if an event is a market listing
 */
export const isMarketListing = (event: NostrEvent) => {
  return event.kind === 30402
}
