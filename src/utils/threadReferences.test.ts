import {beforeAll, describe, expect, it} from "vitest"
import {matchFilter} from "nostr-tools"
import NostrClient, {AppEvent, SecretKeySigner, type NostrEvent} from "@/lib/nostr"
import {
  buildReplySubscriptionFilters,
  getEventReplyReference,
  getEventRootReference,
  getThreadReferenceRoute,
} from "./threadReferences"

const nostr = new NostrClient()
nostr.signer = SecretKeySigner.generate()

describe("threadReferences", () => {
  let note: AppEvent
  let article: AppEvent
  let articleReply: AppEvent
  let nestedArticleReply: AppEvent

  beforeAll(async () => {
    note = new AppEvent(nostr, {
      kind: 1,
      content: "root note",
    } as NostrEvent)
    await note.sign()

    article = new AppEvent(nostr, {
      kind: 30023,
      content: "root article",
      tags: [["d", "article-slug"]],
    } as NostrEvent)
    await article.sign()

    articleReply = article.reply()
    articleReply.content = "reply to article"
    await articleReply.sign()

    nestedArticleReply = articleReply.reply()
    nestedArticleReply.content = "reply to article reply"
    await nestedArticleReply.sign()
  })

  it("returns the direct reply reference for generic replies", () => {
    expect(getEventReplyReference(articleReply)).toBe(article.tagId())
    expect(getEventReplyReference(nestedArticleReply)).toBe(articleReply.id)
  })

  it("returns the thread root reference for nested generic replies", () => {
    expect(getEventRootReference(nestedArticleReply)).toBe(article.tagId())
  })

  it("builds route paths for note ids and address references", () => {
    expect(getThreadReferenceRoute(note.id)).toMatch(/^\/note1/)
    expect(getThreadReferenceRoute(article.tagId())).toMatch(/^\/naddr1/)
  })

  it("builds reply subscription filters that match generic replies to addressable roots", () => {
    const filters = buildReplySubscriptionFilters(article)
    const rawReply = articleReply.rawEvent()
    const rawNestedReply = nestedArticleReply.rawEvent()

    expect(filters.some((filter) => matchFilter(filter, rawReply))).toBe(true)
    expect(filters.some((filter) => matchFilter(filter, rawNestedReply))).toBe(true)
  })
})
