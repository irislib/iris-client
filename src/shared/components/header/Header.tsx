import {ReactNode, useRef} from "react"
import {useScrollableParent} from "@/shared/hooks/useScrollableParent"
import NotificationButton from "./NotificationButton"
import UnseenMessagesBadge from "@/shared/components/messages/UnseenMessagesBadge"
import Icon from "@/shared/components/Icons/Icon"
import {useUserStore} from "@/stores/user"
import {useLocation, useNavigate} from "@/navigation"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import {useHeaderScroll} from "./useHeaderScroll"
import {HeaderNavigation} from "./HeaderNavigation"
import {useHeaderClick} from "./useHeaderClick"
import {RelayConnectivityIndicator, OfflineIndicator} from "../RelayConnectivityIndicator"

interface HeaderProps {
  title?: string
  children?: ReactNode
  rightContent?: ReactNode
  showBack?: boolean
  showNotifications?: boolean
  scrollDown?: boolean
  slideUp?: boolean
  bold?: boolean
}

const Header = ({
  title,
  children,
  rightContent,
  showBack = true,
  showNotifications = false,
  scrollDown = false,
  slideUp = true,
  bold = true,
}: HeaderProps) => {
  const {setShowLoginDialog} = useUIStore()
  const myPubKey = useUserStore((state) => state.publicKey)
  const location = useLocation()
  const navigate = useNavigate()

  const headerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const {scrollContainer, findScrollableParent} = useScrollableParent(headerRef)

  // Use extracted scroll hook
  useHeaderScroll({
    slideUp,
    headerRef,
    contentRef,
    pathname: location.pathname,
  })

  const handleHeaderClick = useHeaderClick({
    headerRef,
    scrollContainer,
    findScrollableParent,
    scrollDown,
  })

  // Only show back button if showBack is true, otherwise no left button
  const leftButton = showBack ? <HeaderNavigation showBack={showBack} /> : null

  return (
    <header
      ref={headerRef}
      onClick={handleHeaderClick}
      style={slideUp ? {transform: "translateY(0px)"} : undefined}
      className={classNames(
        "pt-[env(safe-area-inset-top)] min-h-16 flex top-0 bg-base-200 md:bg-opacity-80 md:backdrop-blur-sm text-base-content px-2 z-30 select-none w-full cursor-pointer",
        "fixed md:sticky"
      )}
    >
      <div
        ref={contentRef}
        className="flex justify-between items-center flex-1 w-full py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {leftButton}
          <div
            className={classNames(
              "flex min-w-0 items-center gap-4 w-full text-base-content",
              {
                "text-2xl font-semibold leading-tight": bold,
              }
            )}
          >
            {children || (
              <span className="truncate" title={title}>
                {title}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="md:hidden flex items-center gap-2">
            <OfflineIndicator className="badge-sm" />
            <RelayConnectivityIndicator />
          </div>
          {rightContent}
          {myPubKey && (
            <>
              {location.pathname === "/" && (
                <button
                  onClick={() => navigate("/chats")}
                  className="md:hidden btn btn-ghost btn-circle relative"
                  title="Messages"
                >
                  <span className="indicator">
                    <UnseenMessagesBadge />
                    <Icon
                      className="w-6 h-6"
                      name={
                        location.pathname.startsWith("/chats")
                          ? "mail-solid"
                          : "mail-outline"
                      }
                    />
                  </span>
                </button>
              )}
              {showNotifications && (
                <div className="md:hidden ml-2">
                  <NotificationButton />
                </div>
              )}
            </>
          )}
          {!myPubKey && (
            <button
              className="md:hidden btn btn-sm btn-primary whitespace-nowrap"
              onClick={() => setShowLoginDialog(true)}
            >
              Sign up
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header
