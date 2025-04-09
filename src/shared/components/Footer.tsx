import classNames from "classnames"
import React from "react"

import UnseenMessagesBadge from "@/shared/components/messages/UnseenMessagesBadge"
import PublishButton from "@/shared/components/ui/PublishButton"
import {useWalletBalance} from "@/shared/hooks/useWalletBalance"
import NavLink from "@/shared/components/nav/NavLink" // Adjusted import path
import Icon from "@/shared/components/Icons/Icon" // Add this import
import ErrorBoundary from "./ui/ErrorBoundary"
import {formatAmount} from "@/utils/utils"
import {useLocation} from "react-router"
import {localState} from "irisdb"

type MenuItem = {
  label?: string
  icon?: string
  link?: string
  loggedInOnly?: boolean
  el?: React.ReactNode
  activeIcon?: string
  inactiveIcon?: string
  badge?: string
}

let myPubKey = ""
localState.get("user/publicKey").on((k) => (myPubKey = k as string))

const Footer = () => {
  const readonly = false
  const location = useLocation()
  const {balance} = useWalletBalance()

  const MENU_ITEMS: MenuItem[] = [
    {link: "/", icon: "home"},
    {
      link: "/wallet",
      icon: "wallet",
      loggedInOnly: true,
      badge: balance !== null ? formatAmount(balance) : undefined,
    },
    {
      el: (
        <div className="flex flex-grow items-center justify-center">
          <PublishButton showLabel={false} />
        </div>
      ),
      loggedInOnly: true,
    },
  ]

  if (location.pathname.startsWith("/chats/") && !location.pathname.endsWith("/new")) {
    return null
  }

  return (
    // -mb-[1px] because weird 1px gap under footer?
    <ErrorBoundary>
      <footer className="-mb-[1px] md:hidden fixed bottom-0 z-10 w-full bg-base-200 pb-[env(safe-area-inset-bottom)] bg-bg-color">
        <div className="flex">
          {MENU_ITEMS.map(
            (item, index) =>
              (myPubKey || !item.loggedInOnly) && (
                <FooterNavItem key={index} item={item} readonly={readonly} />
              )
          )}
          {myPubKey && (
            <NavLink
              to="/chats"
              className={({isActive}) =>
                classNames(
                  {active: isActive},
                  "flex flex-grow p-4 justify-center items-center cursor-pointer"
                )
              }
            >
              {({isActive}) => (
                <span className="indicator">
                  <UnseenMessagesBadge />
                  <Icon
                    className="w-5 h-5"
                    name={`mail-${isActive ? "solid" : "outline"}`}
                  />
                </span>
              )}
            </NavLink>
          )}
          <FooterNavItem item={{link: "/search", icon: "search"}} readonly={readonly} />
        </div>
      </footer>
    </ErrorBoundary>
  )
}

const FooterNavItem = ({item}: {item: MenuItem; readonly: boolean}) => {
  if (item.el) {
    return item.el
  }

  return (
    <NavLink
      to={item.link ?? "/"}
      className={({isActive}) =>
        classNames(
          {active: isActive},
          "flex flex-grow p-4 justify-center items-center cursor-pointer"
        )
      }
    >
      {({isActive}) => (
        <span className="indicator">
          {renderIcon(item, isActive)}
          {item.badge && (
            <span className="badge badge-xs absolute -left-4 -bottom-3">
              {item.badge}
            </span>
          )}
        </span>
      )}
    </NavLink>
  )
}

const renderIcon = (item: MenuItem, isActive: boolean) => {
  let iconName
  if (item.activeIcon && item.inactiveIcon) {
    iconName = isActive ? item.activeIcon : item.inactiveIcon
  } else {
    iconName = `${item.icon}-${isActive ? "solid" : "outline"}`
  }

  return (item.icon || item.activeIcon) && <Icon className="w-5 h-5" name={iconName} />
}

export default Footer
