import {addContentTags} from "./contentTags"
import {relayHints} from "./relayPolicy"
/** App domain objects. Networking, verification, batching and retries belong to nostr-pubsub. */
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  matchFilters,
  nip04,
  nip05,
  nip19,
  nip44,
  verifyEvent,
  type Event,
  type Filter,
} from "nostr-tools"
import {decode as decodeInvoice} from "light-bolt11-decoder"
import {
  createNostrRuntime,
  type NostrRuntime,
  type NostrRuntimeOptions,
  type RuntimeCompletion,
  type RuntimeEventStore,
  type RuntimePublishResult,
} from "nostr-pubsub"

export {nip19}
export type NostrEvent = Event
export type RawEvent = Event
export type Hexpubkey = string
export type EventId = string
export type EventTag = string[]
export type EventFilter = Filter
export type RelayInformation = Record<string, unknown>
export type UserProfile = {
  name?: string
  displayName?: string
  display_name?: string
  about?: string
  picture?: string
  image?: string
  banner?: string
  website?: string
  nip05?: string
  lud06?: string
  lud16?: string
  username?: string
  bio?: string
  created_at?: number
  profileEvent?: string
  [key: string]: unknown
}
export enum EventKind {
  Text = 1,
  Repost = 6,
  Reaction = 7,
  GenericRepost = 16,
  Image = 20,
  GenericReply = 1111,
  Article = 30023,
  Classified = 30402,
  ZapRequest = 9734,
}
export const CacheMode = {
  ONLY_CACHE: "cache-only",
  ONLY_RELAY: "network-only",
  CACHE_FIRST: "cache-first",
  PARALLEL: "cache-first",
} as const
export type CacheMode = (typeof CacheMode)[keyof typeof CacheMode]
export type SubscriptionOptions = {
  closeOnEose?: boolean
  cacheUsage?: CacheMode
  relayUrls?: string[]
  groupable?: boolean
  groupableDelay?: number
  isolated?: boolean
  waitForCacheBeforeRelays?: boolean
  subId?: string
  [key: string]: unknown
}
// The domain emitter supports heterogeneous event callbacks; arguments are typed
// by the subscribing app feature rather than widened at each call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void
export class Emitter {
  private handlers = new Map<string, Set<Handler>>()
  on(name: string, fn: Handler): this {
    const set = this.handlers.get(name) ?? new Set()
    set.add(fn)
    this.handlers.set(name, set)
    return this
  }
  once(name: string, fn: Handler): this {
    const once: Handler = (...args) => {
      this.off(name, once)
      fn(...args)
    }
    return this.on(name, once)
  }
  off(name: string, fn: Handler): this {
    this.handlers.get(name)?.delete(fn)
    return this
  }
  removeListener(name: string, fn: Handler): this {
    return this.off(name, fn)
  }
  removeAllListeners(name?: string): this {
    if (name) this.handlers.delete(name)
    else this.handlers.clear()
    return this
  }
  emit(name: string, ...args: unknown[]): boolean {
    const handlers = this.handlers.get(name)
    for (const fn of [...(handlers ?? [])]) fn(...args)
    return !!handlers?.size
  }
}
export const normalizeRelayUrl = (url: string) =>
  new URL(url).toString().replace(/\/$/, "")
