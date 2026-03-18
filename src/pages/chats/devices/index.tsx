import {useEffect} from "react"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"
import {getDelegateManager, initDelegateManager} from "@/shared/services/PrivateChats"
import DeviceList from "./DeviceList"
import RegisterDevice from "./RegisterDevice"
import LinkDeviceInvite from "./LinkDeviceInvite"

const DevicesTab = () => {
  const publicKey = useUserStore((s) => s.publicKey)
  const {setIdentityPubkey} = useDevicesStore()

  useEffect(() => {
    if (!publicKey) {
      return
    }

    let cancelled = false

    void initDelegateManager()
      .then(() => {
        if (cancelled) {
          return
        }

        const delegateManager = getDelegateManager()
        setIdentityPubkey(delegateManager.getIdentityPublicKey())
      })
      .catch(() => {
        // DelegateManager failed to initialize; leave identity unset.
      })

    return () => {
      cancelled = true
    }
  }, [publicKey, setIdentityPubkey])

  if (!publicKey) {
    return (
      <div className="p-4 text-center text-base-content/60">
        Please log in to manage devices
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm text-base-content/70">
        Manage devices that can send and receive encrypted messages on your behalf.
      </div>
      <LinkDeviceInvite />
      <RegisterDevice />
      <DeviceList />
    </div>
  )
}

export default DevicesTab
