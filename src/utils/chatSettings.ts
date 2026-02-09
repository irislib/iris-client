export type ChatSettingsPayloadV1 = {
  type: "chat-settings"
  v: 1
  messageTtlSeconds: number | null
}

export function parseChatSettingsMessage(content: string): ChatSettingsPayloadV1 | null {
  if (!content) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const obj = parsed as Record<string, unknown>
  if (obj.type !== "chat-settings") return null
  if (obj.v !== 1) return null

  const ttl = obj.messageTtlSeconds
  if (ttl === null) {
    return {type: "chat-settings", v: 1, messageTtlSeconds: null}
  }
  if (typeof ttl === "number" && Number.isFinite(ttl)) {
    const normalized = Math.floor(ttl)
    return {
      type: "chat-settings",
      v: 1,
      messageTtlSeconds: normalized > 0 ? normalized : null,
    }
  }

  return null
}
