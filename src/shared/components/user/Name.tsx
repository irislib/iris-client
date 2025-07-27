import {PublicKey} from "@/shared/utils/PublicKey"
import classNames from "classnames"
import {useMemo} from "react"

import useProfile from "@/shared/hooks/useProfile.ts"
import animalName from "@/utils/AnimalName"

export function Name({pubKey, className}: {pubKey: string; className?: string}) {
  const pubKeyHex = useMemo(() => {
    if (!pubKey || pubKey === "follows") {
      return ""
    }
    try {
      return new PublicKey(pubKey).toString()
    } catch (error) {
      console.warn(error)
      return ""
    }
  }, [pubKey])

  const profile = useProfile(pubKey, false)

  const name =
    profile?.display_name ||
    profile?.name ||
    profile?.username ||
    (profile?.nip05 as string)?.split("@")[0]

  const animal = useMemo(() => {
    if (name) {
      return ""
    }
    if (!pubKeyHex) {
      return ""
    }
    return animalName(pubKeyHex)
  }, [profile, pubKeyHex])

  return (
    <span
      className={classNames(
        {
          italic: !!animal,
          "opacity-50": !!animal,
        },
        className
      )}
    >
      {String(name || animal)}
    </span>
  )
}
