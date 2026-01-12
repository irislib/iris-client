import {ReactNode} from "react"
import {useSettingsStore} from "@/stores/settings"
import ErrorBoundary from "@/shared/components/ui/ErrorBoundary"
import Modal from "@/shared/components/ui/Modal"
import LoginDialog from "@/shared/components/user/LoginDialog"
import Toast from "@/shared/components/ui/Toast"
import {useUIStore} from "@/stores/ui"
import {Helmet} from "react-helmet"

const ChatLayout = ({children}: {children: ReactNode}) => {
  const {appearance} = useSettingsStore()
  const showLoginDialog = useUIStore((state) => state.showLoginDialog)
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)

  // Simple layout - no nav sidebar, just chat content
  return (
    <div
      className={`relative flex flex-col w-full h-screen overflow-hidden ${appearance.limitedMaxWidth ? "max-w-screen-2xl mx-auto" : ""}`}
    >
      <div
        className="flex relative flex-1 overflow-hidden min-w-0 w-full"
        id="main-content"
      >
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
      </div>
      <ErrorBoundary>
        {showLoginDialog && (
          <Modal onClose={() => setShowLoginDialog(false)}>
            <div className="flex items-center justify-center h-full md:h-auto p-4">
              <LoginDialog />
            </div>
          </Modal>
        )}
      </ErrorBoundary>
      <Toast />
      <Helmet titleTemplate="%s / Iris Chat" defaultTitle="Iris Chat">
        <title>Iris Chat</title>
      </Helmet>
    </div>
  )
}

export default ChatLayout
