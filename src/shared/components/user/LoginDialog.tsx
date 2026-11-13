import SignUp from "@/shared/components/user/SignUp"
import SignIn from "@/shared/components/user/SignIn"
import {useState} from "react"
import {useUIStore} from "@/stores/ui"
import {resolveAppAssetUrl} from "@/utils/nativeHtree"

export default function LoginDialog() {
  const initialView = useUIStore((state) => state.loginDialogInitialView)
  const [view, setView] = useState<"signin" | "signup">(
    initialView ??
      (typeof window.nostr?.getPublicKey === "function" ? "signin" : "signup")
  )
  const navLogoUrl = resolveAppAssetUrl(CONFIG.navLogo)

  return (
    <div className="flex flex-row items-center gap-2 justify-between card card-compact min-w-[320px] max-w-[90vw]">
      <div className="card-body items-center">
        <img src={navLogoUrl} alt={CONFIG.appName} className="w-12 h-12" />
        {view === "signin" && <SignIn onClose={() => setView("signup")} />}
        {view === "signup" && <SignUp onClose={() => setView("signin")} />}
      </div>
    </div>
  )
}
