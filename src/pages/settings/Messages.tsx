import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingToggle} from "@/shared/components/settings/SettingToggle"
import {useMessagesStore} from "@/stores/messages"

function Messages() {
  const {enablePublicChats, setEnablePublicChats} = useMessagesStore()

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
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
