import {EventTemplate} from "nostr-tools"
import socialGraph from "@/utils/socialGraph"
import {publishEvent, getCurrentSigner} from "@/utils/applesauce"

type Hexpubkey = string

export const muteUser = async (pubkey: string): Promise<string[]> => {
  // Check if pubkey already exists in the list before adding
  const myKey = socialGraph().getRoot()
  const mutedList = socialGraph().getMutedByUser(myKey)
  const newList = mutedList.has(pubkey) ? [...mutedList] : [...mutedList, pubkey]
  const newTags = newList.map((entry: string) => ["p", entry])

  const muteEventTemplate: EventTemplate = {
    kind: 10000,
    created_at: Math.floor(Date.now() / 1000),
    tags: newTags,
    content: "",
  }

  try {
    const signer = getCurrentSigner()
    if (!signer) {
      throw new Error("No signer available")
    }
    const signedEvent = await signer.signEvent(muteEventTemplate)
    console.log("created mute event", signedEvent)
    socialGraph().handleEvent(signedEvent)

    // Publish to relays
    publishEvent(muteEventTemplate).catch((error: Error) => {
      console.warn("Unable to publish mute event", error)
    })
  } catch (error) {
    console.warn("Unable to mute user", error)
    return Array.from(mutedList)
  }

  return newList
}

export const unmuteUser = async (pubkey: string): Promise<string[]> => {
  const myKey = socialGraph().getRoot()
  const mutedList = socialGraph().getMutedByUser(myKey)
  const newList = Array.from(mutedList).filter((entry: string) => entry !== pubkey)
  const newTags = newList.map((entry: string) => ["p", entry])

  const unmuteEventTemplate: EventTemplate = {
    kind: 10000,
    created_at: Math.floor(Date.now() / 1000),
    tags: newTags,
    content: "",
  }

  try {
    const signer = getCurrentSigner()
    if (!signer) {
      throw new Error("No signer available")
    }
    const signedEvent = await signer.signEvent(unmuteEventTemplate)
    socialGraph().handleEvent(signedEvent)

    // Publish to relays
    publishEvent(unmuteEventTemplate).catch((error: Error) => {
      console.warn("Unable to publish unmute event", error)
    })
  } catch (error) {
    console.warn("Unable to unmute user", error)
    return Array.from(mutedList)
  }

  return newList
}

export const submitReport = async (
  reason: string,
  content: string,
  pubkey: Hexpubkey, //pubkey needed
  id?: string //event optional
) => {
  const reportEventTemplate: EventTemplate = {
    kind: 1984,
    created_at: Math.floor(Date.now() / 1000),
    content: content,
    tags: id
      ? [
          ["e", id, reason],
          ["p", pubkey],
        ]
      : [["p", pubkey, reason]],
  }

  try {
    await publishEvent(reportEventTemplate)
  } catch (error) {
    console.warn("Unable to send report", error)
    return Promise.reject(error)
  }
}
