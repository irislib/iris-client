import type {Logger} from "../logging/Logger.ts"
import type {WebSocketFactory} from "./WsConnectionManager.ts"
import type {RealTimeTransport} from "./RealTimeTransport.ts"
import {WsTransport} from "./WsTransport.ts"
import {PollingTransport} from "./PollingTransport.ts"
import {generateSubId} from "../utils.ts"
import type {MintInfo} from "../types.ts"

import type {
  WsRequest,
  WsResponse,
  WsNotification,
  SubscriptionKind,
  UnsubscribeHandler,
} from "./SubscriptionProtocol.ts"

export type {UnsubscribeHandler}

// WebSocket types now live in WsConnectionManager

export type SubscriptionCallback<TPayload = unknown> = (
  payload: TPayload
) => void | Promise<void>

interface ActiveSubscription<TPayload = unknown> {
  subId: string
  mintUrl: string
  kind: SubscriptionKind
  filters: string[]
  callbacks: Set<SubscriptionCallback<TPayload>>
}

// generateSubId moved to utils.ts

export class SubscriptionManager {
  private readonly nextIdByMint = new Map<string, number>()
  private readonly subscriptions = new Map<string, ActiveSubscription<unknown>>()
  private readonly activeByMint = new Map<string, Set<string>>()
  private readonly pendingSubscribeByMint = new Map<string, Map<number, string>>()
  private readonly transportByMint = new Map<string, RealTimeTransport>()
  private readonly logger?: Logger
  private readonly messageHandlerByMint = new Map<string, (evt: any) => void>()
  private readonly openHandlerByMint = new Map<string, (evt: any) => void>()
  private readonly hasOpenedByMint = new Map<string, boolean>()
  private readonly wsFactory?: WebSocketFactory | undefined
  private readonly capabilitiesProvider?: {
    getMintInfo: (mintUrl: string) => Promise<MintInfo>
  }
  private paused = false

  constructor(
    wsFactoryOrManager: WebSocketFactory | RealTimeTransport,
    logger?: Logger,
    capabilitiesProvider?: {getMintInfo: (mintUrl: string) => Promise<MintInfo>}
  ) {
    this.logger = logger
    this.capabilitiesProvider = capabilitiesProvider
    if (typeof wsFactoryOrManager === "function") {
      this.wsFactory = wsFactoryOrManager
    } else {
      // Allow direct injection of a transport for tests; use it for all mints
      const injected = wsFactoryOrManager
      this.transportByMint.set("*", injected)
    }
  }

  private getTransport(mintUrl: string): RealTimeTransport {
    const injected = this.transportByMint.get("*")
    if (injected) return injected
    let t = this.transportByMint.get(mintUrl)
    if (t) return t

    // Decide per mint: prefer WS if available & supported; else polling
    const preferWs = this.isWebSocketAvailable()
    if (preferWs && this.wsFactory) {
      // Optional: check MintInfo for WS support
      // If capabilitiesProvider exists and indicates no WS, fallback immediately
      t = new WsTransport(this.wsFactory, this.logger)
    } else {
      t = new PollingTransport({intervalMs: 5000}, this.logger)
    }
    this.transportByMint.set(mintUrl, t)
    return t
  }

  private isWebSocketAvailable(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (globalThis as any).WebSocket !== "undefined" || !!this.wsFactory
  }

  private getNextId(mintUrl: string): number {
    const current = this.nextIdByMint.get(mintUrl) ?? 0
    const next = current + 1
    this.nextIdByMint.set(mintUrl, next)
    return next
  }

