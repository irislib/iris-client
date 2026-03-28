import {NDKEvent} from "@/lib/ndk"
import {ImetaTag} from "@/stores/draft"
import {getEventRoot} from "@/utils/nostr"
import {extractHashtags} from "./hashtags"
import {KIND_CLASSIFIED} from "@/utils/constants"

export function buildReplyTags(replyingTo: NDKEvent, myPubKey: string): string[][] {
  const tags: string[][] = []
  const rootEvent = getEventRoot(replyingTo) || replyingTo.id

  tags.push(["e", rootEvent, "", "root"])
  tags.push(["e", replyingTo.id, "", "reply"])

  const pTags = new Set<string>()
  pTags.add(replyingTo.pubkey)

  replyingTo.tags.filter((tag) => tag[0] === "p").forEach((tag) => pTags.add(tag[1]))

  pTags.forEach((pubkey) => {
    if (pubkey !== myPubKey) {
      tags.push(["p", pubkey])
    }
  })

  return tags
}

export function buildQuoteTags(
  quotedEvent: NDKEvent,
  myPubKey: string,
  existingTags: string[][]
): string[][] {
  const tags: string[][] = []

  tags.push(["q", quotedEvent.id])

  if (
    quotedEvent.pubkey !== myPubKey &&
    !existingTags.some((tag) => tag[0] === "p" && tag[1] === quotedEvent.pubkey)
  ) {
    tags.push(["p", quotedEvent.pubkey])
  }

  return tags
}

export function buildImetaTags(imeta: ImetaTag[]): string[][] {
  const tags: string[][] = []

  imeta.forEach((tag) => {
    const imetaTag = ["imeta"]
    if (tag.url) imetaTag.push(`url ${tag.url}`)
    if (tag.width && tag.height) imetaTag.push(`dim ${tag.width}x${tag.height}`)
    if (tag.blurhash) imetaTag.push(`blurhash ${tag.blurhash}`)
    if (tag.alt) imetaTag.push(`alt ${tag.alt}`)
    if (tag.m) imetaTag.push(`m ${tag.m}`)
    if (tag.x) imetaTag.push(`x ${tag.x}`)
    if (tag.size) imetaTag.push(`size ${tag.size}`)
    if (tag.dim) imetaTag.push(`dim ${tag.dim}`)
    if (tag.fallback) {
      tag.fallback.forEach((fb) => imetaTag.push(`fallback ${fb}`))
    }
    if (imetaTag.length > 1) {
      tags.push(imetaTag)
    }
  })

  return tags
}

export function buildGeohashTags(gTags: string[]): string[][] {
  return gTags.map((hash) => ["g", hash])
}

export function buildHashtagTags(text: string): string[][] {
  const hashtags = extractHashtags(text)
  return hashtags.map((hashtag) => ["t", hashtag])
}

export function buildExpirationTag(expirationDelta: number): string[] {
  const now = Math.floor(Date.now() / 1000)
  const expirationTimestamp = now + expirationDelta
  return ["expiration", expirationTimestamp.toString()]
}

export function buildMarketListingTags(
  title: string,
  price: {amount: string; currency: string; frequency?: string},
  imeta: ImetaTag[]
): string[][] {
  const tags: string[][] = []

  if (title) {
    tags.push(["title", title])
  }

  if (price.amount) {
    const priceTag = ["price", price.amount, price.currency]
    if (price.frequency) {
      priceTag.push(price.frequency)
    }
    tags.push(priceTag)
  }

  if (imeta.length > 0 && imeta[0].url) {
    tags.push(["image", imeta[0].url])
  }

  return tags
}

interface BuildEventTagsParams {
  replyingTo?: NDKEvent
  quotedEvent?: NDKEvent
  initialTags?: string[][]
  includeReplyTags?: boolean
  imeta: ImetaTag[]
  gTags?: string[]
  text: string
  expirationDelta: number | null
  eventKind: number
  title: string
  price: {amount: string; currency: string; frequency?: string}
  myPubKey: string
}

export function buildEventTags(params: BuildEventTagsParams): string[][] {
  const tags: string[][] = params.initialTags
    ? params.initialTags.map((tag) => [...tag])
    : []

  if (params.replyingTo && params.includeReplyTags !== false) {
    tags.push(...buildReplyTags(params.replyingTo, params.myPubKey))
  }

  if (params.quotedEvent) {
    tags.push(...buildQuoteTags(params.quotedEvent, params.myPubKey, tags))
  }

  tags.push(...buildImetaTags(params.imeta))

  if (params.gTags && params.gTags.length > 0) {
    tags.push(...buildGeohashTags(params.gTags))
  }

  tags.push(...buildHashtagTags(params.text))

  if (params.expirationDelta) {
    tags.push(buildExpirationTag(params.expirationDelta))
  }

  if (params.eventKind === KIND_CLASSIFIED) {
    tags.push(...buildMarketListingTags(params.title, params.price, params.imeta))
  }

  return tags
}
