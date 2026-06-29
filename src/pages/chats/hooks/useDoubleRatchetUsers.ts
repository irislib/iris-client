import {useEffect, useState, useCallback} from "react"
import {useUserStore} from "@/stores/user"
// import {useUserRecordsStore} from "@/stores/userRecords" // TEMP: Removed
// import {useSessionsStore} from "@/stores/sessions" // TEMP: Removed
import {useSocialGraph} from "@/utils/socialGraph"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {
  subscribeToDoubleRatchetUsersChanges,
  searchDoubleRatchetUsers,
  getDoubleRatchetUsersCount,
  getAllDoubleRatchetUsers,
  replaceDoubleRatchetUserCandidates,
  DoubleRatchetUser,
} from "../utils/doubleRatchetUsers"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UI_CHAT)

export const useDoubleRatchetUsers = () => {
  const socialGraph = useSocialGraph()
  const [users, setUsers] = useState<DoubleRatchetUser[]>([])
  const [count, setCount] = useState(0)
  const myPubKey = useUserStore((state) => state.publicKey)

  // Initialize subscription and set up reactive updates
  useEffect(() => {
    if (!myPubKey) return

    // let sessionsUnsubscribe: (() => void) | null = null // TEMP: Unused
    let pollInterval: NodeJS.Timeout | null = null
    let socialGraphSize = -1
    // let previousSessionPartners: Set<string> = new Set() // TEMP: Unused

    // TEMP: Disabled getSessionPartner
    // const getSessionPartner = (sessionId: string): string => {
    //   return sessionId.split(":")[0]
    // }

    // Get all current session partners
    const getCurrentSessionPartners = (): Set<string> => {
      // TEMP: Return empty set
      return new Set<string>()
    }

    const getCandidatePubkeys = (): Set<string> => {
      const candidates = new Set<string>()
      socialGraph.getUsersByFollowDistance(1).forEach((pubkey) => {
        candidates.add(pubkey)
      })
      getCurrentSessionPartners().forEach((pubkey) => {
        candidates.add(pubkey)
      })
      return candidates
    }

    const syncCandidatePubkeys = () => {
      const follows = socialGraph.getUsersByFollowDistance(1)
      if (follows.size !== socialGraphSize) {
        if (socialGraphSize >= 0) {
          log(`Social graph size changed from ${socialGraphSize} to ${follows.size}`)
        }
        socialGraphSize = follows.size
      }

      replaceDoubleRatchetUserCandidates(getCandidatePubkeys(), myPubKey)
    }

    // Subscribe to sessions store changes
    const subscribeToSessions = () => {
      syncCandidatePubkeys()
      // previousSessionPartners = new Set(getCurrentSessionPartners()) // TEMP: Unused

      // TEMP: Skip subscribing to future changes
      // sessionsUnsubscribe = useUserRecordsStore.subscribe(() => {
      //   ...
      // })
    }

    const checkAndCleanup = () => {
      syncCandidatePubkeys()
    }

    // Update state with current data
    const updateState = () => {
      setUsers(getAllDoubleRatchetUsers())
      setCount(getDoubleRatchetUsersCount())
    }

    // Initial setup
    subscribeToSessions()
    updateState()

    // Subscribe to changes from the utility
    const unsubscribeFromChanges = subscribeToDoubleRatchetUsersChanges(updateState)

    // Start polling for social graph changes and cleanup every 10 seconds
    pollInterval = setInterval(checkAndCleanup, 10000)

    // Cleanup function
    return () => {
      // if (sessionsUnsubscribe) {
      //   sessionsUnsubscribe()
      // } // TEMP: Disabled
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      unsubscribeFromChanges()
    }
  }, [myPubKey, socialGraph])

  // Search function - memoized to prevent infinite loops
  const search = useCallback((query: string) => {
    return searchDoubleRatchetUsers(query)
  }, [])

  return {
    users,
    count,
    search,
  }
}
