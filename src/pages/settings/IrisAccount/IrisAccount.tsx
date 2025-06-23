/* eslint-disable @typescript-eslint/no-explicit-any */
import {SubscriberBadge} from "@/shared/components/user/SubscriberBadge"
import {profileCache} from "@/utils/memcache"
import ActiveAccount from "./ActiveAccount"
import ChallengeForm from "./ChallengeForm"
import {useUserStore} from "@/stores/user"
import RegisterForm from "./RegisterForm"
import {useEffect, useState} from "react"
import AccountName from "./AccountName"
import IrisAPI from "@/utils/IrisAPI"

// Main component
function IrisAccount() {
  const [irisToActive, setIrisToActive] = useState(false)
  const [existing, setExisting] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showChallenge, setShowChallenge] = useState(false)
  const [pendingUsername, setPendingUsername] = useState("")
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(null)
  const [minUsernameLength, setMinUsernameLength] = useState(8)
  const [api] = useState(() => new IrisAPI())

  const myPubKey = useUserStore.getState().publicKey

  // Fetch user account data
  const checkExistingAccount = async (pub: string) => {
    if (!pub) return

    const url = `${CONFIG.defaultSettings.irisApiUrl}/user/find?public_key=${pub}&nocache=${Date.now()}`
    const res = await fetch(url)

    if (res.status === 200) {
      const json = await res.json()
      console.log("User data:", json)

      // Handle subscription data
      if (json.subscription_plan) {
        const plan = json.subscription_plan.toLowerCase()
        let minLength = 8

        if (plan.includes("vanguard")) minLength = 3
        else if (plan.includes("champion")) minLength = 5
        else if (plan.includes("patron")) minLength = 6

        setSubscriptionPlan(json.subscription_plan)
        setMinUsernameLength(minLength)
      } else {
        setSubscriptionPlan(null)
        setMinUsernameLength(8)
      }

      // Set existing username if available
      if (json.name) setExisting(json)
    }
  }

  // Handle registration
  const handleRegister = async (username: string) => {
    setPendingUsername(username)
    // Skip Cloudflare verification for users with active subscriptions
    if (subscriptionPlan) {
      await registerDirectly(username)
    } else {
      setShowChallenge(true)
    }
  }

  // Register directly without Cloudflare challenge for subscribers
  const registerDirectly = async (username: string) => {
    try {
      const response = await api.registerUsername(username)
      if (response.signed_up) {
        setError(null)
        setExisting({name: username})
      }
    } catch (err) {
      console.error("Registration error:", err)
      setError("Error during registration")
    }
  }

  // Handle Cloudflare verification
  const handleVerify = async (cfToken: string) => {
    try {
      const response = await api.registerUsername(pendingUsername, cfToken)
      if (response.signed_up) {
        setError(null)
        setExisting({name: pendingUsername})
        setShowChallenge(false)
      }
    } catch (err) {
      console.error("Verification error:", err)
      setError("Error during verification")
    }
  }

  // Setup effects
  useEffect(() => {
    // User store subscription handler
    const handleUserChange = (state: any) => {
      const userPubKey = state.publicKey
      if (userPubKey && typeof userPubKey === "string") {
        const userProfile = profileCache.get(userPubKey) || {}
        setProfile(userProfile)

        const isIrisToActive = Boolean(
          userProfile?.nip05 && userProfile.nip05.endsWith("@iris.to")
        )
        setIrisToActive(isIrisToActive)

        checkExistingAccount(userPubKey)
      }
    }

    // Setup subscriptions
    const unsubscribe = useUserStore.subscribe(handleUserChange)
    handleUserChange(useUserStore.getState())

    return () => {
      unsubscribe()
    }
  }, [])

  // Render based on state
  if (irisToActive) {
    return (
      <div className="flex flex-col gap-2">
        <AccountName name={profile?.nip05?.split("@")[0]} />
        <SubscriberBadge className="mt-2" pubkey={myPubKey} />
      </div>
    )
  }

  if (existing) {
    return (
      <div className="flex flex-col gap-2">
        <ActiveAccount name={existing.name} setAsPrimary={() => setIrisToActive(true)} />
        <SubscriberBadge className="mt-2" pubkey={myPubKey} />
      </div>
    )
  }

  if (error) {
    return <div className="error">Error: {error}</div>
  }

  if (showChallenge) {
    return <ChallengeForm onVerify={handleVerify} />
  }

  return (
    <div className="flex flex-col">
      <RegisterForm
        minLength={minUsernameLength}
        subscriptionPlan={subscriptionPlan}
        onRegister={handleRegister}
      />
    </div>
  )
}

export default IrisAccount