export interface Signer {
  user(): Promise<User>
  sign(event: Event): Promise<string>
  encrypt(recipient: User, value: string, scheme?: "nip04" | "nip44"): Promise<string>
  decrypt(sender: User, value: string, scheme?: "nip04" | "nip44"): Promise<string>
}
export class SecretKeySigner implements Signer {
  private bytes: Uint8Array
  constructor(key: string | Uint8Array) {
    if (typeof key !== "string") this.bytes = key
    else if (key.startsWith("nsec1")) {
      this.bytes = nip19.decode(key).data as Uint8Array
    } else {
      if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("Invalid secret key")
      this.bytes = Uint8Array.from(key.match(/.{2}/g)!, (v) => parseInt(v, 16))
    }
    if (this.bytes.length !== 32) throw new Error("Invalid secret key")
  }
  static generate() {
    return new SecretKeySigner(generateSecretKey())
  }
  get pubkey() {
    return getPublicKey(this.bytes)
  }
  get privateKey() {
    return Array.from(this.bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  }
  async user() {
    return new User({pubkey: getPublicKey(this.bytes)})
  }
  async sign(event: Event) {
    return finalizeEvent(event, this.bytes).sig
  }
  async encrypt(user: User, value: string, scheme: "nip04" | "nip44" = "nip44") {
    return scheme === "nip04"
      ? nip04.encrypt(this.bytes, user.pubkey, value)
      : nip44.v2.encrypt(
          value,
          nip44.v2.utils.getConversationKey(this.bytes, user.pubkey)
        )
  }
  async decrypt(user: User, value: string, scheme: "nip04" | "nip44" = "nip44") {
    return scheme === "nip04"
      ? nip04.decrypt(this.bytes, user.pubkey, value)
      : nip44.v2.decrypt(
          value,
          nip44.v2.utils.getConversationKey(this.bytes, user.pubkey)
        )
  }
}
export class ExtensionSigner implements Signer {
  private extension() {
    const extension = globalThis.window?.nostr
    if (!extension) throw new Error("No signing extension available")
    return extension
  }
  async user() {
    return new User({pubkey: await this.extension().getPublicKey()})
  }
  async sign(event: Event) {
    return (await this.extension().signEvent(event)).sig
  }
  async encrypt(user: User, value: string, scheme: "nip04" | "nip44" = "nip44") {
    const api = this.extension()[scheme]
    if (!api) throw new Error(`${scheme} encryption unavailable`)
    return api.encrypt(user.pubkey, value)
  }
  async decrypt(user: User, value: string, scheme: "nip04" | "nip44" = "nip44") {
    const api = this.extension()[scheme]
    if (!api) throw new Error(`${scheme} encryption unavailable`)
    return api.decrypt(user.pubkey, value)
  }
}
export function profileFromEvent(
  event: Pick<Event, "content"> & Partial<Event>
): UserProfile {
  try {
    const p = JSON.parse(event.content)
    return {
      ...p,
      created_at: event.created_at,
      ...(event.id
        ? {
            profileEvent: JSON.stringify(
              event instanceof AppEvent ? event.rawEvent() : event
            ),
          }
        : {}),
      displayName: p.display_name ?? p.displayName,
      image: p.picture ?? p.image,
    }
  } catch {
    return {}
  }
}
export function deserialize(value: string): Event {
  return JSON.parse(value)
}
export class AppEvent extends Emitter implements Event {
  id = ""
  pubkey = ""
  created_at = Math.floor(Date.now() / 1000)
  kind = 1
  tags: string[][] = []
  content = ""
  sig = ""
  nostr?: NostrClient
  relay?: Relay
  publishStatus?: string
  constructor(nostr?: NostrClient, event?: Partial<Event> | AppEvent | unknown) {
    super()
    this.nostr = nostr
    if (event && typeof event === "object")
      Object.assign(this, (event as AppEvent).rawEvent?.() ?? event)
  }
  rawEvent(): Event {
    return {
      id: this.id,
      pubkey: this.pubkey,
      created_at: this.created_at,
      kind: this.kind,
      tags: this.tags.map((t) => [...t]),
      content: this.content,
      sig: this.sig,
    }
  }
  async toNostrEvent(pubkey?: string) {
    if (pubkey) this.pubkey = pubkey
    if (!this.pubkey && this.nostr?.signer)
      this.pubkey = (await this.nostr.signer.user()).pubkey
    this.id = getEventHash(this.rawEvent())
    return this.rawEvent()
  }
  async sign(signer = this.nostr?.signer, _options?: {skipContentTagging?: boolean}) {
    if (!signer) throw new Error("No signer available")
    this.pubkey = (await signer.user()).pubkey
    if (!_options?.skipContentTagging && [1, 20, 1111, 30023, 30402].includes(this.kind))
      addContentTags(this.content, this.tags)
    if (this.nostr?.clientName) {
      this.removeTag("client")
      if (!this.nostr.clientTagFilter || this.nostr.clientTagFilter(this))
        this.tags.push(["client", this.nostr.clientName])
    }
    this.id = getEventHash(this.rawEvent())
    this.sig = await signer.sign(this.rawEvent())
    return this.sig
  }
  async publish(
    relays?: RelaySet,
    _timeout?: number,
    _required?: number,
    _options?: unknown
  ): Promise<Set<Relay>> {
    if (!this.sig) await this.sign()
    if (!this.nostr) throw new Error("No event client")
    const accepted = relays
      ? await relays.publish(this)
      : await this.nostr.publishEvent(this)
    this.publishStatus = "success"
    this.emit("published", accepted)
    return accepted
  }
  tagValue(name: string) {
    return this.tags.find((t) => t[0] === name)?.[1]
  }
  getMatchingTags(name: string) {
    return this.tags.filter((t) => t[0] === name)
  }
  removeTag(name: string) {
    this.tags = this.tags.filter((t) => t[0] !== name)
  }
  get onRelays() {
    return this.relay ? [this.relay] : []
  }
  get author() {
    return this.nostr?.getUser({pubkey: this.pubkey}) ?? new User({pubkey: this.pubkey})
  }
  set author(user: User) {
    this.pubkey = user.pubkey
  }
  get dTag() {
    return this.tagValue("d")
  }
  set dTag(value: string | undefined) {
    this.removeTag("d")
    if (value !== undefined) this.tags.push(["d", value])
  }
  get alt() {
    return this.tagValue("alt")
  }
  set alt(value: string | undefined) {
    this.removeTag("alt")
    if (value) this.tags.push(["alt", value])
  }
  isParamReplaceable() {
    return this.kind >= 30000 && this.kind < 40000
  }
  isReplaceable() {
    return this.kind === 0 || this.kind === 3 || (this.kind >= 10000 && this.kind < 20000)
  }
  isEphemeral() {
    return this.kind >= 20000 && this.kind < 30000
  }
  tagAddress() {
    return `${this.kind}:${this.pubkey}:${this.dTag ?? ""}`
  }
  tagId() {
    return this.isParamReplaceable() ? this.tagAddress() : this.id
  }
  deduplicationKey() {
    if (this.isParamReplaceable()) return this.tagAddress()
    if (this.isReplaceable()) return `${this.kind}:${this.pubkey}`
    return this.id
  }
  tagReference(marker?: string) {
    return [
      this.isParamReplaceable() ? "a" : "e",
      this.tagId(),
      this.relay?.url ?? "",
      ...(marker ? [marker] : []),
    ]
  }
  referenceTags(marker?: string) {
    return [this.tagReference(marker), ["p", this.pubkey]]
  }
  tag(target: AppEvent | User, marker?: string) {
    this.tags.push(
      ...(target instanceof AppEvent
        ? target.referenceTags(marker)
        : [["p", target.pubkey]])
    )
    return this
  }
  filter(): EventFilter {
    return {[this.isParamReplaceable() ? "#a" : "#e"]: [this.tagId()]}
  }
  nip22Filter(): EventFilter {
    return this.isParamReplaceable()
      ? {"#A": [this.tagId()], kinds: [1111]}
      : {"#E": [this.tagId()], kinds: [1111]}
  }
  encode() {
    return this.isParamReplaceable()
      ? nip19.naddrEncode({
          kind: this.kind,
          pubkey: this.pubkey,
          identifier: this.dTag ?? "",
        })
      : nip19.neventEncode({id: this.id, author: this.pubkey, kind: this.kind})
  }
  reply() {
    const event = new AppEvent(this.nostr, {kind: this.kind === 1 ? 1 : 1111})
    if (this.kind === 1) {
      const root = this.tags.find((t) => t[0] === "e" && t[3] === "root")
      event.tags = [
        ...(root ? [[...root]] : []),
        this.tagReference(root ? "reply" : "root"),
        ["p", this.pubkey],
      ]
    } else {
      const inherited =
        this.kind === 1111
          ? this.tags.filter((t) => ["A", "E", "K", "P"].includes(t[0]))
          : []
      const rootTags = inherited.length
        ? inherited.map((t) => [...t])
        : [
            [this.isParamReplaceable() ? "A" : "E", this.tagId(), this.relay?.url ?? ""],
            ["K", String(this.kind)],
            ["P", this.pubkey],
          ]
      event.tags = [
        ...rootTags,
        [this.isParamReplaceable() ? "a" : "e", this.tagId(), this.relay?.url ?? ""],
        ["k", String(this.kind)],
        ["p", this.pubkey],
      ]
    }
    return event
  }
  async repost(publish = true) {
    const event = new AppEvent(this.nostr, {
      kind: this.kind === 1 ? 6 : 16,
      content: JSON.stringify(this.rawEvent()),
      tags: [
        ["e", this.id, this.relay?.url ?? ""],
        ["p", this.pubkey],
        ...(this.kind !== 1 ? [["k", String(this.kind)]] : []),
      ],
    })
    if (publish) await event.publish()
    return event
  }
  async delete(reason = "", publish = true, _relaySet?: RelaySet) {
    const event = new AppEvent(this.nostr, {
      kind: 5,
      content: reason,
      tags: [this.tagReference(), ["k", String(this.kind)]],
    })
    if (publish) await event.publish()
    return event
  }
  async encrypt(
    user?: User,
    signer = this.nostr?.signer,
    scheme: "nip04" | "nip44" = "nip04"
  ) {
    if (!signer) throw new Error("No signer")
    const recipient = user ?? this.nostr?.getUser({pubkey: this.tagValue("p") ?? ""})
    if (!recipient) throw new Error("No recipient")
    this.content = await signer.encrypt(recipient, this.content, scheme)
  }
  async decrypt(
    user?: User,
    signer = this.nostr?.signer,
    scheme: "nip04" | "nip44" = "nip04"
  ) {
    if (!signer) throw new Error("No signer")
    this.content = await signer.decrypt(user ?? this.author, this.content, scheme)
    return this.content
  }
  get isValid() {
    return !!this.sig && verifyEvent(this.rawEvent())
  }
  verifySignature() {
    return this.isValid
  }
}
export class User {
  pubkey: string
  profile?: UserProfile
  nostr?: NostrClient
  constructor(data: {pubkey?: string; hexpubkey?: string; npub?: string}) {
    this.pubkey =
      data.pubkey ??
      data.hexpubkey ??
      (data.npub ? (nip19.decode(data.npub).data as string) : "")
  }
  get npub() {
    return nip19.npubEncode(this.pubkey)
  }
  get hexpubkey() {
    return this.pubkey
  }
  async fetchProfile(_options?: unknown) {
    const event = await this.nostr?.fetchEvent({kinds: [0], authors: [this.pubkey]})
    if (event) this.profile = profileFromEvent(event)
    return this.profile
  }
  async validateNip05(value: string) {
    const profile = await nip05.queryProfile(value)
    return profile?.pubkey === this.pubkey
  }
  async publish() {
    if (!this.nostr) throw new Error("No event client")
    const event = new AppEvent(this.nostr, {
      kind: 0,
      content: JSON.stringify(this.profile ?? {}),
    })
    return event.publish()
  }
}
export class Relay extends Emitter {
  status = 0
  connectivity: {
    connectedAt?: number
    connectionStats: {attempts: number; success: number}
  } = {connectionStats: {attempts: 0, success: 0}}
  nostr?: NostrClient
  constructor(
    public url: string,
    _auth?: unknown,
    nostr?: NostrClient
  ) {
    super()
    this.nostr = nostr
  }
  get connected() {
    return this.status >= 5
  }
  async connect() {
    this.status = 1
    this.nostr?.transportPlugins.forEach((p) => p.connectRelay?.(this.url))
    if (!this.nostr?.transportPlugins.length) await this.nostr?.connect()
    this.emit("connect")
    this.emit("ready")
  }
  disconnect() {
    this.status = 0
    this.nostr?.transportPlugins.forEach((p) => p.disconnectRelay?.(this.url))
    this.emit("disconnect")
  }
  async publish(event: AppEvent, _timeout?: number) {
    if (!this.nostr) throw new Error("No event client")
    if (this.nostr.transportPlugins.length) {
      for (const plugin of this.nostr.transportPlugins) {
        const result = (await plugin.publish?.(event, [this], {
          requireAck: true,
        })) as RuntimePublishResult | undefined
        if (result?.remoteAccepted) return true
      }
      return false
    }
    const result = await this.nostr
      .getRuntime()
      .publish(event.rawEvent(), {relays: [this.url], requireAck: true})
    return result.remoteAccepted
  }
}
export class RelaySet {
  constructor(
    public relays: Set<Relay>,
    public nostr?: NostrClient
  ) {}
  async publish(
    event: AppEvent,
    _timeout?: number,
    _required?: number
  ): Promise<Set<Relay>> {
    if (!this.nostr) throw new Error("No event client")
    return this.nostr.publishEvent(event, this)
  }
  static fromRelayUrls(urls: string[], nostr: NostrClient, _connect?: boolean) {
    return new RelaySet(new Set(urls.map((url) => nostr.pool.getRelay(url))), nostr)
  }
}
export class PublishError extends Error {
  constructor(
    message: string,
    public relayErrors = new Map<Relay, Error>(),
    public publishedToRelays = new Set<Relay>()
  ) {
    super(message)
  }
}
export class EventSubscription extends Emitter {
  subId: string = crypto.randomUUID()
  internalId = this.subId
  relayFilters = new Map<string, EventFilter[]>()
  closed = false
  private seen = new Set<string>()
  private cleanup?: () => void
  constructor(
    public nostr: NostrClient,
    public filters: EventFilter[],
    public opts: SubscriptionOptions = {}
  ) {
    super()
    if (opts.subId) this.subId = opts.subId
  }
  start(): void {
    void this.nostr.startSubscription(this)
  }
  setCleanup(fn: () => void) {
    if (this.closed) fn()
    else this.cleanup = fn
  }
  eventReceived(event: AppEvent | Event, relay?: Relay, fromCache = false) {
    if (this.closed) return
    const e = event instanceof AppEvent ? event : new AppEvent(this.nostr, event)
    if (this.seen.has(e.id)) {
      this.emit("event:dup", e, relay, 0, this, fromCache)
      return
    }
    this.seen.add(e.id)
    if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value!)
    e.relay = relay
    this.emit("event", e, relay, this, fromCache)
  }
  completion?: RuntimeCompletion
  eoseReceived(_relay?: Relay | null, completion?: RuntimeCompletion) {
    this.completion = completion
    if (this.closed) return
    this.emit("eose", this)
    if (this.opts.closeOnEose) this.stop()
  }
  stop() {
    if (this.closed) return
    this.closed = true
    this.cleanup?.()
    this.nostr.subscriptions.delete(this.subId)
    this.emit("close")
    this.removeAllListeners()
  }
}
export interface ClientOptions {
  verifyEvent?: NostrRuntimeOptions["verifyEvent"]
  signAuthEvent?: NostrRuntimeOptions["signAuthEvent"]
  explicitRelayUrls?: string[]
  signer?: Signer
  cacheAdapter?: {store: RuntimeEventStore}
  clientName?: string
  clientTagFilter?: (event: AppEvent) => boolean
  enableOutboxModel?: boolean
  autoConnectUserRelays?: boolean
  [key: string]: unknown
}
export class NostrClient extends Emitter {
  signer?: Signer
  activeUser?: User
  explicitRelayUrls: string[]
  transportPlugins: ClientTransport[] = []
  subscriptions = new Map<string, EventSubscription>()
  clientName?: string
  clientTagFilter?: (event: AppEvent) => boolean
  cacheAdapter?: ClientOptions["cacheAdapter"]
  enableOutboxModel = false
  devWriteRelaySet?: RelaySet
  private verifyEvent?: NostrRuntimeOptions["verifyEvent"]
  private runtime?: NostrRuntime
  private signAuthEvent?: NostrRuntimeOptions["signAuthEvent"]
  pool: Emitter & {
    relays: Map<string, Relay>
    getRelay: (url: string, connect?: boolean) => Relay
    addRelay: (relay: Relay) => void
    removeRelay: (url: string) => boolean
    connectedRelays: () => Relay[]
    connect: (timeout?: number) => Promise<void>
  }
  subManager = {
    subscriptions: this.subscriptions,
    seenEvents: new Map<string, Set<Relay>>(),
    seenEvent: (id: string, relay: Relay) => {
      const relays = this.subManager.seenEvents.get(id) ?? new Set<Relay>()
      relays.add(relay)
      this.subManager.seenEvents.set(id, relays)
      if (this.subManager.seenEvents.size > 10000)
        this.subManager.seenEvents.delete(this.subManager.seenEvents.keys().next().value!)
    },
    dispatchEvent: (event: AppEvent | Event, relay?: Relay, _cache?: boolean) => {
      const raw = event instanceof AppEvent ? event.rawEvent() : event
      for (const sub of this.subscriptions.values())
        if (matchFilters(sub.filters, raw)) sub.eventReceived(raw, relay)
      if (this.runtime) void this.runtime.ingest(raw, relay?.url ?? "local")
    },
  }
  constructor(opts: ClientOptions = {}) {
    super()
    this.verifyEvent = opts.verifyEvent
    this.signAuthEvent = opts.signAuthEvent
    this.enableOutboxModel = opts.enableOutboxModel ?? false
    this.signer = opts.signer
    this.cacheAdapter = opts.cacheAdapter
    this.explicitRelayUrls = opts.explicitRelayUrls ?? []
    this.clientName = opts.clientName
    this.clientTagFilter = opts.clientTagFilter
    const relays = new Map<string, Relay>()
    this.pool = Object.assign(new Emitter(), {
      relays,
      connectedRelays: () => [...relays.values()].filter((r) => r.connected),
      connect: () => this.connect(),
      getRelay: (url: string, _connect = true) => {
        let relay = relays.get(url)
        if (!relay) {
          relay = new Relay(url, undefined, this)
          relays.set(url, relay)
        }
        return relay
      },
      addRelay: (relay: Relay) => {
        relay.nostr = this
        relays.set(relay.url, relay)
        this.transportPlugins.forEach((p) => p.addRelay?.(relay.url))
        this.runtime?.setRelays([...relays.keys()])
      },
      removeRelay: (url: string) => {
        this.transportPlugins.forEach((p) => p.removeRelay?.(url))
        const ok = relays.delete(url)
        this.runtime?.setRelays([...relays.keys()])
        return ok
      },
    })
    for (const url of this.explicitRelayUrls) this.pool.getRelay(url, false)
  }
  getRuntime() {
    return (this.runtime ??= createNostrRuntime({
      relays: this.explicitRelayUrls,
      store: this.cacheAdapter?.store,
      batchWindowMs: 20,
      historyTimeoutMs: 5000,
      verifyEvent: this.verifyEvent,
      signAuthEvent:
        this.signAuthEvent ??
        (async (_relay, draft) => {
          const event = new AppEvent(this, draft)
          await event.sign()
          return event.rawEvent()
        }),
    }))
  }
  async connect(_timeout?: number) {
    this.getRuntime()
  }
  assertSigner() {
    if (!this.signer) throw new Error("No signer available")
  }
  async getUserFromNip05(value: string) {
    const profile = await nip05.queryProfile(value)
    return profile ? this.getUser({pubkey: profile.pubkey}) : undefined
  }
  getUser(
    data: {pubkey?: string; hexpubkey?: string; npub?: string},
    _skipValidation?: boolean
  ) {
    const user = new User(data)
    user.nostr = this
    return user
  }
  subscribe(
    filters: EventFilter | EventFilter[],
    opts: SubscriptionOptions = {},
    relaySet?: RelaySet | boolean,
    autoStart = true
  ) {
    if (typeof relaySet === "boolean") {
      autoStart = relaySet
      relaySet = undefined
    }
    const sub = new EventSubscription(
      this,
      Array.isArray(filters) ? filters : [filters],
      {...opts, ...(relaySet ? {relayUrls: [...relaySet.relays].map((r) => r.url)} : {})}
    )
    this.subscriptions.set(sub.subId, sub)
    if (autoStart) queueMicrotask(() => sub.start())
    return sub
  }
  async startSubscription(sub: EventSubscription) {
    if (sub.closed) return
    if (
      this.enableOutboxModel &&
      !sub.opts.relayUrls &&
      sub.opts.cacheUsage !== CacheMode.ONLY_CACHE &&
      !sub.filters.some((f) => f.kinds?.includes(10002))
    ) {
      void this.attachAuthorRelays(sub)
    }
    if (this.transportPlugins.length) {
      for (const plugin of this.transportPlugins)
        plugin.onSubscribe?.(sub, sub.filters, sub.opts)
      return
    }
    const handle = this.getRuntime().subscribe(
      sub.filters,
      {
        onEvent: (event, info) =>
          sub.eventReceived(
            event,
            info.source.startsWith("ws") ? this.pool.getRelay(info.source) : undefined,
            info.cached
          ),
        onEose: (status) => sub.eoseReceived(null, status),
        onError: (error) => sub.emit("error", error),
      },
      {cache: sub.opts.cacheUsage ?? "cache-first", relays: sub.opts.relayUrls}
    )
    sub.setCleanup(() => handle.close())
  }
  private async attachAuthorRelays(parent: EventSubscription) {
    const authors = [...new Set(parent.filters.flatMap((filter) => filter.authors ?? []))]
      .filter((key) => /^[0-9a-f]{64}$/.test(key))
      .slice(0, 64)
    if (!authors.length) return
    const metadata = await this.fetchEvents(
      {kinds: [10002], authors},
      {closeOnEose: true}
    )
    if (parent.closed) return
    const urls = relayHints(metadata, "write").filter(
      (url) => !this.explicitRelayUrls.includes(url)
    )
    if (!urls.length) return
    const routed = this.subscribe(parent.filters, {
      ...parent.opts,
      relayUrls: urls,
      closeOnEose: false,
    })
    routed.on(
      "event",
      (event: AppEvent, relay?: Relay, _sub?: EventSubscription, cached?: boolean) =>
        parent.eventReceived(event, relay, cached)
    )
    parent.once("close", () => routed.stop())
  }
  async fetchEvents(
    filters: EventFilter | EventFilter[],
    opts: SubscriptionOptions = {},
    relaySet?: RelaySet
  ) {
    return this.collectEvents(filters, opts, relaySet)
  }
  private collectEvents(
    filters: EventFilter | EventFilter[],
    opts: SubscriptionOptions,
    relaySet?: RelaySet,
    exactId?: string
  ) {
    return new Promise<Set<AppEvent>>((resolve) => {
      const found = new Map<string, AppEvent>()
      const sub = this.subscribe(filters, {...opts, closeOnEose: true}, relaySet)
      const finish = () => {
        clearTimeout(timeout)
        sub.stop()
        resolve(new Set(found.values()))
      }
      const timeout = setTimeout(finish, 10000)
      sub.on("event", (event: AppEvent) => {
        const key = event.deduplicationKey()
        const old = found.get(key)
        if (!old || old.created_at < event.created_at) found.set(key, event)
        if (event.id === exactId) finish()
      })
      sub.on("eose", finish)
    })
  }
  async fetchEvent(
    filter: EventFilter | string,
    opts: SubscriptionOptions = {},
    relaySet?: RelaySet
  ) {
    let filters: EventFilter
    if (typeof filter === "string") {
      if (filter.startsWith("nostr:")) filter = filter.slice(6)
      if (/^[0-9a-f]{64}$/.test(filter)) filters = {ids: [filter]}
      else {
        const decoded = nip19.decode(filter)
        if (decoded.type === "note") filters = {ids: [decoded.data]}
        else if (decoded.type === "nevent") filters = {ids: [decoded.data.id]}
        else if (decoded.type === "naddr")
          filters = {
            kinds: [decoded.data.kind],
            authors: [decoded.data.pubkey],
            "#d": [decoded.data.identifier],
          }
        else return null
      }
    } else filters = filter
    const exactId =
      filters.ids?.length === 1 && /^[0-9a-f]{64}$/.test(filters.ids[0])
        ? filters.ids[0]
        : undefined
    const events = await this.collectEvents(filters, opts, relaySet, exactId)
    return [...events].sort((a, b) => b.created_at - a.created_at)[0] ?? null
  }
  async publishEvent(event: AppEvent, relaySet?: RelaySet): Promise<Set<Relay>> {
    if (this.transportPlugins.length) {
      const accepted = new Set<Relay>()
      for (const plugin of this.transportPlugins) {
        const report = (await plugin.publish?.(
          event,
          relaySet ? [...relaySet.relays] : undefined
        )) as {sources?: {id: string; accepted: boolean}[]} | undefined
        for (const source of report?.sources ?? [])
          if (source.accepted) accepted.add(this.pool.getRelay(source.id))
      }
      return accepted
    }
    const result = await this.getRuntime().publish(event.rawEvent(), {
      relays: relaySet ? [...relaySet.relays].map((r) => r.url) : undefined,
    })
    if (!result.remoteAccepted && !result.queued)
      throw new PublishError("Publication was not accepted")
    return new Set(
      result.sources
        .filter((source) => source.accepted)
        .map((source) => this.pool.getRelay(source.id))
    )
  }
  async close() {
    for (const sub of this.subscriptions.values()) sub.stop()
    await this.runtime?.close()
    for (const plugin of this.transportPlugins) plugin.close?.()
  }
}
export const eventFromRawEvent = (client: NostrClient, event: Event) =>
  new AppEvent(client, event)
