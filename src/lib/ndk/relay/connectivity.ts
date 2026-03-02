import type debug from "debug"
import type {NostrEvent} from "../events/index.js"
import {NDKEvent} from "../events/index.js"
import {NDKKind} from "../events/kinds"
import type {NDK, NDKNetDebug} from "../ndk/index.js"
import type {NDKFilter} from "../subscription"
import {Queue, yieldThread} from "../utils/queue.js"
import type {NDKRelay, NDKRelayConnectionStats} from "."
import {NDKRelayStatus} from "."
import {NDKRelayKeepalive, probeRelayConnection} from "./keepalive"
import type {NDKRelaySubscription} from "./subscription"

const MAX_RECONNECT_ATTEMPTS = 5
const FLAPPING_THRESHOLD_MS = 1000

export type CountResolver = {
  resolve: (count: number) => void
  reject: (err: Error) => void
}

export type EventPublishResolver = {
  resolve: (reason: string) => void
  reject: (err: Error) => void
}

export class NDKRelayConnectivity {
  private ndkRelay: NDKRelay
  private ws?: WebSocket
  private _status: NDKRelayStatus
  private timeoutMs?: number
  private connectedAt?: number
  private _connectionStats: NDKRelayConnectionStats = {
    attempts: 0,
    success: 0,
    durations: [],
  }
  private debug: debug.Debugger
  public netDebug?: NDKNetDebug
  private connectTimeout: ReturnType<typeof setTimeout> | undefined
  private reconnectTimeout: ReturnType<typeof setTimeout> | undefined
  private ndk?: NDK
  public openSubs: Map<string, NDKRelaySubscription> = new Map()
  private openCountRequests = new Map<string, CountResolver>()
  private openEventPublishes = new Map<string, EventPublishResolver[]>()
  private pendingAuthPublishes = new Map<string, NostrEvent>()
  private serial = 0
  public baseEoseTimeout = 4_400

  // Keepalive and monitoring
  private keepalive?: NDKRelayKeepalive
  private wsStateMonitor?: ReturnType<typeof setInterval>
  private sleepDetector?: ReturnType<typeof setInterval>
  private lastSleepCheck = Date.now()
  private lastMessageSent = Date.now()
  private wasIdle = false

  // Message queues for async processing (actor pattern: inbox/outbox)
  private inbox!: Queue<string> // Initialized in constructor after handleMessage is bound
  private outbox!: Queue<string>
  private outboxProcessing = false

