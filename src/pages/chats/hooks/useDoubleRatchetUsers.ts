import {useEffect, useState, useCallback} from "react"
import {useUserStore} from "@/stores/user"
// import {useUserRecordsStore} from "@/stores/userRecords" // TEMP: Removed
// import {useSessionsStore} from "@/stores/sessions" // TEMP: Removed
import {useSocialGraph} from "@/utils/socialGraph"
import {ndk} from "@/utils/ndk"
import {NDKEvent, NDKSubscription} from "@/lib/ndk"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES, KIND_APP_DATA} from "@/utils/constants"
import {
  // subscribeToDoubleRatchetUsersChanges, // TEMP: Unused
  searchDoubleRatchetUsers,
  getDoubleRatchetUsersCount,
  getAllDoubleRatchetUsers,
  getAllDoubleRatchetUserPubkeys,
  addDoubleRatchetUser,
  removeDoubleRatchetUser,
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

    let currentSub: NDKSubscription | null = null
    // let sessionsUnsubscribe: (() => void) | null = null // TEMP: Unused
    let pollInterval: NodeJS.Timeout | null = null
    let socialGraphSize = 0
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

    // Handle incoming events
    const handleEvent = (event: NDKEvent) => {
      if (event.kind !== KIND_APP_DATA) {
        return
      }
      if (event.tags.length > 0) {
        addDoubleRatchetUser(event.pubkey)
      } else {
        removeDoubleRatchetUser(event.pubkey)
      }
    }

    // Create subscription with current authors
    const createSubscription = () => {
      if (currentSub) {
        currentSub.stop()
      }

      const authors = Array.from(socialGraph.getUsersByFollowDistance(1))
      authors.push(myPubKey)
      socialGraphSize = authors.length - 1 // excluding myPubKey

      currentSub = ndk().subscribe({
        kinds: [KIND_APP_DATA],
        authors,
        "#d": ["double-ratchet/app-keys"],
      })

      currentSub.on("event", handleEvent)
    }

    // Subscribe to sessions store changes
    const subscribeToSessions = () => {
      // Add all existing session partners
      const currentPartners = getCurrentSessionPartners()
      currentPartners.forEach((partner) => {
        addDoubleRatchetUser(partner)
      })
      // previousSessionPartners = new Set(currentPartners) // TEMP: Unused

      // TEMP: Skip subscribing to future changes
      // sessionsUnsubscribe = useUserRecordsStore.subscribe(() => {
      //   ...
      // })
    }

    // Check if social graph size has changed and update subscription if needed
    const checkSocialGraphChanges = () => {
      const currentSize = socialGraph.getUsersByFollowDistance(1).size
      if (currentSize !== socialGraphSize) {
        log(`Social graph size changed from ${socialGraphSize} to ${currentSize}`)
        createSubscription()
      }
    }

    // Clean up stale users who are no longer in sessions or follows
    const cleanupStaleUsers = () => {
      const currentPartners = getCurrentSessionPartners()
      const currentFollows = new Set(Array.from(socialGraph.getUsersByFollowDistance(1)))

      // Get all current double ratchet user pubkeys (from the Set, not just those with profiles)
      const allUserPubkeys = getAllDoubleRatchetUserPubkeys()

      // Remove users who are no longer in sessions AND not in follows
      // But never remove the user's own public key
      allUserPubkeys.forEach((pubkey) => {
        // Never remove the user's own public key
        if (pubkey === myPubKey) {
          return
        }
        const isSessionPartner = currentPartners.has(pubkey)
        const isFollowed = currentFollows.has(pubkey)

        if (!isSessionPartner && !isFollowed) {
          log("Removing stale user from doubleRatchetUsers:", pubkey)
          removeDoubleRatchetUser(pubkey)
        }
      })
    }

    // Combined check function that handles both social graph changes and cleanup
    const checkAndCleanup = () => {
      checkSocialGraphChanges()
      cleanupStaleUsers()
    }

    // Update state with current data
    const updateState = () => {
      setUsers(getAllDoubleRatchetUsers())
      setCount(getDoubleRatchetUsersCount())
    }

    // Initial setup
    subscribeToSessions()
    createSubscription()
    updateState()

    // Subscribe to changes from the utility
    // TEMP: Dummy unsubscribe function
    const unsubscribeFromChanges = () => {}
    // subscribeToDoubleRatchetUsersChanges(updateState)

    // Start polling for social graph changes and cleanup every 10 seconds
    pollInterval = setInterval(checkAndCleanup, 10000)

    // Cleanup function
    return () => {
      if (currentSub) {
        currentSub.stop()
      }
      // if (sessionsUnsubscribe) {
      //   sessionsUnsubscribe()
      // } // TEMP: Disabled
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      unsubscribeFromChanges()
    }
  }, [myPubKey])

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
