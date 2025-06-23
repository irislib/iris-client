import {SubscriberBadge} from "@/shared/components/user/SubscriberBadge"
import React, {FormEvent, useState} from "react"
import {useUserStore} from "@/stores/user"
import AccountName from "./AccountName"
import {Link} from "react-router"

interface RegisterFormProps {
  minLength: number
  subscriptionPlan: string | null
  onRegister: (username: string) => void
}

function RegisterForm({minLength, subscriptionPlan, onRegister}: RegisterFormProps) {
  const [username, setUsername] = useState("")
  const [isValid, setIsValid] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [isChecking, setIsChecking] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const pubKey = useUserStore.getState().publicKey

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    setUsername(name)
    setIsValid(false)
    setStatusMessage("")

    if (!name) {
      setErrorMessage("")
      return
    }

    // Length check
    if (name.length < minLength || name.length > 15) {
      setErrorMessage(`Username must be between ${minLength} and 15 characters`)
      return
    }

    // Format check
    if (!name.match(/^[a-z0-9_.]+$/)) {
      setErrorMessage(
        "Username must only contain lowercase letters, numbers, underscores and dots"
      )
      return
    }

    setErrorMessage("")
    checkAvailability(name)
  }

  const checkAvailability = async (name: string) => {
    setIsChecking(true)
    setStatusMessage("Checking availability...")
    setErrorMessage("")

    try {
      console.log(`Checking availability for: ${name}`)
      const url = `${CONFIG.defaultSettings.irisApiUrl}/user/available?name=${encodeURIComponent(name)}&public_key=${pubKey}`

      const response = await fetch(url)
      const text = await response.text()
      console.log(`API response (${response.status}): ${text}`)

      try {
        const json = JSON.parse(text)
        console.log("Parsed JSON:", json)

        if (json.available === true) {
          console.log("Username IS available")
          setIsValid(true)
          setStatusMessage("Username is available")
          setErrorMessage("")
        } else {
          console.log("Username is NOT available")
          setIsValid(false)
          const message = json.message || "This username is not available"
          console.log(`Setting error message: "${message}"`)
          setErrorMessage(message)
          setStatusMessage("")
        }
      } catch (e) {
        console.error("Parse error:", e)
        setErrorMessage("Error parsing response")
        setStatusMessage("")
        setIsValid(false)
      }
    } catch (error) {
      console.error("Network error:", error)
      setErrorMessage("Network error checking username")
      setStatusMessage("")
      setIsValid(false)
    } finally {
      setIsChecking(false)
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isValid) onRegister(username)
  }

  return (
    <div>
      <SubscriberBadge className="mt-2" pubkey={pubKey} />
      <p>Register an Iris username (iris.to/username)</p>
      <div className="flex flex-row justify-between items-center mb-2">
        <div>
          Current subscription:{" "}
          {subscriptionPlan
            ? `${subscriptionPlan} (min username length: ${minLength})`
            : "None"}
        </div>
      </div>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-row gap-4">
          <input
            className="input input-bordered"
            type="text"
            placeholder="Username"
            value={username}
            onChange={handleInputChange}
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!isValid || isChecking}
          >
            {isChecking ? "Checking..." : "Register"}
          </button>
        </div>

        <div className="mt-2">
          {/* Checking status */}
          {isChecking && <div className="text-info">Checking availability...</div>}

          {/* Valid username */}
          {!isChecking && isValid && statusMessage && (
            <div className="text-success">
              <div>{statusMessage}</div>
              <AccountName name={username} link={false} />
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <div className="text-error font-medium mt-2">{errorMessage}</div>
          )}

          {/* Subscription upgrade link */}
          {errorMessage && errorMessage.includes("must be") && (
            <div className="mt-2">
              <Link to="/subscribe" className="link">
                Get a subscription to choose shorter usernames
              </Link>
            </div>
          )}
        </div>
      </form>
    </div>
  )
}

export default RegisterForm
