import {PublicKey} from "@/shared/utils/PublicKey"
import classNames from "classnames"
import {useMemo} from "react"

import useProfile from "@/shared/hooks/useProfile.ts"
import type {SearchResult} from "@/utils/profileSearchData"
import animalName from "@/utils/AnimalName"

export function Name({
  pubKey,
  className,
  fallbackProfile,
}: {
  pubKey: string
  className?: string
  fallbackProfile?: Pick<SearchResult, "name" | "nip05">
}) {
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

  const profile = useProfile(pubKey, true)

  const name =
    profile?.display_name ||
    profile?.name ||
    profile?.username ||
    profile?.nip05?.split("@")[0] ||
    fallbackProfile?.name ||
    fallbackProfile?.nip05?.split("@")[0]

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
        "inline-block min-w-0",
        className
      )}
    >
      {name || animal}
    </span>
  )
}
