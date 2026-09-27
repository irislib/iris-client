import type {NDKEvent} from "@/lib/ndk"

/** Compile once per query; relay search semantics are not consistent. */
export function createPostSearchMatcher(query: string) {
  const terms = query.normalize("NFC").trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hashtags = terms
    .filter((term) => term.startsWith("#"))
    .map((term) => term.slice(1))
  const words = terms
    .filter((term) => !term.startsWith("#"))
    .map((term) => {
      const literal = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return new RegExp(
        `(?<![\\p{L}\\p{M}\\p{N}_])${literal}(?![\\p{L}\\p{M}\\p{N}_])`,
        "u"
      )
    })
  return (event: Pick<NDKEvent, "content" | "tags">) => {
    const content = (event.content || "").normalize("NFC").toLowerCase()
    return (
      words.every((word) => word.test(content)) &&
      hashtags.every((hashtag) =>
        event.tags.some(
          (tag) => tag[0] === "t" && tag[1]?.normalize("NFC").toLowerCase() === hashtag
        )
      )
    )
  }
}

/** Keep existing rows stable, then append the newest unseen author matches. */
export function uniqueSearchAuthors<T extends {pubkey: string}>(
  events: Iterable<T>
): T[] {
  const authors = new Set<string>()
  return Array.from(events).filter((event) => {
    if (authors.has(event.pubkey)) return false
    authors.add(event.pubkey)
    return true
  })
}
