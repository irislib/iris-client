import {NDKEvent} from "@/lib/ndk"
import {Filter} from "nostr-tools"
import {ndk} from "@/utils/ndk"
import {KIND_HTTP_AUTH} from "@/utils/constants"

export interface PushNotifications {
  endpoint: string
  p256dh: string
  auth: string
}

export interface NotificationSubscription {
  id?: string
  webhooks: unknown[]
  web_push_subscriptions: PushNotifications[]
  fcm_tokens?: string[]
  apns_tokens?: string[]
  social_graph_filter?: boolean
  filter: {
    ids?: string[]
    authors?: string[]
    kinds: number[]
    search?: string
    "#p"?: string[]
    "#e"?: string[]
  }
  subscriber: string
}

export interface NotificationSubscriptionResponse {
  [key: string]: NotificationSubscription
}

/**
 * Can be used for web push notifications
 */
export default class IrisAPI {
  #url: string

  constructor(url?: string) {
    this.#url = new URL(url ?? CONFIG.defaultSettings.irisApiUrl).toString()
  }

  twitterImport(username: string) {
    return this.#getJson<Array<string>>(
      `api/v1/twitter/follows-for-nostr?username=${encodeURIComponent(username)}`
    )
  }

  getPushNotificationInfo() {
    return this.#getJson<{vapid_public_key: string}>("info")
  }

  getNotificationSubscriptions() {
    return this.getJsonAuthd<NotificationSubscriptionResponse>("subscriptions/")
  }

  registerUsername(username: string, cfToken?: string) {
    // For users with subscriptions, cfToken is optional
    const data: {username: string; cfToken?: string} = {username}
    if (cfToken) {
      data.cfToken = cfToken
    }
    return this.getJsonAuthd<{signed_up: boolean}>("user/register", "POST", data)
  }

  registerPushNotifications(
    web_push_subscriptions: PushNotifications[],
    filter: Filter,
    mobile_tokens?: {fcm_tokens?: string[]; apns_tokens?: string[]},
    social_graph_filter = false
  ) {
    return this.getJsonAuthd<void>(`subscriptions`, "POST", {
      web_push_subscriptions,
      webhooks: [],
      filter,
      fcm_tokens: mobile_tokens?.fcm_tokens || [],
      apns_tokens: mobile_tokens?.apns_tokens || [],
      social_graph_filter,
    })
  }

  updateNotificationSubscription(id: string, subscription: NotificationSubscription) {
    return this.getJsonAuthd<void>(`subscriptions/${id}`, "POST", subscription)
  }

  deleteNotificationSubscription(id: string) {
    return this.getJsonAuthd<void>(`subscriptions/${id}`, "DELETE")
  }

  async getJsonAuthd<T>(
    path: string,
    method?: "GET" | string,
    body?: object,
    headers?: {[key: string]: string}
  ): Promise<T> {
    const event = new NDKEvent(ndk(), {
      kind: KIND_HTTP_AUTH, // http authentication
      tags: [
        ["u", `${this.#url}${path}`],
        ["method", method ?? "GET"],
      ],
      content: "",
      created_at: Math.floor(Date.now() / 1000),
    })
    await event.sign()
    const nostrEvent = await event.toNostrEvent()

    // Ensure the event is encoded correctly
    const encodedEvent = btoa(JSON.stringify(nostrEvent))

    return this.#getJson<T>(path, method, body, {
      ...headers,
      authorization: `Nostr ${encodedEvent}`,
    })
  }

  async #getJson<T>(
    path: string,
    method?: "GET" | string,
    body?: object,
    headers?: {[key: string]: string}
  ): Promise<T> {
    const rsp = await fetch(`${this.#url}${path}`, {
      method: method,
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        accept: "application/json",
        ...(body ? {"content-type": "application/json"} : {}),
        ...headers,
      },
    })

    if (rsp.ok) {
      const text = (await rsp.text()) as string | null
      if ((text?.length ?? 0) > 0) {
        const obj = JSON.parse(text!)
        if (typeof obj === "object" && "error" in obj) {
          throw new Error(obj.error, obj.code)
        }
        return obj as T
      } else {
        return {} as T
      }
    } else {
      throw new Error("Invalid response")
    }
  }
}