  constructor(ndkRelay: NDKRelay, ndk?: NDK) {
    this.ndkRelay = ndkRelay
    this._status = NDKRelayStatus.DISCONNECTED
    const rand = Math.floor(Math.random() * 1000)
    this.debug = this.ndkRelay.debug.extend(`connectivity${rand}`)
    this.ndk = ndk

    // Initialize queues with processors
    // Inbox: 200 messages (receiving is cheap, allow burst capacity)
    // Outbox: 50 messages (~50KB per relay, 1.5MB for 30 relays)
    this.inbox = new Queue<string>(200, (msg) => this.handleMessage(msg))
    this.outbox = new Queue<string>(50, (msg) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(msg)
          this.netDebug?.(msg, this.ndkRelay, "send")
        } catch (e) {
          this.debug("WebSocket send failed:", e)
          this.handleStaleConnection()
        }
      }
    })

    this.setupMonitoring()
  }

  /**
   * Sets up keepalive, WebSocket state monitoring, and sleep detection
   */
  private setupMonitoring(): void {
    // Listen for browser online/offline events for immediate detection
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this.handleBrowserOffline)
      window.addEventListener("online", this.handleBrowserOnline)
    }

    // Setup keepalive to detect silent relays
    this.keepalive = new NDKRelayKeepalive(120000, async () => {
      this.debug("Relay silence detected, probing connection")
      const isAlive = await probeRelayConnection({
        send: (msg: any[]) => this.send(JSON.stringify(msg)),
        once: (event: string, handler: () => void) => {
          const messageHandler = (e: MessageEvent) => {
            try {
              const data = JSON.parse(e.data)
              if (data[0] === "EOSE" || data[0] === "EVENT" || data[0] === "NOTICE") {
                handler()
                this.ws?.removeEventListener("message", messageHandler)
              }
            } catch {}
          }
          this.ws?.addEventListener("message", messageHandler)
        },
      })

      if (!isAlive) {
        this.debug("Probe failed, connection is stale")
        this.handleStaleConnection()
      }
    })

    // Monitor WebSocket readyState every 2 seconds (faster detection)
    this.wsStateMonitor = setInterval(() => {
      if (this._status === NDKRelayStatus.CONNECTED) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.debug("WebSocket died silently, reconnecting")
          this.handleStaleConnection()
        }
      }
    }, 2000)

    // Detect system sleep by monitoring time gaps
    this.sleepDetector = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastSleepCheck

      // If more than 15 seconds elapsed (should be 10), system was likely suspended
      if (elapsed > 15000) {
        this.debug(`Detected possible sleep/wake (${elapsed}ms gap)`)
        this.handlePossibleWake()
      }

      this.lastSleepCheck = now
    }, 10000)
  }

  /**
   * Handles detection of a stale connection
   */
  private handleStaleConnection(): void {
    this._status = NDKRelayStatus.DISCONNECTED
    this.wasIdle = true // Mark as idle to reset backoff
    this.onDisconnect()
  }

  /**
   * Handles possible system wake event
   */
  private handlePossibleWake(): void {
    this.debug("System wake detected, checking all connections")
    this.wasIdle = true // Reset backoff for wake scenario

    // If we think we're connected but might not be, force reconnect
    if (this._status >= NDKRelayStatus.CONNECTED) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.handleStaleConnection()
      } else {
        // Connection seems OK, but probe to be sure
        probeRelayConnection({
          send: (msg: any[]) => this.send(JSON.stringify(msg)),
          once: (event: string, handler: () => void) => {
            const messageHandler = (e: MessageEvent) => {
              try {
                const data = JSON.parse(e.data)
                if (data[0] === "EOSE" || data[0] === "EVENT" || data[0] === "NOTICE") {
                  handler()
                  this.ws?.removeEventListener("message", messageHandler)
                }
              } catch {}
            }
            this.ws?.addEventListener("message", messageHandler)
          },
        }).then((isAlive) => {
          if (!isAlive) {
            this.handleStaleConnection()
          }
        })
      }
    }
  }

  /**
   * Resets the reconnection state for system-wide events
   * Used by NDKPool when detecting system sleep/wake
   */
  public resetReconnectionState(): void {
    this.wasIdle = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
  }

  /**
   * Connects to the NDK relay and handles the connection lifecycle.
   *
   * This method attempts to establish a WebSocket connection to the NDK relay specified in the `ndkRelay` object.
   * If the connection is successful, it updates the connection statistics, sets the connection status to `CONNECTED`,
   * and emits `connect` and `ready` events on the `ndkRelay` object.
   *
   * If the connection attempt fails, it handles the error by either initiating a reconnection attempt or emitting a
   * `delayed-connect` event on the `ndkRelay` object, depending on the `reconnect` parameter.
   *
   * @param timeoutMs - The timeout in milliseconds for the connection attempt. If not provided, the default timeout from the `ndkRelay` object is used.
   * @param reconnect - Indicates whether a reconnection should be attempted if the connection fails. Defaults to `true`.
   * @returns A Promise that resolves when the connection is established, or rejects if the connection fails.
   */
  async connect(timeoutMs?: number, reconnect = true): Promise<void> {
    // Check if WebSocket exists but is not open (stale connection)
    if (
      this.ws &&
      this.ws.readyState !== WebSocket.OPEN &&
      this.ws.readyState !== WebSocket.CONNECTING
    ) {
      this.debug("Cleaning up stale WebSocket connection")
      try {
        this.ws.close()
      } catch (e) {
        // Ignore errors when closing stale connection
      }
      this.ws = undefined
      this._status = NDKRelayStatus.DISCONNECTED
    }

    if (
      (this._status !== NDKRelayStatus.RECONNECTING &&
        this._status !== NDKRelayStatus.DISCONNECTED) ||
      this.reconnectTimeout
    ) {
      this.debug(
        "Relay requested to be connected but was in state %s or it had a reconnect timeout",
        this._status
      )
      return
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }

    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout)
      this.connectTimeout = undefined
    }

    timeoutMs ??= this.timeoutMs
    if (!this.timeoutMs && timeoutMs) this.timeoutMs = timeoutMs

    if (this.timeoutMs)
      this.connectTimeout = setTimeout(
        () => this.onConnectionError(reconnect),
        this.timeoutMs
      )

    try {
      this.updateConnectionStats.attempt()
      if (this._status === NDKRelayStatus.DISCONNECTED)
        this._status = NDKRelayStatus.CONNECTING
      else this._status = NDKRelayStatus.RECONNECTING

      this.ws = new WebSocket(this.ndkRelay.url)
      this.ws.onopen = this.onConnect.bind(this)
      this.ws.onclose = this.onDisconnect.bind(this)
      this.ws.onmessage = this.onMessage.bind(this)
      this.ws.onerror = this.onError.bind(this)
    } catch (e) {
      this.debug(`Failed to connect to ${this.ndkRelay.url}`, e)
      this._status = NDKRelayStatus.DISCONNECTED
      if (reconnect) this.handleReconnection()
      else this.ndkRelay.emit("delayed-connect", 2 * 24 * 60 * 60 * 1000)
      throw e
    }
  }

  /**
   * Disconnects the WebSocket connection to the NDK relay.
   * This method sets the connection status to `NDKRelayStatus.DISCONNECTING`,
   * attempts to close the WebSocket connection, and sets the status to
   * `NDKRelayStatus.DISCONNECTED` if the disconnect operation fails.
   */
  public disconnect(): void {
    this._status = NDKRelayStatus.DISCONNECTING

    // Clean up monitoring
    this.keepalive?.stop()
    if (this.wsStateMonitor) {
      clearInterval(this.wsStateMonitor)
      this.wsStateMonitor = undefined
    }
    if (this.sleepDetector) {
      clearInterval(this.sleepDetector)
      this.sleepDetector = undefined
    }

    // Remove browser event listeners
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.handleBrowserOffline)
      window.removeEventListener("online", this.handleBrowserOnline)
    }

    try {
      this.ws?.close()
    } catch (e) {
      this.debug("Failed to disconnect", e)
      this._status = NDKRelayStatus.DISCONNECTED
    }
  }

  /**
   * Process and validate an event received from the relay.
   * @returns NDKEvent if valid, undefined if invalid
   */
  private processEvent(rawEvent: NostrEvent): NDKEvent | undefined {
    // Create NDKEvent
    const ndkEvent = new NDKEvent(this.ndk, rawEvent)
    ndkEvent.ndk = this.ndk
    ndkEvent.relay = this.ndkRelay

    // Check expiration (NIP-40)
    const expirationTag = ndkEvent.getMatchingTags("expiration")[0]
    if (expirationTag && expirationTag[1]) {
      const expirationTime = parseInt(expirationTag[1])
      const now = Math.floor(Date.now() / 1000)
      if (now >= expirationTime) {
        this.debug(
          "Event expired %s (expiration: %d, now: %d)",
          rawEvent.id,
          expirationTime,
          now
        )
        // Queue for batched deletion from cache
        if (this.ndk?.cacheAdapter && "queueExpiredEvent" in this.ndk.cacheAdapter) {
          ;(this.ndk.cacheAdapter as any).queueExpiredEvent(rawEvent.id)
        }
        return undefined
      }
    }

    // Validate event
    if (!ndkEvent.isValid) {
      this.debug("Event failed validation %s from relay %s", rawEvent.id, this.ndkRelay.url)
      return undefined
    }

    // Verify signature
    const shouldVerify = this.ndkRelay.shouldValidateEvent()
    if (shouldVerify) {
      if (this.ndk?.asyncSigVerification) {
        // Async verification
        ndkEvent.verifySignature(true)
      } else {
        // Sync verification
        if (!ndkEvent.verifySignature(true)) {
          this.debug("Event failed signature validation", rawEvent)
          this.ndk?.reportInvalidSignature(ndkEvent, this.ndkRelay)
          return undefined
        }
        this.ndkRelay.addValidatedEvent()
      }
    } else {
      this.ndkRelay.addNonValidatedEvent()
    }

    // Track that this relay has seen the event for de-dup and provenance checks.
    this.ndk?.subManager.seenEvent(rawEvent.id!, this.ndkRelay)

    return ndkEvent
  }

  /**
   * Handles the error that occurred when attempting to connect to the NDK relay.
   * If `reconnect` is `true`, this method will initiate a reconnection attempt.
   * Otherwise, it will emit a `delayed-connect` event on the `ndkRelay` object,
   * indicating that a reconnection should be attempted after a delay.
   *
   * @param reconnect - Indicates whether a reconnection should be attempted.
   */
  onConnectionError(reconnect: boolean): void {
    this.debug(`Error connecting to ${this.ndkRelay.url}`, this.timeoutMs)
    if (reconnect && !this.reconnectTimeout) {
      this.handleReconnection()
    }
  }

  /**
   * Handles the connection event when the WebSocket connection is established.
   * This method is called when the WebSocket connection is successfully opened.
   * It clears any existing connection and reconnection timeouts, updates the connection statistics,
   * sets the connection status to `CONNECTED`, and emits `connect` and `ready` events on the `ndkRelay` object.
   */
  private onConnect() {
    this.netDebug?.("connected", this.ndkRelay)
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout)
      this.connectTimeout = undefined
    }
    this.updateConnectionStats.connected()
    this._status = NDKRelayStatus.CONNECTED

    // Start keepalive monitoring
    this.keepalive?.start()
    this.wasIdle = false

    this.ndkRelay.emit("connect")
    this.ndkRelay.emit("ready")
  }

  /**
   * Handles the disconnection event when the WebSocket connection is closed.
   * This method is called when the WebSocket connection is successfully closed.
   * It updates the connection statistics, sets the connection status to `DISCONNECTED`,
   * initiates a reconnection attempt if we didn't disconnect ourselves,
   * and emits a `disconnect` event on the `ndkRelay` object.
   */
  private onDisconnect() {
    this.netDebug?.("disconnected", this.ndkRelay)
    this.updateConnectionStats.disconnected()

    // Stop keepalive when disconnected
    this.keepalive?.stop()

    // Clear any pending publish/auth promises to prevent memory leaks
    this.clearPendingPublishes(new Error(`Relay ${this.ndkRelay.url} disconnected`))

    if (this._status === NDKRelayStatus.CONNECTED) {
      this.handleReconnection()
    }
    this._status = NDKRelayStatus.DISCONNECTED
    this.ndkRelay.emit("disconnect")
  }

  /**
   * Handles incoming messages from the NDK relay WebSocket connection.
   * This method is called whenever a message is received from the relay.
   * It parses the message data and dispatches the appropriate handling logic based on the message type.
   *
   * @param event - The MessageEvent containing the received message data.
   */
  /**
   * Fast extraction of event ID from JSON string without parsing.
   * Returns event ID if message is EVENT type, null otherwise.
   */
  private getEventIdFromMessage(msg: string): string | null {
    // Fast check: msg[2] === 'E' && msg[3] === 'V' (EVENT message)
    if (msg.charCodeAt(2) !== 69 || msg.charCodeAt(3) !== 86) {
      return null
    }
    const idPos = msg.indexOf('"id":"')
    if (idPos === -1) {
      return null
    }
    // Extract 64 chars after "id":"
    // Event IDs are always 64 hex chars. If not valid, LRU lookup will fail
    // and we'll parse normally - no harm done.
    return msg.substring(idPos + 6, idPos + 70)
  }

  private onMessage(event: MessageEvent): void {
    this.netDebug?.(event.data, this.ndkRelay, "recv")

    // Record any activity from relay
    this.keepalive?.recordActivity()

    // Enqueue message - queue auto-processes with yielding
    this.inbox.enqueue(event.data as string)
  }

  /**
   * Process outbox queue - send all queued messages
   */
  private processOutbox(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    let message = this.outbox.dequeue()
    while (message) {
      try {
        this.ws.send(message)
        this.netDebug?.(message, this.ndkRelay, "send")
      } catch (e) {
        this.debug("WebSocket send failed during outbox processing:", e)
        this.handleStaleConnection()
        return // Stop processing outbox
      }
      message = this.outbox.dequeue()
    }
  }

  /**
   * Handle individual message from inbox (called by Queue processor)
   */
  private handleMessage(msg: string): void {
    // Early exit for duplicate events before JSON.parse
    const eventId = this.getEventIdFromMessage(msg)
    if (eventId && this.ndk) {
      const seenData = this.ndk.subManager.seenEvents.get(eventId)
      const seenRelayCount = Array.isArray(seenData)
        ? seenData.length
        : (seenData?.relays?.length ?? 0)
      if (seenRelayCount > 0) {
        // Already processed from any relay, just track this relay saw it
        this.ndk.subManager.seenEvent(eventId, this.ndkRelay)
        return
      }
    }

    try {
      const data = JSON.parse(msg)
      const [cmd, id, ..._rest] = data

      // Check for registered protocol handlers first
      const handler = this.ndkRelay.getProtocolHandler(cmd)
      if (handler) {
        handler(this.ndkRelay, data)
        return
      }

      switch (cmd) {
        case "EVENT": {
          const so = this.openSubs.get(id)
          const rawEvent = data[2] as NostrEvent
          if (!so) {
            this.debug(`Received event for unknown subscription ${id}`)
            return
          }

          const ndkEvent = this.processEvent(rawEvent)
          if (!ndkEvent) return // Failed validation/verification

          // Pass processed NDKEvent to subscription
          so.onevent(ndkEvent)
          return
        }
        case "COUNT": {
          const payload = data[2] as {count: number}
          const cr = this.openCountRequests.get(id) as CountResolver
          if (cr) {
            cr.resolve(payload.count)
            this.openCountRequests.delete(id)
          }
          return
        }
        case "EOSE": {
          const so = this.openSubs.get(id)
          if (!so) return
          so.oneose(id)
          return
        }
        case "OK": {
          const ok: boolean = data[2]
          const reason: string = data[3]
          const ep = this.openEventPublishes.get(id) as EventPublishResolver[] | undefined
          const firstEp = ep?.pop()

          if (!ep || !firstEp) {
            this.debug("Received OK for unknown event publish", id)
            return
          }

          if (ok) {
            firstEp.resolve(reason)
            // Clean up the pending auth publish since it succeeded
            this.pendingAuthPublishes.delete(id)
            // Continue processing remaining resolvers
          } else {
            // Check if this is an auth-required error
            // Different relays use different error messages for auth requirements
            const isAuthRequired =
              reason &&
              (reason.toLowerCase().includes("auth-required") ||
                reason.toLowerCase().includes("not authorized") ||
                reason.toLowerCase().includes("blocked: not authorized"))

            if (isAuthRequired) {
              // Get the pending event from pendingAuthPublishes
              const event = this.pendingAuthPublishes.get(id)
              if (event) {
                this.debug(
                  "Publish failed due to auth-required, will retry after auth",
                  id
                )
                // Don't reject yet - keep the resolver for retry after auth
                // Put the resolver back so we can resolve/reject it after auth
                ep.push(firstEp)
                this.openEventPublishes.set(id, ep)
              } else {
                // Event not found in pending, reject normally
                firstEp.reject(new Error(reason))
              }
            } else {
              firstEp.reject(new Error(reason))
              // Clean up the pending auth publish for non-auth errors
              this.pendingAuthPublishes.delete(id)
            }
          }

          if (ep.length === 0) {
            this.openEventPublishes.delete(id)
          } else if (
            !ok &&
            !(
              reason?.toLowerCase().includes("auth-required") ||
              reason?.toLowerCase().includes("not authorized") ||
              reason?.toLowerCase().includes("blocked: not authorized")
            )
          ) {
            // Only clear the publish map if it's not auth-required
            this.openEventPublishes.set(id, ep)
          }
          return
        }
        case "CLOSED": {
          const so = this.openSubs.get(id)
          if (!so) return
          so.onclosed(data[2] as string)
          return
        }
        case "NOTICE":
          this.onNotice(data[1] as string)
          return
        case "AUTH": {
          this.onAuthRequested(data[1] as string)
          return
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this.debug(
        `Error parsing message from ${this.ndkRelay.url}: ${error.message}`,
        error?.stack
      )
    }
  }

  /**
   * Handles an authentication request from the NDK relay.
   *
   * If an authentication policy is configured, it will be used to authenticate the connection.
   * Otherwise, the `auth` event will be emitted to allow the application to handle the authentication.
   *
   * @param challenge - The authentication challenge provided by the NDK relay.
   */
  private async onAuthRequested(challenge: string) {
    const authPolicy = this.ndkRelay.authPolicy ?? this.ndk?.relayAuthDefaultPolicy

    this.debug("Relay requested authentication", {
      havePolicy: !!authPolicy,
    })

    if (this._status === NDKRelayStatus.AUTHENTICATING) {
      this.debug("Already authenticating, ignoring")
      return
    }

    this._status = NDKRelayStatus.AUTH_REQUESTED

    if (authPolicy) {
      if (this._status >= NDKRelayStatus.CONNECTED) {
        this._status = NDKRelayStatus.AUTHENTICATING
        let res: boolean | NDKEvent | undefined | undefined
        try {
          res = await authPolicy(this.ndkRelay, challenge)
        } catch (e) {
          this.debug("Authentication policy threw an error", e)
          res = false
        }
        this.debug("Authentication policy returned", !!res)

        if (res instanceof NDKEvent || res === true) {
          if (res instanceof NDKEvent) {
            await this.auth(res)
          }

          const authenticate = async () => {
            if (
              this._status >= NDKRelayStatus.CONNECTED &&
              this._status < NDKRelayStatus.AUTHENTICATED
            ) {
              const event = new NDKEvent(this.ndk)
              event.kind = NDKKind.ClientAuth
              event.tags = [
                ["relay", this.ndkRelay.url],
                ["challenge", challenge],
              ]
              await event.sign()
              this.auth(event)
                .then(() => {
                  this._status = NDKRelayStatus.AUTHENTICATED
                  this.ndkRelay.emit("authed")
                  this.debug("Authentication successful")
                  this.retryPendingAuthPublishes()
                })
                .catch((e) => {
                  this._status = NDKRelayStatus.AUTH_REQUESTED
                  this.ndkRelay.emit("auth:failed", e)
                  this.debug("Authentication failed", e)
                  this.rejectPendingAuthPublishes(e)
                })
            } else {
              this.debug(
                "Authentication failed, it changed status, status is %d",
                this._status
              )
            }
          }

          if (res === true) {
            if (!this.ndk?.signer) {
              this.debug("No signer available for authentication localhost")
              this.ndk?.once("signer:ready", authenticate)
            } else {
              authenticate().catch((e) => {
                console.error("Error authenticating", e)
              })
            }
          }

          this._status = NDKRelayStatus.CONNECTED
          this.ndkRelay.emit("authed")
        }
      }
    } else {
      this.ndkRelay.emit("auth", challenge)
    }
  }

  /**
   * Handles errors that occur on the WebSocket connection to the relay.
   * @param error - The error or event that occurred.
   */
  private onError(error: Error | Event): void {
    this.debug(`WebSocket error on ${this.ndkRelay.url}:`, error)
  }

  /**
   * Gets the current status of the NDK relay connection.
   * @returns {NDKRelayStatus} The current status of the NDK relay connection.
   */
  get status(): NDKRelayStatus {
    return this._status
  }

  /**
   * Checks if the NDK relay connection is currently available.
   * @returns {boolean} `true` if the relay connection is in the `CONNECTED` status, `false` otherwise.
   */
  public isAvailable(): boolean {
    return this._status === NDKRelayStatus.CONNECTED
  }

  /**
   * Checks if the NDK relay connection is flapping, which means the connection is rapidly
   * disconnecting and reconnecting. This is determined by analyzing the durations of the
   * last three connection attempts. If the standard deviation of the durations is less
   * than 1000 milliseconds, the connection is considered to be flapping.
   *
   * @returns {boolean} `true` if the connection is flapping, `false` otherwise.
   */
  private isFlapping(): boolean {
    const durations = this._connectionStats.durations
    if (durations.length % 3 !== 0) return false

    const sum = durations.reduce((a, b) => a + b, 0)
    const avg = sum / durations.length
    const variance =
      durations.map((x) => (x - avg) ** 2).reduce((a, b) => a + b, 0) / durations.length
    const stdDev = Math.sqrt(variance)
    const isFlapping = stdDev < FLAPPING_THRESHOLD_MS

    return isFlapping
  }

  /**
   * Handles a notice received from the NDK relay.
   * If the notice indicates the relay is complaining (e.g. "too many" or "maximum"),
   * the method disconnects from the relay and attempts to reconnect after a 2-second delay.
   * A debug message is logged with the relay URL and the notice text.
   * The "notice" event is emitted on the ndkRelay instance with the notice text.
   *
   * @param notice - The notice text received from the NDK relay.
   */
  private async onNotice(notice: string) {
    if (notice.toLowerCase().includes("too many concurrent")) {
      this.debug(`Too many concurrent REQs. Active subscriptions (${this.openSubs.size}):`)
      for (const [subId, sub] of this.openSubs.entries()) {
        this.debug(`  - ${subId}: ${JSON.stringify(sub.executeFilters).slice(0, 200)}`)
      }
    }
    this.ndkRelay.emit("notice", notice)
  }

  /**
   * Attempts to reconnect to the NDK relay after a connection is lost.
   * This function is called recursively to handle multiple reconnection attempts.
   * It checks if the relay is flapping and emits a "flapping" event if so.
   * It then calculates a delay before the next reconnection attempt based on the number of previous attempts.
   * The function sets a timeout to execute the next reconnection attempt after the calculated delay.
   * If the maximum number of reconnection attempts is reached, a debug message is logged.
   *
   * @param attempt - The current attempt number (default is 0).
   */
  private handleReconnection(attempt = 0): void {
    if (this.reconnectTimeout) return

    if (this.isFlapping()) {
      this.ndkRelay.emit("flapping", this._connectionStats)
      this._status = NDKRelayStatus.FLAPPING
      return
    }

    // Calculate reconnect delay based on whether we were idle
    let reconnectDelay: number

    if (this.wasIdle) {
      // After idle/sleep, use aggressive reconnection: 0s, 1s, 2s, 5s, 10s, 30s
      const aggressiveDelays = [0, 1000, 2000, 5000, 10000, 30000]
      reconnectDelay = aggressiveDelays[Math.min(attempt, aggressiveDelays.length - 1)]
      this.debug(
        `Using aggressive reconnect after idle, attempt ${attempt}, delay ${reconnectDelay}ms`
      )
    } else if (this.connectedAt) {
      // Recent disconnection, wait before reconnecting
      reconnectDelay = Math.max(0, 60000 - (Date.now() - this.connectedAt))
    } else {
      // Standard exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
      reconnectDelay = Math.min(1000 * 2 ** attempt, 30000)
      this.debug(`Using standard backoff, attempt ${attempt}, delay ${reconnectDelay}ms`)
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined
      this._status = NDKRelayStatus.RECONNECTING

      this.connect().catch((_err) => {
        if (attempt < MAX_RECONNECT_ATTEMPTS) {
          // Continue with next attempt
          this.handleReconnection(attempt + 1)
        } else {
          this.debug("Max reconnect attempts reached")
          // Reset idle flag after max attempts
          this.wasIdle = false
        }
      })
    }, reconnectDelay)

    this.ndkRelay.emit("delayed-connect", reconnectDelay)
    this.debug("Reconnecting in", reconnectDelay)
    this._connectionStats.nextReconnectAt = Date.now() + reconnectDelay
  }

  /**
   * Sends a message to the NDK relay if the connection is in the CONNECTED state and the WebSocket is open.
   * If the connection is not in the CONNECTED state or the WebSocket is not open, logs a debug message and throws an error.
   *
   * @param message - The message to send to the NDK relay.
   * @throws {Error} If attempting to send on a closed relay connection.
   */
  async send(message: string) {
    // Check if we've been idle for a while
    const idleTime = Date.now() - this.lastMessageSent
    if (idleTime > 120000) {
      // 2 minutes
      this.wasIdle = true
    }

    if (
      this._status >= NDKRelayStatus.CONNECTED &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      // Process outbox if messages queued
      this.processOutbox()

      // Send immediately
      try {
        this.ws?.send(message)
        this.netDebug?.(message, this.ndkRelay, "send")
        this.lastMessageSent = Date.now()
      } catch (e) {
        this.debug("WebSocket send failed:", e)
        this.handleStaleConnection()
        // Re-queue the message
        this.outbox.enqueue(message)
      }
    } else {
      // Queue message for when relay connects
      this.debug(
        `Not connected to ${this.ndkRelay.url} (%d), queueing message`,
        this._status
      )
      this.outbox.enqueue(message)

      // If we think we're connected but WebSocket is not open, we have a stale connection
      if (
        this._status >= NDKRelayStatus.CONNECTED &&
        this.ws?.readyState !== WebSocket.OPEN
      ) {
        this.debug(`Stale connection detected, WebSocket state: ${this.ws?.readyState}`)
        // Force disconnect and reconnect
        this.handleStaleConnection()
      }

      // Detect saturated outbox - if queue is near full and we think we're connected, connection is dead
      // Threshold at 80% of capacity (40/50)
      if (this._status >= NDKRelayStatus.CONNECTED && this.outbox.size > 40) {
        this.debug(
          `Outbox saturated (${this.outbox.size}/50 messages), connection likely dead`
        )
        this.handleStaleConnection()
      }
    }
  }

  /**
   * Authenticates the NDK event by sending it to the NDK relay and returning a promise that resolves with the result.
   *
   * @param event - The NDK event to authenticate.
   * @returns A promise that resolves with the authentication result.
   */
  private async auth(event: NDKEvent): Promise<string> {
    const ret = new Promise<string>((resolve, reject) => {
      const val = this.openEventPublishes.get(event.id) ?? []
      val.push({resolve, reject})
      this.openEventPublishes.set(event.id, val)
    })
    this.send(`["AUTH",${JSON.stringify(event.rawEvent())}]`)
    return ret
  }

  /**
   * Clears all pending publish promises by rejecting them with the provided error.
   * This is called on disconnection to prevent memory leaks and ensure promises
   * don't hang indefinitely.
   * @param error The error to reject the promises with
   */
  private clearPendingPublishes(error: Error): void {
    // Reject any promises waiting for auth-required retry
    // rejectPendingAuthPublishes handles both pendingAuthPublishes and openEventPublishes
    this.rejectPendingAuthPublishes(error)

    // Clear any other outstanding publishes not related to auth
    for (const [eventId, resolvers] of this.openEventPublishes.entries()) {
      while (resolvers.length > 0) {
        const resolver = resolvers.shift()
        if (resolver) {
          resolver.reject(error)
        }
      }
      this.openEventPublishes.delete(eventId)
    }
  }

  /**
   * Retries all pending publishes that failed due to auth-required.
   * Called after successful authentication.
   */
  private retryPendingAuthPublishes(): void {
    if (this.pendingAuthPublishes.size === 0) return

    this.debug(`Retrying ${this.pendingAuthPublishes.size} pending publishes after auth`)

    for (const [eventId, event] of this.pendingAuthPublishes.entries()) {
      this.debug(`Retrying publish for event ${eventId}`)
      // Resend the event
      this.send(`["EVENT",${JSON.stringify(event)}]`)
    }

    // Clear the pending publishes - they're now back in openEventPublishes waiting for OK
    this.pendingAuthPublishes.clear()
  }

  /**
   * Rejects all pending publishes that failed due to auth-required.
   * Called when authentication fails.
   */
  private rejectPendingAuthPublishes(error: Error): void {
    if (this.pendingAuthPublishes.size === 0) return

    this.debug(
      `Rejecting ${this.pendingAuthPublishes.size} pending publishes due to auth failure`
    )

    for (const [eventId] of this.pendingAuthPublishes.entries()) {
      const ep = this.openEventPublishes.get(eventId)
      if (ep && ep.length > 0) {
        const resolver = ep.pop()
        if (resolver) {
          resolver.reject(new Error(`Authentication failed: ${error.message}`))
        }

        if (ep.length === 0) {
          this.openEventPublishes.delete(eventId)
        }
      }
    }

    this.pendingAuthPublishes.clear()
  }

  /**
   * Publishes an NDK event to the relay and returns a promise that resolves with the result.
   *
   * @param event - The NDK event to publish.
   * @returns A promise that resolves with the result of the event publication.
   * @throws {Error} If attempting to publish on a closed relay connection.
   */
  async publish(event: NostrEvent): Promise<string> {
    const ret = new Promise<string>((resolve, reject) => {
      const val = this.openEventPublishes.get(event.id!) ?? []
      if (val.length > 0) {
        console.warn(
          `Duplicate event publishing detected, you are publishing event ${event.id!} twice`
        )
      }

      val.push({resolve, reject})
      this.openEventPublishes.set(event.id!, val)
    })

    // Store the event in case we need to retry after auth
    this.pendingAuthPublishes.set(event.id!, event)

    this.send(`["EVENT",${JSON.stringify(event)}]`)
    return ret
  }

  /**
   * Counts the number of events that match the provided filters.
   *
   * @param filters - The filters to apply to the count request.
   * @param params - An optional object containing a custom id for the count request.
   * @returns A promise that resolves with the number of matching events.
   * @throws {Error} If attempting to send the count request on a closed relay connection.
   */
  async count(filters: NDKFilter[], params: {id?: string | null}): Promise<number> {
    this.serial++
    const id = params?.id || `count:${this.serial}`
    const ret = new Promise<number>((resolve, reject) => {
      this.openCountRequests.set(id, {resolve, reject})
    })
    this.send(JSON.stringify(["COUNT", id, ...filters]))
    return ret
  }

  public close(subId: string, reason?: string): void {
    this.send(`["CLOSE","${subId}"]`)
    const sub = this.openSubs.get(subId)
    this.openSubs.delete(subId)
    if (sub) sub.onclose(reason)
  }

  /**
   * Subscribes to the NDK relay with the provided filters and parameters.
   *
   * @param filters - The filters to apply to the subscription.
   * @param params - The subscription parameters, including an optional custom id.
   * @returns A new NDKRelaySubscription instance.
   */
  public req(relaySub: NDKRelaySubscription): void {
    const filters = relaySub.executeFilters
    if (!filters || filters.length === 0) {
      // NIP-01 requires at least one filter - skip empty subscriptions
      return
    }
    this.send(JSON.stringify(["REQ", relaySub.subId, ...filters]))
    this.openSubs.set(relaySub.subId, relaySub)
  }

  /**
   * Utility functions to update the connection stats.
   */
  private updateConnectionStats = {
    connected: () => {
      this._connectionStats.success++
      this._connectionStats.connectedAt = Date.now()
    },

    disconnected: () => {
      if (this._connectionStats.connectedAt) {
        this._connectionStats.durations.push(
          Date.now() - this._connectionStats.connectedAt
        )

        if (this._connectionStats.durations.length > 100) {
          this._connectionStats.durations.shift()
        }
      }
      this._connectionStats.connectedAt = undefined
    },

    attempt: () => {
      this._connectionStats.attempts++
      this._connectionStats.connectedAt = Date.now()
    },
  }

  /** Returns the connection stats. */
  get connectionStats(): NDKRelayConnectionStats {
    return this._connectionStats
  }

  /** Returns the relay URL */
  get url(): WebSocket["url"] {
    return this.ndkRelay.url
  }

  get connected(): boolean {
    return (
      this._status >= NDKRelayStatus.CONNECTED && this.ws?.readyState === WebSocket.OPEN
    )
  }

  /**
   * Handle browser offline event - immediately disconnect all relays
   */
  private handleBrowserOffline = () => {
    if (this._status >= NDKRelayStatus.CONNECTED) {
      this.debug("Browser offline event, disconnecting")
      this.handleStaleConnection()
    }
  }

  /**
   * Handle browser online event - reconnect if disconnected
   */
  private handleBrowserOnline = () => {
    if (this._status === NDKRelayStatus.DISCONNECTED) {
      this.debug("Browser online event, reconnecting")
      this.connect()
    }
  }
}
