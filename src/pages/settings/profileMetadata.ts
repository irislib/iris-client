import {readProfileFields} from "@iris/profile-events"
import {verifyEvent, type Event} from "nostr-tools/pure"

export type ProfileMetadata = Record<string, unknown>
export type ProfileEditorField =
  "display_name" | "about" | "website" | "picture" | "banner" | "lud16" | "nip05"
export type ProfileEdits = Partial<Record<ProfileEditorField, string>>

export function readProfileMetadata(source: string | undefined, pubkey: string) {
  if (!source) return null
  try {
    const event = JSON.parse(source)
    if (
      event.kind !== 0 ||
      event.pubkey !== pubkey ||
      typeof event.content !== "string"
    ) {
      return null
    }
    if (!verifyEvent(event)) return null
    return {metadata: readProfileFields(event.content), event: event as Event}
  } catch {
    return null
  }
}

export function profileEditorValues(metadata: ProfileMetadata) {
  const value = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof metadata[key] === "string") return metadata[key] as string
    }
    return ""
  }
  return {
    display_name: value("display_name", "displayName", "name", "username"),
    about: value("about", "bio"),
    website: value("website"),
    picture: value("picture", "image"),
    banner: value("banner"),
    lud16: value("lud16"),
    nip05: value("nip05"),
  }
}

export function customProfileFields(metadata: ProfileMetadata) {
  const known = profileEditorValues({})
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !Object.hasOwn(known, key))
  )
}
