import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"
import {initAppKeysManager, registerDevice} from "@/shared/services/PrivateChats"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const AUTO_REGISTER_TIMEOUT_MS = 2000
let autoRegistrationInProgress = false

export const autoRegisterDevice = async () => {
  const initialDeviceState = useDevicesStore.getState()
  if (!initialDeviceState.pendingAutoRegistration || autoRegistrationInProgress) return
  autoRegistrationInProgress = true

  try {
    const {publicKey, linkedDevice} = useUserStore.getState()
    if (!publicKey || linkedDevice) return

    await initAppKeysManager()
    if (useDevicesStore.getState().isCurrentDeviceRegistered) return

    // Short timeout — new users won't have existing AppKeys on relays
    await registerDevice(AUTO_REGISTER_TIMEOUT_MS)
    log("Auto-registered device for private messaging")
  } catch (err) {
    error("Failed to auto-register device:", err)
  } finally {
    autoRegistrationInProgress = false
    useDevicesStore.getState().setPendingAutoRegistration(false)
  }
}
