import {KIND_CHANNEL_MESSAGE, DEBUG_NAMESPACES} from "@/utils/constants"
import {usePublicChatsStore} from "@/stores/publicChats"
import {useMessagesStore} from "@/stores/messages"
import {useUserStore} from "../stores/user"
import {ndk} from "@/utils/ndk"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export const migrateUserState = () => {
  const migrateFromLocalStorage = <T>(key: string, defaultValue: T): T => {
    try {
      const storedValue = localStorage.getItem(`localState/${key}`)
      if (storedValue) {
        try {
          const parsedValue = JSON.parse(storedValue)
          const extractedValue =
            parsedValue && typeof parsedValue === "object" && "value" in parsedValue
              ? parsedValue.value
              : parsedValue

          log(`Migrated ${key} from localStorage:`, extractedValue)
          localStorage.removeItem(`localState/${key}`)
          return extractedValue
        } catch (err) {
          error(`Error parsing ${key} from localStorage:`, err)
        }
      }
    } catch (err) {
      error(`Error migrating ${key} from localStorage:`, err)
    }
    return defaultValue
  }

  const state = useUserStore.getState()
  state.setPublicKey(migrateFromLocalStorage("user/publicKey", state.publicKey))
  state.setPrivateKey(migrateFromLocalStorage("user/privateKey", state.privateKey))
  state.setNip07Login(migrateFromLocalStorage("user/nip07Login", state.nip07Login))
}

const DEFAULT_PUBLIC_CHAT_ID =
  "1d2f13b495d7425b70298a8acd375897a632562043d461e89b63499363eaf8e7"

export const migratePublicChats = async () => {
  await useMessagesStore.getState().awaitHydration()
  if (!useMessagesStore.getState().enablePublicChats) return

  const migrationKey = "publicChats:migrated"

  if (localStorage.getItem(migrationKey)) return

  // Wait for store to hydrate before adding chats
  await usePublicChatsStore.getState().awaitHydration()

  const store = usePublicChatsStore.getState()
  const myPubKey = useUserStore.getState().publicKey
  if (!myPubKey) return
  const channelIds = new Set<string>([DEFAULT_PUBLIC_CHAT_ID])

  const events = await ndk()
    .fetchEvents({
      kinds: [KIND_CHANNEL_MESSAGE],
      authors: [myPubKey],
      limit: 100,
    })
    .catch(console.error)

  events?.forEach((event) => {
    const channelIdTag = event.tags.find((tag) => tag[0] === "e" && tag[3] === "root")
    if (channelIdTag && channelIdTag[1]) {
      channelIds.add(channelIdTag[1])
    }
  })

  await Promise.allSettled(
    Array.from(channelIds).map((channelId) =>
      store.addOrRefreshChatById(channelId).catch(console.error)
    )
  )

  localStorage.setItem(migrationKey, "true")
}
