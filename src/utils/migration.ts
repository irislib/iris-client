import {CHANNEL_MESSAGE} from "@/pages/chats/utils/constants"
import {usePublicChatsStore} from "@/stores/publicChats"
import {useUserStore} from "../stores/user"
import {ndk} from "@/utils/ndk"

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

          console.log(`Migrated ${key} from localStorage:`, extractedValue)
          localStorage.removeItem(`localState/${key}`)
          return extractedValue
        } catch (error) {
          console.error(`Error parsing ${key} from localStorage:`, error)
        }
      }
    } catch (error) {
      console.error(`Error migrating ${key} from localStorage:`, error)
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
  const migrationKey = "publicChats:migrated"

  if (localStorage.getItem(migrationKey)) return

  const store = usePublicChatsStore.getState()
  const myPubKey = useUserStore.getState().publicKey
  const channelIds = new Set<string>([DEFAULT_PUBLIC_CHAT_ID])

  const events = await ndk()
    .fetchEvents({
      kinds: [CHANNEL_MESSAGE],
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
