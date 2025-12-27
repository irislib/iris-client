import {RiLoginBoxLine, RiLockLine, RiBugLine} from "@remixicon/react"
import {useRef, useMemo} from "react"
import NavLink from "./NavLink"

import {useWalletBalance} from "../../hooks/useWalletBalance"
import {NotificationNavItem} from "./NotificationNavItem"
import {MessagesNavItem} from "./MessagesNavItem"
import PublishButton from "../ui/PublishButton"
import ErrorBoundary from "../ui/ErrorBoundary"
import {formatAmount} from "@/utils/utils"
import {usePublicKey} from "@/stores/user"
import {useWalletStore} from "@/stores/wallet"
import {useSettingsStore} from "@/stores/settings"
import {navItemsConfig} from "./navConfig"
import {UserRow} from "../user/UserRow"
import {useUIStore} from "@/stores/ui"
import {NavItem} from "./NavItem"
import {ndk} from "@/utils/ndk"
import {RelayConnectivityIndicator, OfflineIndicator} from "../RelayConnectivityIndicator"
import {hasWriteAccess} from "@/utils/auth"
import {ColumnLayoutToggle} from "./ColumnLayoutToggle"

const NavSideBar = () => {
  const ref = useRef<HTMLDivElement>(null)
  const {setShowLoginDialog} = useUIStore()
  const {balance} = useWalletBalance()
  const {showBalanceInNav} = useWalletStore()
  const myPubKey = usePublicKey()
  const {debug} = useSettingsStore()

  const hasSigner = hasWriteAccess()

  const navItems = useMemo(() => {
    const configItems = navItemsConfig()
    return Object.values(configItems).filter((item) => {
      // Hide Chats if no signer (view-only mode)
      if (item.label === "Chats" && !hasSigner) {
        return false
      }
      return !("requireLogin" in item) || (item.requireLogin && myPubKey)
    })
  }, [myPubKey, hasSigner])

  const logoUrl = CONFIG.navLogo

  return (
    <ErrorBoundary>
      <div
        ref={ref}
        className="bg-base-200 hidden md:sticky md:flex top-0 select-none md:w-20 xl:w-64 h-screen z-40 flex-col md:justify-between border-r border-custom overflow-y-scroll scrollbar-hide pt-[env(safe-area-inset-top)] flex-shrink-0"
      >
        <div className="flex flex-col items-start md:items-center xl:items-start gap-4 md:gap-2 xl:gap-4">
          <NavLink
            className="md:mb-2 xl:mb-0 mt-4 ml-4 md:ml-0 xl:ml-5 flex flex-row gap-2 items-center md:justify-center font-bold font-bold text-3xl"
            to="/"
          >
            <img className="w-8 h-8" src={logoUrl} />
            <span className="inline md:hidden xl:inline">{CONFIG.appName}</span>
          </NavLink>
          {myPubKey && !ndk().signer && (
            <div
              title="Read-only mode"
              className="px-4 py-2 mx-2 md:mx-0 xl:mx-2 flex items-center gap-2"
            >
              <RiLockLine className="w-6 h-6 text-error md:hidden xl:inline" />
              <span className="badge badge-error badge-md md:badge-sm">
                <span className="hidden xl:inline">Read-only</span>
                <RiLockLine className="w-4 h-4 xl:hidden" />
              </span>
            </div>
          )}
          {debug.enabled && (
            <NavLink
              to="/settings/system"
              title="Debug mode active - Click to manage"
              className="px-4 py-2 mx-2 md:mx-0 xl:mx-2 flex items-center gap-2 text-warning text-xl hover:bg-base-300 rounded-full"
            >
              <RiBugLine className="w-6 h-6" />
              <span className="hidden xl:inline">Debug mode</span>
            </NavLink>
          )}
          <ul className="menu px-2 py-0 text-xl flex flex-col gap-4 md:gap-2 xl:gap-4 rounded-2xl">
            {navItems.map(({to, icon, activeIcon, inactiveIcon, label, onClick}) => {
              if (label === "Chats") {
                return (
                  <MessagesNavItem label={label} key={to} to={to} onClick={onClick} />
                )
              }
              if (label === "Notifications") {
                return <NotificationNavItem key={to} to={to} onClick={onClick} />
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
                    label === "Wallet" && showBalanceInNav && balance !== null ? (
                      <span className="select-none">
                        {formatAmount(balance)}
                        <span className="text-[0.85em]">₿</span>
                      </span>
                    ) : undefined
                  }
                />
              )
            })}
          </ul>
          {myPubKey && ndk().signer && <PublishButton />}
          {!myPubKey && (
            <div className="ml-2 md:ml-0 xl:px-2 md:mt-2 hidden md:block xl:w-full">
              <button
                className="btn btn-primary btn-circle xl:w-full xl:rounded-full text-lg signup-btn"
                onClick={() => setShowLoginDialog(true)}
              >
                <RiLoginBoxLine className="xl:hidden" />
                <span className="hidden xl:inline">Sign up</span>
              </button>
            </div>
          )}
        </div>
        {myPubKey && (
          <>
            <div className="flex flex-col p-4 gap-2">
              <div className="hidden lg:flex xl:hidden justify-center mb-2">
                <ColumnLayoutToggle compact />
              </div>
              <div className="hidden xl:flex justify-start mb-2">
                <ColumnLayoutToggle />
              </div>
              <div className="hidden md:flex md:flex-col xl:flex-row items-center xl:items-center gap-1 mb-2">
                {/* Offline indicator - md-lg (above), xl (after indicator) */}
                <OfflineIndicator className="md:flex xl:hidden badge-md" />
                {/* Relay indicator */}
                <RelayConnectivityIndicator className="xl:flex-row" />
                <OfflineIndicator className="hidden xl:flex badge-md" />
              </div>
              <div className="flex-1">
                <UserRow
                  pubKey={myPubKey}
                  showBadge={false}
                  textClassName="md:hidden xl:inline font-bold"
                  avatarWidth={45}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ErrorBoundary>
  )
}

export default NavSideBar
