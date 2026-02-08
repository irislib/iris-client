import {useEffect, useState} from "react"
import {AppKeys} from "nostr-double-ratchet"
import {getNostrSubscribe} from "@/shared/services/PrivateChats"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"

/**
 * Hook to check if a recipient has set up encrypted messaging (has AppKeys).
 * Returns null while checking, true if they have app keys, false if not.
 */
export const useRecipientHasAppKeys = (
  recipientPubkey: string | undefined
): {hasAppKeys: boolean | null} => {
  const [hasAppKeys, setHasAppKeys] = useState<boolean | null>(null)
  const myPubkey = useUserStore((state) => state.publicKey)
  const {hasLocalAppKeys, isCurrentDeviceRegistered} = useDevicesStore()

  useEffect(() => {
    if (!recipientPubkey) {
      setHasAppKeys(null)
      return
    }

    if (recipientPubkey === myPubkey && (hasLocalAppKeys || isCurrentDeviceRegistered)) {
      setHasAppKeys(true)
      return
    }

    setHasAppKeys(null)

    const unsubscribe = AppKeys.fromUser(
      recipientPubkey,
      getNostrSubscribe(),
      (appKeys) => {
        const devices = appKeys.getAllDevices()
        setHasAppKeys(devices.length > 0)
      }
    )

    // Set to false after timeout if no response
    const timeout = setTimeout(() => {
      setHasAppKeys((current) => (current === null ? false : current))
    }, 3000)

    return () => {
      unsubscribe()
      clearTimeout(timeout)
    }
  }, [recipientPubkey, myPubkey, hasLocalAppKeys, isCurrentDeviceRegistered])

  return {hasAppKeys}
}
