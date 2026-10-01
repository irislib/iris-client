import {PublicKey} from "@/shared/utils/PublicKey"
import classNames from "classnames"
import {useMemo} from "react"

import useProfile from "@/shared/hooks/useProfile.ts"
import type {SearchResult} from "@/utils/profileSearchData"
import animalName from "@/utils/AnimalName"
import {useContactMemory} from "@/shared/hooks/useContactMemory"
import {publicProfileName} from "@/utils/publicProfileName"

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
  const memory = useContactMemory(pubKeyHex)

  const name =
    memory?.nickname ||
    memory?.accepted_name ||
    publicProfileName(profile) ||
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
  }, [name, pubKeyHex])

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
