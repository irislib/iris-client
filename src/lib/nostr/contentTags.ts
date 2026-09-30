import {nip19} from "nostr-tools"

/** NIP-27 mentions and NIP-18 quotes on public authored content. */
export function addContentTags(content: string, tags: string[][]): void {
  const add = (tag: string[]) => {
    if (!tags.some((existing) => existing[0] === tag[0] && existing[1] === tag[1]))
      tags.push(tag)
  }
  for (const match of content.matchAll(
    /nostr:(n(?:pub|profile|ote|event|addr)1[a-z0-9]+)/gi
  )) {
    try {
      const decoded = nip19.decode(match[1])
      if (decoded.type === "npub") add(["p", decoded.data])
      else if (decoded.type === "nprofile") add(["p", decoded.data.pubkey])
      else if (decoded.type === "note") add(["q", decoded.data])
      else if (decoded.type === "nevent") {
        add([
          "q",
          decoded.data.id,
          decoded.data.relays?.[0] ?? "",
          decoded.data.author ?? "",
        ])
        if (decoded.data.author) add(["p", decoded.data.author])
      } else if (decoded.type === "naddr") {
        add([
          "q",
          `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`,
          decoded.data.relays?.[0] ?? "",
          decoded.data.pubkey,
        ])
        add(["p", decoded.data.pubkey])
      }
    } catch {
      /* Unrecognized text remains plain content. */
    }
  }
}
