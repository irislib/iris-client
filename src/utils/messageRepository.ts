import {comparator} from "@/pages/chats/utils/messageGrouping"
import type {MessageType} from "@/pages/chats/message/Message"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import Dexie, {type EntityTable} from "dexie"

export type MessageEntity = MessageType & {session_id: string}

class MessageDb extends Dexie {
  public messages!: EntityTable<MessageEntity, "id">
  constructor() {
    super("Messages")
    this.version(1).stores({
      messages: "id, session_id, created_at",
    })
  }
}

const db = new MessageDb()

export async function loadAll(): Promise<Map<string, SortedMap<string, MessageType>>> {
  const msgArray = await db.messages.toArray()
  const sessionMap = new Map<string, SortedMap<string, MessageType>>()
  msgArray.forEach((msg) => {
    const {session_id, ...event} = msg
    const m =
      sessionMap.get(session_id) || new SortedMap<string, MessageType>([], comparator)
    m.set(event.id, event)
    sessionMap.set(session_id, m)
  })
  return sessionMap
}

export async function save(sessionId: string, message: MessageType): Promise<void> {
  const msg = {session_id: sessionId, ...message}
  await db.messages.put(msg, msg.id)
}

export async function deleteBySession(sessionId: string): Promise<void> {
  await db.messages.where("session_id").equals(sessionId).delete()
}

export async function clearAll(): Promise<void> {
  await db.messages.clear()
}

export async function deleteMessage(sessionId: string, messageId: string): Promise<void> {
  await db.messages
    .where("session_id")
    .equals(sessionId)
    .and((msg) => msg.id === messageId)
    .delete()
}
