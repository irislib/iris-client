import {useEffect, useState, useCallback} from "react"
import {useUserStore} from "@/stores/user"
import {useSessionsStore} from "@/stores/sessions"
import socialGraph from "@/utils/socialGraph"
import {subscribe} from "@/utils/applesauce"
import {NostrEvent} from "nostr-tools"
import {
  subscribeToDoubleRatchetUsersChanges,
  searchDoubleRatchetUsers,
  getDoubleRatchetUsersCount,
  getAllDoubleRatchetUsers,
  getAllDoubleRatchetUserPubkeys,
  addDoubleRatchetUser,
  removeDoubleRatchetUser,
  DoubleRatchetUser,
} from "../utils/doubleRatchetUsers"

export const useDoubleRatchetUsers = () => {
  const [users, setUsers] = useState<DoubleRatchetUser[]>([])
  const [count, setCount] = useState(0)
  const myPubKey = useUserStore((state) => state.publicKey)

  // Initialize subscription and set up reactive updates
  useEffect(() => {
    if (!myPubKey) return

    let currentSub: {
      stop: () => void
      on: (event: string, handler: (data: NostrEvent) => void) => void
    } | null = null
    let sessionsUnsubscribe: (() => void) | null = null
    let pollInterval: NodeJS.Timeout | null = null
    let socialGraphSize = 0
    let previousSessionPartners: Set<string> = new Set()

    // Extract session partner pubkey from sessionId (format: "pubkey:sessionName")
    const getSessionPartner = (sessionId: string): string => {
      return sessionId.split(":")[0]
    }

    // Get all current session partners
    const getCurrentSessionPartners = (): Set<string> => {
      const sessions = useSessionsStore.getState().sessions
      const partners = new Set<string>()
      for (const sessionId of sessions.keys()) {
        const partner = getSessionPartner(sessionId)
        partners.add(partner)
      }
      return partners
    }

    // Handle incoming events
    const handleEvent = (event: NostrEvent) => {
      console.log("Received event", event)
      if (event.kind !== 30078) {
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

      const authors = Array.from(socialGraph().getUsersByFollowDistance(1))
      authors.push(myPubKey)
      socialGraphSize = authors.length - 1 // excluding myPubKey

      currentSub = subscribe({
        kinds: [30078],
        authors,
        "#l": ["double-ratchet/invites"],
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
      previousSessionPartners = new Set(currentPartners)

      // Subscribe to future changes
      sessionsUnsubscribe = useSessionsStore.subscribe(() => {
        const currentPartners = getCurrentSessionPartners()

        // Find new partners
        const newPartners = new Set(
          [...currentPartners].filter((p) => !previousSessionPartners.has(p))
        )

        // Add new partners to doubleRatchetUsers
        newPartners.forEach((partner) => {
          console.log("Adding new session partner to doubleRatchetUsers:", partner)
          addDoubleRatchetUser(partner)
        })

        // Update previous partners for next comparison
        previousSessionPartners = new Set(currentPartners)
      })
    }

    // Check if social graph size has changed and update subscription if needed
    const checkSocialGraphChanges = () => {
      const currentSize = socialGraph().getUsersByFollowDistance(1).size
      if (currentSize !== socialGraphSize) {
        console.log(`Social graph size changed from ${socialGraphSize} to ${currentSize}`)
        createSubscription()
      }
    }

    // Clean up stale users who are no longer in sessions or follows
    const cleanupStaleUsers = () => {
      const currentPartners = getCurrentSessionPartners()
      const currentFollows = new Set(
        Array.from(socialGraph().getUsersByFollowDistance(1))
      )

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
          console.log("Removing stale user from doubleRatchetUsers:", pubkey)
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
    const unsubscribeFromChanges = subscribeToDoubleRatchetUsersChanges(updateState)

    // Start polling for social graph changes and cleanup every 10 seconds
    pollInterval = setInterval(checkAndCleanup, 10000)

    // Cleanup function
    return () => {
      if (currentSub) {
        currentSub.stop()
      }
      if (sessionsUnsubscribe) {
        sessionsUnsubscribe()
      }
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
