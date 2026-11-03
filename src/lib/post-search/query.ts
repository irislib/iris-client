export const stopWords = new Set(
  "a about an and are as at be by can could describing did do does find for from had has have how i in into is it looking me my of on or post posts search show someone that the their there this to was what where which who with would".split(
    " "
  )
)

export const words = (s: string): string[] =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}_]+/gu) || []
const unique = (values: string[]) => [...new Set(values)]

export function planPostSearch(query: string) {
  const text = query.trim().slice(0, 500)
  const hashtags = unique(
    Array.from(text.matchAll(/(?:^|\s)#([\p{L}\p{M}\p{N}_]+)/gu), (m) => m[1])
  )
  const plain = text.replace(/(?:^|\s)#[\p{L}\p{M}\p{N}_]+/gu, " ").trim()
  const request = plain.replace(
    /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:(?:show|find|give|recommend)\s+(?:me|us)|i(?:'m| am) looking for)\s+(?:some\s+)?/i,
    ""
  )
  const about = request.replace(
    /^(?:(?:please\s+)?(?:find|show|recommend)\s+)?(?:(?:a|an|some|any|cool|great|good|interesting)\s+)*(?:posts?|notes?|threads?)\s+(?:about|on|related to)\s+/i,
    ""
  )
  let subject = about.replace(/[-\s]+related\s+(?:posts?|notes?|threads?)[.!?]*$/i, "")
  if (request !== plain)
    subject = subject.replace(/\s+(?:posts|notes|threads)[.!?]*$/i, "")
  const browse = !!subject && (subject !== plain || request !== plain)
  subject = subject || plain
  // Keep ambiguous modifiers in the phrase ("cool jazz"), but don't spend a
  // relay subscription on a request for "cool" when there is a specific subject.
  const focus =
    browse && about === request
      ? subject.replace(/^(?:(?:cool|interesting|great|good|awesome)\s+)+/i, "")
      : subject
  const tokens = unique(words(focus))
  const important = tokens.filter((t) => !stopWords.has(t))
  const terms = important.length ? important : tokens
  const anchors = [...terms].sort((a, b) => b.length - a.length).slice(0, 4)
  return {
    text,
    terms,
    anchors,
    hashtags,
    browse,
    phrase: words(focus).join(" "),
    relayQuery: browse ? focus : subject,
    modelQuery: browse ? focus : text,
  }
}

export type SearchPlan = ReturnType<typeof planPostSearch>

export type FilterHints = {tags: string[]; observed: string[][]}

export function collectFilterHints(
  events: {content: string; tags: string[][]}[],
  known: string[]
): FilterHints {
  const tags = new Set<string>()
  const observed: string[][] = []
  for (const event of events.slice(0, 48)) {
    for (const [name, value] of event.tags.slice(0, 32))
      if (name === "t" && value) tags.add(value)
    const tokens = unique(words(event.content.slice(0, 480))).filter(
      (t) => t.length >= 3 && t.length <= 40 && !stopWords.has(t)
    )
    observed.push(tokens.slice(0, 32))
  }
  return {
    tags: [...new Set([...tags, ...known])]
      .filter((t) => /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_ -]{1,38}$/u.test(t))
      .slice(0, 128),
    observed,
  }
}
