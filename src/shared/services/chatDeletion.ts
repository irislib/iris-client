type ChatDeletionManager = {
  deleteChat?: (userPubkey: string) => Promise<void>
  deleteUser: (userPubkey: string) => Promise<void>
}

const normalizeChatId = (chatId: string): string => {
  const peer = chatId.split(":")[0]?.trim()
  return peer || chatId
}

export const deletePrivateChat = async (
  manager: ChatDeletionManager,
  chatId: string
): Promise<void> => {
  const peerPubkey = normalizeChatId(chatId)

  if (typeof manager.deleteChat === "function") {
    await manager.deleteChat(peerPubkey)
    return
  }

  await manager.deleteUser(peerPubkey)
}
