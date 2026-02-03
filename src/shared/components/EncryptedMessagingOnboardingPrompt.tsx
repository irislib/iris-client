import {Link} from "@/navigation"
import {useDevicesStore} from "@/stores/devices"
import Icon from "@/shared/components/Icons/Icon"

const EncryptedMessagingOnboardingPrompt = () => {
  const {appKeysManagerReady, sessionManagerReady, canSendPrivateMessages} =
    useDevicesStore()

  const isInitializing = !appKeysManagerReady || !sessionManagerReady
  const needsSetup = !isInitializing && !canSendPrivateMessages

  if (!needsSetup) {
    return null
  }

  return (
    <div className="bg-base-200 border-b border-custom p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Icon name="lock" size={20} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Enable Encrypted Messaging</div>
          <div className="text-sm text-base-content/70 mt-0.5">
            Register this device to send end-to-end encrypted DMs
          </div>
        </div>
        <Link to="/chats/new/devices" className="btn btn-primary btn-sm flex-shrink-0">
          Set Up
        </Link>
      </div>
    </div>
  )
}

export default EncryptedMessagingOnboardingPrompt
