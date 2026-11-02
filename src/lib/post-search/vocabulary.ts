// Use whole words from the pinned tokenizer, supplemented with network terminology
// absent from its older vocabulary. The index contains no users or search history.
export function searchVocabulary(vocab: Record<string, number>) {
  const words = Object.keys(vocab)
    .filter((t) => /^[a-z]{3,18}$/.test(t))
    .sort((a, b) => vocab[a] - vocab[b])
    .slice(0, 9000)
  return [
    ...new Set([
      ...words,
      ..."nostr bitcoin lightning sats satoshi ecash cashu wallet relay relays zap zaps pubkey selfhosted privacy encryption nip05 nsec npub lnbc lightningnetwork nostrconnect decentralized".split(
        " "
      ),
    ]),
  ]
}

export function relatedKeywords(
  words: string[],
  index: Int8Array,
  query: Float32Array,
  exclude: ReadonlySet<string>
) {
  if (index.length !== words.length * query.length) throw Error("Invalid keyword index")
  const candidates: {word: string; score: number}[] = []
  for (let i = 0; i < words.length; i++) {
    if (exclude.has(words[i])) continue
    let dot = 0,
      norm = 0
    for (let j = 0; j < query.length; j++) {
      const v = index[i * query.length + j]
      dot += v * query[j]
      norm += v * v
    }
    const score = dot / Math.sqrt(norm)
    if (score >= 0.36) candidates.push({word: words[i], score})
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.word)
}
