import {MOBILE_BREAKPOINT} from "@/shared/components/user/const.ts"
import {ReactNode, useRef, useEffect, MouseEvent} from "react"
import {RiMenuLine, RiArrowLeftLine} from "@remixicon/react"
import NotificationButton from "./NotificationButton"
import {useUserStore} from "@/stores/user"
import {useNavigate} from "react-router"
import {useUIStore} from "@/stores/ui"
import {Avatar} from "../user/Avatar"
import classNames from "classnames"

interface HeaderProps {
  title?: string
  children?: ReactNode
  showBack?: boolean
  showNotifications?: boolean
  scrollDown?: boolean
  slideUp?: boolean
  bold?: boolean
}

const Header = ({
  title,
  children,
  showBack = true,
  showNotifications = true,
  scrollDown = false,
  slideUp = true,
  bold = true,
}: HeaderProps) => {
  const {isSidebarOpen, setIsSidebarOpen, setShowLoginDialog} = useUIStore()
  const myPubKey = useUserStore((state) => state.publicKey)
  const navigate = useNavigate()

  const headerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(window.scrollY)

  useEffect(() => {
    const MIN_TRANSLATE_Y = -80
    const MAX_TRANSLATE_Y = 0
    const OPACITY_MIN_POINT = 30

    const handleScroll = () => {
      if (window.innerWidth >= MOBILE_BREAKPOINT || !slideUp) return

      const currentScrollY = window.scrollY
      let newTranslateY = 0
      if (currentScrollY > lastScrollY.current) {
        newTranslateY = Math.max(
          MIN_TRANSLATE_Y,
          parseFloat(
            headerRef.current?.style.transform
              .replace("translateY(", "")
              .replace("px)", "") || "0"
          ) -
            (currentScrollY - lastScrollY.current)
        )
      } else {
        newTranslateY = Math.min(
          MAX_TRANSLATE_Y,
          parseFloat(
            headerRef.current?.style.transform
              .replace("translateY(", "")
              .replace("px)", "") || "0"
          ) +
            (lastScrollY.current - currentScrollY)
        )
      }
      lastScrollY.current = currentScrollY
      if (headerRef.current) {
        headerRef.current.style.transform = `translateY(${newTranslateY}px)`
        contentRef.current!.style.opacity = `${1 - Math.min(1, newTranslateY / -OPACITY_MIN_POINT)}`
      }
    }

    const handleResize = () => {
      if (headerRef.current) {
        headerRef.current.style.transform = `translateY(0px)`
        if (contentRef.current) {
          contentRef.current.style.opacity = "1"
        }
        lastScrollY.current = window.scrollY // Reset the scroll position reference
      }
    }

    window.addEventListener("scroll", handleScroll)
    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleResize)
    }
  }, [slideUp])

  const getButtonContent = () => {
    if (showBack) return <RiArrowLeftLine className="w-6 h-6" />
    return myPubKey ? (
      <Avatar pubKey={myPubKey} width={32} showBadge={false} />
    ) : (
      <RiMenuLine className="w-6 h-6" />
    )
  }

  const handleButtonClick = () => {
    if (showBack) {
      if (window.history.state?.idx > 0) {
        navigate(-1)
      } else {
        navigate("/chats")
      }
    } else {
      setIsSidebarOpen(!isSidebarOpen)
    }
  }

  const handleHeaderClick = (e: MouseEvent) => {
    // Don't scroll if clicking on a button or link
    if (
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest("a")
    )
      return

    window.scrollTo({
      top: scrollDown ? document.body.scrollHeight : 0,
    })
  }

  const leftButton = getButtonContent() && (
    <button
      onClick={handleButtonClick}
      className={classNames("btn btn-ghost btn-circle", {"md:hidden": !showBack})}
    >
      {getButtonContent()}
    </button>
  )

  return (
    <header
      ref={headerRef}
      onClick={handleHeaderClick}
      style={{transform: `translateY(0px)`}}
      className="min-h-16 flex fixed top-0 left-0 right-0 bg-base-200 md:bg-opacity-80 md:backdrop-blur-sm text-base-content p-2 z-30 select-none md:sticky w-full cursor-pointer"
    >
      <div ref={contentRef} className="flex justify-between items-center flex-1 w-full">
        <div className="flex items-center gap-2 w-full">
          {leftButton}
          <div
            className={classNames("flex items-center gap-4 w-full text-base-content", {
              "text-lg font-semibold": bold,
            })}
          >
            {children || title}
          </div>
        </div>
        <div className="flex items-center gap-4 mr-2">
          {showNotifications && myPubKey && (
            <div className="md:hidden">
              <NotificationButton />
            </div>
          )}
          {!myPubKey && (
            <button
              className="md:hidden btn btn-sm btn-primary"
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