  private ensureMessageListener(mintUrl: string): void {
    if (this.messageHandlerByMint.has(mintUrl)) return
    const handler = (evt: any) => {
      try {
        const data = typeof evt.data === "string" ? evt.data : evt.data?.toString?.()
        if (!data) return
        const parsed = JSON.parse(data) as WsNotification<unknown> | WsResponse
        if ("method" in parsed && parsed.method === "subscribe") {
          const subId = parsed.params?.subId
          const active = subId ? this.subscriptions.get(subId) : undefined
          if (active) {
            for (const cb of active.callbacks) {
              Promise.resolve(
                cb((parsed as WsNotification<unknown>).params.payload)
              ).catch((err) =>
                this.logger?.error("Subscription callback error", {mintUrl, subId, err})
              )
            }
          }
        } else if ("error" in parsed && (parsed as WsResponse).error) {
          const resp = parsed as WsResponse
          const respId = Number((resp as any).id)
          const err = resp.error!
          const pendingMap = this.pendingSubscribeByMint.get(mintUrl)
          const maybeSubId =
            Number.isFinite(respId) && pendingMap ? pendingMap.get(respId) : undefined
          if (maybeSubId) {
            this.subscriptions.delete(maybeSubId)
            pendingMap?.delete(respId)
            this.logger?.error("Subscribe request rejected", {
              mintUrl,
              id: resp.id,
              subId: maybeSubId,
              code: err.code,
              message: err.message,
            })
          } else {
            this.logger?.error("WS request error", {
              mintUrl,
              id: resp.id,
              code: err.code,
              message: err.message,
            })
          }
        } else if ("result" in parsed && (parsed as WsResponse).result) {
          const resp = parsed as WsResponse
          const respId = Number((resp as any).id)
          const pendingMap = this.pendingSubscribeByMint.get(mintUrl)
          if (Number.isFinite(respId) && pendingMap && pendingMap.has(respId)) {
            pendingMap.delete(respId)
            this.logger?.info("Subscribe request accepted", {
              mintUrl,
              id: resp.id,
              subId: resp.result?.subId,
            })
          }
        }
      } catch (err) {
        this.logger?.error("WS message handling error", {mintUrl, err})
      }
    }
    const t = this.getTransport(mintUrl)
    t.on(mintUrl, "message", handler)
    this.messageHandlerByMint.set(mintUrl, handler)

    // Also ensure an 'open' listener that re-subscribes active subs on reconnect
    const onOpen = (_evt: any) => {
      try {
        const hasOpened = this.hasOpenedByMint.get(mintUrl) === true
        if (hasOpened) {
          this.logger?.info("WS open detected, re-subscribing active subscriptions", {
            mintUrl,
          })
          this.reSubscribeMint(mintUrl)
        } else {
          this.hasOpenedByMint.set(mintUrl, true)
          this.logger?.info("WS open detected, initial open - skipping re-subscribe", {
            mintUrl,
          })
        }
      } catch (err) {
        this.logger?.error("Failed to handle open event", {mintUrl, err})
      }
    }
    const t2 = this.getTransport(mintUrl)
    t2.on(mintUrl, "open", onOpen)
    this.openHandlerByMint.set(mintUrl, onOpen)
  }

  async subscribe<TPayload = unknown>(
    mintUrl: string,
    kind: SubscriptionKind,
    filters: string[],
    onNotification?: SubscriptionCallback<TPayload>
  ): Promise<{subId: string; unsubscribe: UnsubscribeHandler}> {
    if (!filters || filters.length === 0) {
      throw new Error("filters must be a non-empty array")
    }
    this.ensureMessageListener(mintUrl)
    const id = this.getNextId(mintUrl)
    const subId = generateSubId()

    const req: WsRequest = {
      jsonrpc: "2.0",
      method: "subscribe",
      params: {kind, subId, filters},
      id,
    }

    const active: ActiveSubscription<unknown> = {
      subId,
      mintUrl,
      kind,
      filters,
      callbacks: new Set<SubscriptionCallback<unknown>>(),
    }
    if (onNotification)
      active.callbacks.add(onNotification as unknown as SubscriptionCallback<unknown>)
    this.subscriptions.set(subId, active)

    // index by mint for reconnect
    let set = this.activeByMint.get(mintUrl)
    if (!set) {
      set = new Set<string>()
      this.activeByMint.set(mintUrl, set)
    }
    set.add(subId)

    // Track pending subscribe by request id so we can handle error responses
    let pendingById = this.pendingSubscribeByMint.get(mintUrl)
    if (!pendingById) {
      pendingById = new Map<number, string>()
      this.pendingSubscribeByMint.set(mintUrl, pendingById)
    }
    pendingById.set(id, subId)

    // If paused, subscription is registered but won't be sent until resume
    if (this.paused) {
      this.logger?.info("Subscription created while paused, will activate on resume", {
        mintUrl,
        kind,
        subId,
      })
      return {
        subId,
        unsubscribe: async () => {
          await this.unsubscribe(mintUrl, subId)
        },
      }
    }

    const t = this.getTransport(mintUrl)
    // If ws is not supported by the mint, choose polling now
    if (this.capabilitiesProvider) {
      void this.capabilitiesProvider
        .getMintInfo(mintUrl)
        .then((info) => {
          // If info indicates no WS, force polling transport
          // Heuristic: if we already created a WS transport but mint has no WS, swap to polling for future actions
          // We keep pendingMap/OK handling via synthetic response in PollingTransport
          if (!this.isMintWsSupported(info)) {
            this.transportByMint.set(
              mintUrl,
              new PollingTransport({intervalMs: 5000}, this.logger)
            )
          }
        })
        .catch(() => undefined)
    }
    t.send(mintUrl, req)
    this.logger?.info("Subscribed to NUT-17", {
      mintUrl,
      kind,
      subId,
      filterCount: filters.length,
    })

    return {
      subId,
      unsubscribe: async () => {
        await this.unsubscribe(mintUrl, subId)
      },
    }
  }

