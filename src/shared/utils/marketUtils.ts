import {AppEvent} from "@/lib/nostr"
import {formatAmount} from "@/utils/utils"
import {KIND_CLASSIFIED} from "@/utils/constants"
import {marketStore} from "@/stores/marketstore"

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
      return `${formatAmount(parsedPrice)}₿${frequency ? `/ ${frequency}` : ""}`
    }
    return symbol
      ? `${symbol}${formatAmount(parsedPrice)}${frequency ? `/ ${frequency}` : ""}`
      : `${formatAmount(parsedPrice)} ${currency}${frequency ? `/ ${frequency}` : ""}`
  }
  return `${amount} ${currency}${frequency ? `/ ${frequency}` : ""}`
}

/**
 * Extracts market listing data from an AppEvent
 */
export const extractMarketData = (event: AppEvent) => {
  const title = event?.tagValue("title")
  const priceTag = event?.tags?.find((tag) => tag[0] === "price")
  const price = priceTag ? formatPrice(priceTag) : null
  const imageTag = event?.tags?.find((tag) => tag[0] === "image")
  const imageUrl = imageTag ? imageTag[1] : null
  const summary = event?.tagValue("summary") || event?.content || ""
  const cleanSummary = imageUrl ? summary.replace(imageUrl, "").trim() : summary

  // Extract and track "t" tags (categories)
  const tTags = event?.tags?.filter((tag) => tag[0] === "t" && tag[1]) || []
  if (tTags.length > 0) {
    marketStore.addTags(
      tTags.map((tag) => tag[1]),
      event.pubkey
    )
  }

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
export const isMarketListing = (event: AppEvent) => {
  return event.kind === KIND_CLASSIFIED
}
