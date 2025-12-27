import classNames from "classnames"
import {ReactNode} from "react"
import {RiLockLine, RiAddCircleLine, RiAddCircleFill} from "@remixicon/react"
import {useWalletBalance} from "@/shared/hooks/useWalletBalance"
import NavLink from "@/shared/components/nav/NavLink" // Adjusted import path
import Icon from "@/shared/components/Icons/Icon" // Add this import
import {Avatar} from "@/shared/components/user/Avatar"
import {ProfileLink} from "@/shared/components/user/ProfileLink"
import ErrorBoundary from "./ui/ErrorBoundary"
import {formatAmount} from "@/utils/utils"
import {useUserStore} from "@/stores/user"
import {useWalletStore} from "@/stores/wallet"
import {useLocation} from "@/navigation"
import {ndk} from "@/utils/ndk"
import {isReadOnlyMode} from "@/utils/auth"

type MenuItem = {
  label?: string
  icon?: string
  link?: string
  loggedInOnly?: boolean
  requireSigner?: boolean
  el?: ReactNode
  activeIcon?: string
  inactiveIcon?: string
  badge?: ReactNode
}

const Footer = () => {
  const location = useLocation()
  const {balance} = useWalletBalance()
  const {showBalanceInNav} = useWalletStore()
  const myPubKey = useUserStore((state) => state.publicKey)

  const MENU_ITEMS: MenuItem[] = [
    {link: "/", icon: "home"},
    {
      link: "/wallet",
      icon: "wallet",
      loggedInOnly: true,
      badge:
        showBalanceInNav && balance !== null ? (
          <span className="select-none">
            {formatAmount(balance)}
            <span className="text-[0.85em]">₿</span>
          </span>
        ) : undefined,
    },
    {
      link: "/new",
      activeIcon: "RiAddCircleFill",
      inactiveIcon: "RiAddCircleLine",
      loggedInOnly: true,
      requireSigner: true,
    },
  ]

  if (location.pathname.startsWith("/chats/") && !location.pathname.endsWith("/new")) {
    return null
  }

  return (
    // -mb-[1px] because weird 1px gap under footer?
    <ErrorBoundary>
      <footer className="-mb-[1px] md:hidden fixed bottom-0 z-10 w-full bg-base-200 bg-bg-color pb-[env(safe-area-inset-bottom)]">
        {isReadOnlyMode() && (
          <div className="flex items-center justify-center gap-1 text-error text-xs py-1 border-b border-error/20">
            <RiLockLine className="w-3 h-3" />
            <span>Read-only mode</span>
          </div>
        )}
        <div className="flex">
          {MENU_ITEMS.map(
            (item, index) =>
              (myPubKey || !item.loggedInOnly) &&
              (!item.requireSigner || (item.requireSigner && ndk().signer)) && (
                <FooterNavItem key={index} item={item} />
              )
          )}
          <FooterNavItem item={{link: "/u", icon: "search"}} />
          {myPubKey && (
            <ProfileLink
              pubKey={myPubKey}
              className={({isActive}) =>
                classNames(
                  {active: isActive},
                  "flex flex-grow p-3 justify-center items-center cursor-pointer"
                )
              }
            >
              {({isActive}) => (
                <div
                  className={classNames("rounded-full border-2", {
                    "border-base-content": isActive,
                    "border-transparent": !isActive,
                  })}
                >
                  <Avatar pubKey={myPubKey} width={28} showBadge={false} />
                </div>
              )}
            </ProfileLink>
          )}
        </div>
      </footer>
    </ErrorBoundary>
  )
}

const FooterNavItem = ({item}: {item: MenuItem}) => {
  if (item.el) {
    return item.el
  }

  const handleClick = () => {
    // Navigation handled by NavLink
  }

  return (
    <NavLink
      to={item.link ?? "/"}
      onClick={handleClick}
      className={({isActive}) =>
        classNames(
          {active: isActive},
          "flex flex-grow p-3 justify-center items-center cursor-pointer"
        )
      }
    >
      {({isActive}) => (
        <span className="indicator">
          {renderIcon(item, isActive)}
          {item.badge && (
            <span className="absolute left-1/2 -translate-x-1/2 -bottom-3 whitespace-nowrap text-xs">
              {item.badge}
            </span>
          )}
        </span>
      )}
    </NavLink>
  )
}

const renderIcon = (item: MenuItem, isActive: boolean) => {
  // Handle Remix Icons
  if (item.activeIcon && item.inactiveIcon) {
    const iconName = isActive ? item.activeIcon : item.inactiveIcon
    if (iconName === "RiAddCircleFill") {
      return <RiAddCircleFill className="w-7 h-7" />
    }
    if (iconName === "RiAddCircleLine") {
      return <RiAddCircleLine className="w-7 h-7" />
    }
  }

  // Handle custom icons
  let iconName
  if (item.activeIcon && item.inactiveIcon) {
    iconName = isActive ? item.activeIcon : item.inactiveIcon
  } else {
    iconName = `${item.icon}-${isActive ? "solid" : "outline"}`
  }

  return (item.icon || item.activeIcon) && <Icon className="w-6 h-6" name={iconName} />
}

export default Footer
