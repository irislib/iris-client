import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingToggle} from "@/shared/components/settings/SettingToggle"
import {useMessagesStore} from "@/stores/messages"

function Messages() {
  const {
    enablePublicChats,
    setEnablePublicChats,
    sendDeliveryReceipts,
    setSendDeliveryReceipts,
    sendReadReceipts,
    setSendReadReceipts,
    receiveMessageRequests,
    setReceiveMessageRequests,
  } = useMessagesStore()

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <SettingsGroup title="Receipts">
            <SettingToggle
              checked={sendDeliveryReceipts}
              onChange={() => setSendDeliveryReceipts(!sendDeliveryReceipts)}
              label="Send delivery receipts"
            />
            <SettingToggle
              checked={sendReadReceipts}
              onChange={() => setSendReadReceipts(!sendReadReceipts)}
              label="Send read receipts"
              isLast
            />
          </SettingsGroup>
          <SettingsGroup title="Requests">
            <SettingToggle
              checked={receiveMessageRequests}
              onChange={() => setReceiveMessageRequests(!receiveMessageRequests)}
              label="Receive message requests from non-followed users"
              isLast
            />
          </SettingsGroup>
          <SettingsGroup title="Public Chats">
            <SettingToggle
              checked={enablePublicChats}
              onChange={() => setEnablePublicChats(!enablePublicChats)}
              label="Enable public chats"
              isLast
            />
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default Messages
