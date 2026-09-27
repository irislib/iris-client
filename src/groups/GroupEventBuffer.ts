import {verifyEvent, type Event} from "nostr-tools"
import {parseGroupEventState} from "./model"

export interface GroupEventBufferOptions {
  capacity: number
  perAuthorCap?: number
  factTargets?: string[]
  now?: () => number
}

const newer = (candidate: Event, current: Event) =>
  candidate.created_at > current.created_at ||
  (candidate.created_at === current.created_at && candidate.id < current.id)

/** Latest valid states plus a bounded history per author. Replacements do not consume slots. */
export class GroupEventBuffer {
  private records = new Map<string, Event>()
  private authors = new Map<string, Map<string, Event>>()
  private cachedEvents: Event[] = []
  private dirty = false
  private readonly capacity: number
  private readonly perAuthorCap: number
  private readonly targets?: Set<string>
  private readonly now: () => number
  limited = false

  constructor(options: GroupEventBufferOptions) {
    this.capacity = Math.max(1, Math.floor(options.capacity))
    this.perAuthorCap = Math.max(
      1,
      Math.min(this.capacity, Math.floor(options.perAuthorCap ?? this.capacity))
    )
    this.targets = options.factTargets ? new Set(options.factTargets) : undefined
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
  }

  get size() {
    return this.records.size
  }

  private stateKey(event: Event): string | null {
    if (
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      event.created_at > this.now() ||
      !Array.isArray(event.tags) ||
      typeof event.content !== "string"
    )
      return null
    try {
      if (event.kind === 7368 || event.kind === 37368) {
        const state = parseGroupEventState(event, this.now())
        if (
          !state ||
          (state.memberPubkey && this.targets && !this.targets.has(state.memberPubkey))
        )
          return null
        return `group:${state.key}`
      }
      // nostr-tools caches validity on a symbol. Do not trust a marker copied from
      // another event, or a caller that mutates a previously verified object.
      if (!verifyEvent(copyEvent(event))) return null
      if (
        event.kind === 0 ||
        event.kind === 3 ||
        (event.kind >= 10000 && event.kind < 20000)
      ) {
        return `replaceable:${event.kind}:${event.pubkey}`
      }
      if (event.kind >= 30000 && event.kind < 40000) {
        const tags = event.tags.filter((tag) => tag[0] === "d")
        if (tags.length > 1) return null
        return `parameterized:${event.kind}:${event.pubkey}:${tags[0]?.[1] ?? ""}`
      }
      return `event:${event.id}`
    } catch {
      return null
    }
  }

  add(event: Event): boolean {
    const key = this.stateKey(event)
    if (!key) return false
    // Own the retained protocol fields so later caller mutation cannot change a
    // verified record (or its replacement identity) inside this collection.
    event = copyEvent(event)
    const current = this.records.get(key)
    if (current) {
      if (!newer(event, current)) return false
      this.records.set(key, event)
      this.authors.get(event.pubkey)!.set(key, event)
      this.dirty = true
      return true
    }

    const author = this.authors.get(event.pubkey) ?? new Map<string, Event>()
    if (author.size >= this.perAuthorCap) {
      // Only this author's own oldest record may be displaced by a new record.
      let oldestKey: string | undefined
      let oldest: Event | undefined
      for (const [entryKey, entry] of author) {
        if (!oldest || newer(oldest, entry)) {
          oldestKey = entryKey
          oldest = entry
        }
      }
      this.limited = true
      if (!oldest || !newer(event, oldest)) return false
      author.delete(oldestKey!)
      this.records.delete(oldestKey!)
    } else if (this.records.size >= this.capacity) {
      this.limited = true
      return false
    }
    author.set(key, event)
    this.authors.set(event.pubkey, author)
    this.records.set(key, event)
    this.dirty = true
    return true
  }

  getEvents(): Event[] {
    if (this.dirty) {
      this.cachedEvents = [...this.records.values()].sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)
      )
      this.dirty = false
    }
    return this.cachedEvents
  }

  clear() {
    this.records.clear()
    this.authors.clear()
    this.cachedEvents = []
    this.dirty = false
    this.limited = false
  }
}

function copyEvent(event: Event): Event {
  return {
    id: event.id,
    pubkey: event.pubkey,
    sig: event.sig,
    kind: event.kind,
    created_at: event.created_at,
    content: event.content,
    tags: event.tags.map((tag) => [...tag]),
  }
}
