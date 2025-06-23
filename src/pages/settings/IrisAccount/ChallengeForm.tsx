import {useEffect} from "react"

interface ChallengeFormProps {
  onVerify: (token: string) => void
}

function ChallengeForm({onVerify}: ChallengeFormProps) {
  useEffect(() => {
    // Setup callback for Cloudflare
    window.cf_turnstile_callback = (token: string) => onVerify(token)

    // Load Cloudflare script
    if (
      !document.querySelector(
        'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]'
      )
    ) {
      const script = document.createElement("script")
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js"
      script.async = true
      script.defer = true
      document.body.appendChild(script)
    }

    return () => {
      delete window.cf_turnstile_callback
    }
  }, [onVerify])

  return (
    <div
      className="cf-turnstile"
      data-sitekey={
        ["iris.to", "beta.iris.to"].includes(window.location.hostname)
          ? "0x4AAAAAAACsEd8XuwpPTFwz"
          : "3x00000000000000000000FF"
      }
      data-callback="cf_turnstile_callback"
    />
  )
}

export default ChallengeForm
