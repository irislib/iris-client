import localforage from "localforage"
import {
  CHAT_MESSAGE_KIND,
  parsePrivateGroupDelivery,
  previewPrivateGroupDelivery,
  type GroupData,
  type Rumor,
  type StorageAdapter,
} from "nostr-double-ratchet"
import {unwrapGroupRumor} from "./groupRumor"

export async function decryptPrivateGroupPush(
  rumor: Rumor,
  senderOwnerPubkey: string,
  storage: typeof localforage,
  keyPrefix: string,
  groupStorage: Pick<typeof localforage, "getItem"> = localforage
): Promise<{groupId: string; groupName: string; content: string} | undefined> {
  try {
    const event = parsePrivateGroupDelivery(rumor)
    const groupTags = rumor.tags.filter(([key]) => key === "l")
    if (!event || groupTags.length !== 1 || !groupTags[0][1]) return
    const groupId = groupTags[0][1]
    const [ourOwnerPubkey, ourDevicePubkey, storedGroups] = await Promise.all([
      storage.getItem<string>(`${keyPrefix}v1/device-manager/owner-pubkey`),
      storage.getItem<string>(`${keyPrefix}v1/device-manager/identity-public-key`),
      groupStorage.getItem("groups"),
    ])
    if (!ourOwnerPubkey || !ourDevicePubkey) return
    const state =
      typeof storedGroups === "string" ? JSON.parse(storedGroups) : storedGroups
    const group = state?.state?.groups?.[groupId] as GroupData | undefined
    if (!group || group.id !== groupId || group.accepted === false) return
    // The library copies group keys before decrypting. This adapter makes any
    // accidental mutation of the live ratchets fail instead of consuming them.
    const readOnly: StorageAdapter = {
      get: async <T>(key: string) =>
        (await storage.getItem<T>(keyPrefix + key)) ?? undefined,
      list: async (prefix = "") =>
        (await storage.keys())
          .filter((key) => key.startsWith(keyPrefix + prefix))
          .map((key) => key.slice(keyPrefix.length)),
      put: async () => {
        throw new Error("Notification preview is read only")
      },
      del: async () => {
        throw new Error("Notification preview is read only")
      },
    }
    const decrypted = await previewPrivateGroupDelivery({
      storage: readOnly,
      ourOwnerPubkey,
      ourDevicePubkey,
      group,
      event,
      senderOwnerPubkey,
    })
    if (!decrypted || decrypted.isSelf) return
    const inner = unwrapGroupRumor(
      decrypted.inner,
      groupId,
      senderOwnerPubkey,
      decrypted.senderDevicePubkey
    )
    if (!inner || inner.kind !== CHAT_MESSAGE_KIND) return
    return {groupId, groupName: group.name, content: inner.content}
  } catch {
    return
  }
}
