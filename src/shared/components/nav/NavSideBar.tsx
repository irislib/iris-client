import {RiLoginBoxLine} from "@remixicon/react"
import {useRef, useMemo} from "react"
import classNames from "classnames"
import NavLink from "./NavLink"

import PublicKeyQRCodeButton from "../user/PublicKeyQRCodeButton"
import {useWalletBalance} from "../../hooks/useWalletBalance"
import {NotificationNavItem} from "./NotificationNavItem"
import {SubscriptionNavItem} from "./SubscriptionNavItem"
import {MessagesNavItem} from "./MessagesNavItem"
import PublishButton from "../ui/PublishButton"
import ErrorBoundary from "../ui/ErrorBoundary"
import {formatAmount} from "@/utils/utils"
import {usePublicKey} from "@/stores/user"
import {navItemsConfig} from "./navConfig"
import {UserRow} from "../user/UserRow"
import {useUIStore} from "@/stores/ui"
import {NavItem} from "./NavItem"

const NavSideBar = () => {
  const ref = useRef<HTMLDivElement>(null)
  const {isSidebarOpen, setIsSidebarOpen, setShowLoginDialog} = useUIStore()
  const {balance} = useWalletBalance()
  const myPubKey = usePublicKey()

  const navItems = useMemo(() => {
    const configItems = navItemsConfig()
    return Object.values(configItems).filter(
      (item) => !("requireLogin" in item) || (item.requireLogin && myPubKey)
    )
  }, [myPubKey])

  const logoUrl = CONFIG.navLogo

  return (
    <ErrorBoundary>
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black opacity-50 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div
        ref={ref}
        className={classNames(
          "bg-base-200 transition-transform duration-300 fixed md:sticky md:translate-x-0 top-0 select-none w-56 md:w-20 xl:w-64 h-screen z-40 flex flex-col md:justify-between border-r border-custom overflow-y-auto",
          {
            "translate-x-0": isSidebarOpen,
            "-translate-x-full": !isSidebarOpen,
          }
        )}
      >
        <div className="flex flex-col items-start md:items-center xl:items-start gap-4 md:gap-2 xl:gap-4">
          <NavLink
            className="md:mb-2 xl:mb-0 mt-4 ml-4 md:ml-0 xl:ml-5 flex flex-row gap-2 items-center md:justify-center font-bold font-bold text-3xl"
            to="/"
          >
            <img className="w-8 h-8" src={logoUrl} />
            <span className="inline md:hidden xl:inline">{CONFIG.appName}</span>
          </NavLink>
          <ul className="px-2 py-0 flex flex-col gap-4 items-start">
            {navItems.map(({to, icon, activeIcon, inactiveIcon, label, onClick}) => {
              if (label === "Chats") {
                return (
                  <MessagesNavItem label={label} key={to} to={to} onClick={onClick} />
                )
              }
              if (label === "Notifications") {
                return <NotificationNavItem key={to} to={to} onClick={onClick} />
              }
              if (label === "Subscription") {
                return <SubscriptionNavItem key={to} to={to} onClick={onClick} />
              }
              return (
                <NavItem
                  key={to}
                  to={to}
                  icon={icon}
                  activeIcon={activeIcon}
                  inactiveIcon={inactiveIcon}
                  label={label}
                  onClick={onClick}
                  badge={
                    label === "Wallet" && balance !== null
                      ? formatAmount(balance)
                      : undefined
                  }
                />
              )
            })}
          </ul>
          {myPubKey && (
            <div className="ml-2 md:ml-0 xl:ml-2 md:mt-2 xl:mt-0">
              <div className="hidden md:flex">
                <PublishButton />
              </div>
            </div>
          )}
          {!myPubKey && (
            <>
              <button
                className="ml-2 md:ml-0 hidden md:flex xl:hidden inline-flex items-center justify-center p-2 rounded-full bg-primary text-white hover:bg-primary-hover transition"
                onClick={() => setShowLoginDialog(true)}
              >
                <RiLoginBoxLine className="w-5 h-5" />
              </button>
              <button
                className="ml-2 flex md:hidden xl:flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-white hover:bg-primary-hover font-medium transition"
                onClick={() => setShowLoginDialog(true)}
              >
                <RiLoginBoxLine className="w-5 h-5" />
                <span>Sign up</span>
              </button>
            </>
          )}
        </div>
        {myPubKey && (
          <>
            <div
              className="flex flex-col p-4 md:mb-2 xl:mb-6 gap-4"
              onClick={() => setIsSidebarOpen(false)}
              data-testid="sidebar-user-row"
            >
              <UserRow
                pubKey={myPubKey}
                showBadge={false}
                textClassName="md:hidden xl:inline font-bold"
                avatarWidth={45}
              />
              <div className="md:hidden text-center" onClick={(e) => e.stopPropagation()}>
                <PublicKeyQRCodeButton publicKey={myPubKey} />
              </div>
            </div>
          </>
        )}
      </div>
    </ErrorBoundary>
  )
}

export default NavSideBar