export default NostrClient

export const calculateRelaySetFromEvent = async (
  client: NostrClient,
  _event: AppEvent,
  _count?: number
) => new RelaySet(new Set(client.pool.relays.values()), client)
export const getRootTag = (event: AppEvent) =>
  event.kind === 1111
    ? event.tags.find((t) => t[0] === "E" || t[0] === "A")
    : (event.tags.find((t) => t[0] === "e" && t[3] === "root") ??
      event.tags.find((t) => t[0] === "e"))
export const getReplyTag = (event: AppEvent) =>
  event.kind === 1111
    ? event.tags.find((t) => t[0] === "e" || t[0] === "a")
    : (event.tags.find((t) => t[0] === "e" && t[3] === "reply") ??
      event.tags.filter((t) => t[0] === "e").at(-1))
export const getRootEventId = (event: AppEvent) => getRootTag(event)?.[1]
export type LnPayCb = (request: {
  pr: string
  target?: AppEvent
  recipientPubkey?: string
  amount?: number
  unit?: string
}) => Promise<unknown>
export function zapInvoiceFromEvent(event: AppEvent) {
  try {
    const description = event.tagValue("description") ?? ""
    const request = JSON.parse(
      description.startsWith("%") ? decodeURIComponent(description) : description
    ) as Event
    const invoice = decodeInvoice(event.tagValue("bolt11") ?? "")
    const amount = invoice.sections.find((s) => s.name === "amount")?.value
    return {
      id: event.id,
      zapper: event.pubkey,
      zappee: request.pubkey,
      zapped: event.tagValue("p") ?? "",
      zappedEvent: event.tagValue("e") ?? event.tagValue("a"),
      amount: Number(amount ?? 0),
      comment: request.content,
    }
  } catch {
    return null
  }
}

export interface ClientTransport {
  name?: string
  onSubscribe?(
    sub: EventSubscription,
    filters: EventFilter[],
    opts?: SubscriptionOptions
  ): void
  publish?(event: AppEvent, relays?: Relay[], options?: unknown): Promise<unknown>
  connectRelay?(url: string): void
  disconnectRelay?(url: string): void
  addRelay?(url: string): void
  removeRelay?(url: string): void
  close?(): void
}
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: Event): Promise<Event>
      nip04?: {
        encrypt(key: string, value: string): Promise<string>
        decrypt(key: string, value: string): Promise<string>
      }
      nip44?: {
        encrypt(key: string, value: string): Promise<string>
        decrypt(key: string, value: string): Promise<string>
      }
    }
  }
}