  addCallback<TPayload = unknown>(
    subId: string,
    cb: SubscriptionCallback<TPayload>
  ): void {
    const active = this.subscriptions.get(subId)
    if (!active) throw new Error("Subscription not found")
    active.callbacks.add(cb as unknown as SubscriptionCallback<unknown>)
  }

  removeCallback<TPayload = unknown>(
    subId: string,
    cb: SubscriptionCallback<TPayload>
  ): void {
    const active = this.subscriptions.get(subId)
    if (!active) return
    active.callbacks.delete(cb as unknown as SubscriptionCallback<unknown>)
  }

  async unsubscribe(mintUrl: string, subId: string): Promise<void> {
    const id = this.getNextId(mintUrl)
    const req: WsRequest = {
      jsonrpc: "2.0",
      method: "unsubscribe",
      params: {subId},
      id,
    }
    const t = this.getTransport(mintUrl)
    t.send(mintUrl, req)
    this.subscriptions.delete(subId)
    const set = this.activeByMint.get(mintUrl)
    set?.delete(subId)
    this.logger?.info("Unsubscribed from NUT-17", {mintUrl, subId})
  }

  closeAll(): void {
    // Close all transports
    const seen = new Set<RealTimeTransport>()
    for (const t of this.transportByMint.values()) {
      if (seen.has(t)) continue
      seen.add(t)
      t.closeAll()
    }
    this.subscriptions.clear()
    this.activeByMint.clear()
    this.pendingSubscribeByMint.clear()
    this.hasOpenedByMint.clear()
  }

  private reSubscribeMint(mintUrl: string): void {
    const set = this.activeByMint.get(mintUrl)
    if (!set || set.size === 0) return
    // Re-send subscribe requests with the same subId/filters/kind
    for (const subId of set) {
      const active = this.subscriptions.get(subId)
      if (!active) continue
      const id = this.getNextId(mintUrl)
      const req: WsRequest = {
        jsonrpc: "2.0",
        method: "subscribe",
        params: {kind: active.kind, subId: active.subId, filters: active.filters},
        id,
      }
      // Track pending subscribe by id to catch errors
      let pendingById = this.pendingSubscribeByMint.get(mintUrl)
      if (!pendingById) {
        pendingById = new Map<number, string>()
        this.pendingSubscribeByMint.set(mintUrl, pendingById)
      }
      pendingById.set(id, subId)
      const t = this.getTransport(mintUrl)
      t.send(mintUrl, req)
      this.logger?.info("Re-subscribed to NUT-17 after reconnect", {
        mintUrl,
        kind: active.kind,
        subId: active.subId,
        filterCount: active.filters.length,
      })
    }
  }

  private isMintWsSupported(_info: MintInfo): boolean {
    if (_info.nuts[17]) {
      const supported = _info.nuts[17].supported
      const requiredKinds = ["bolt11_melt_quote", "proof_state", "bolt11_mint_quote"]

      for (const s of supported) {
        if (s.unit === "sat") {
          const supportedKinds = new Set<string>(s.commands)
          return requiredKinds.every((required) => supportedKinds.has(required))
        }
      }
    }
    return false
  }

  pause(): void {
    this.paused = true
    // Pause all transports
    const seen = new Set<RealTimeTransport>()
    for (const t of this.transportByMint.values()) {
      if (seen.has(t)) continue
      seen.add(t)
      t.pause()
    }
    this.logger?.info("SubscriptionManager paused")
  }

  resume(): void {
    this.paused = false
    // Resume all transports
    const seen = new Set<RealTimeTransport>()
    for (const t of this.transportByMint.values()) {
      if (seen.has(t)) continue
      seen.add(t)
      t.resume()
    }
    // Re-subscribe all active subscriptions
    for (const mintUrl of this.activeByMint.keys()) {
      this.reSubscribeMint(mintUrl)
    }
    this.logger?.info("SubscriptionManager resumed")
  }
}
