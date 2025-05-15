import {getSubscriptionIcon as getSubscriptionIconComponent} from "@/shared/utils/subscriptionIcons"
import {useSubscriptionStatus} from "@/shared/hooks/useSubscriptionStatus"
import SocialGraphSettings from "@/pages/settings/SocialGraphSettings"
import {useLocation, Link, Routes, Route} from "react-router"
import MediaServers from "@/pages/settings/Mediaservers.tsx"
import {ProfileSettings} from "@/pages/settings/Profile.tsx"
import NotificationSettings from "./NotificationSettings"
import Appearance from "@/pages/settings/Appearance.tsx"
import {ReactElement, useEffect, useState} from "react"
import Header from "@/shared/components/header/Header"
import IrisSettings from "./IrisAccount/IrisSettings"
import {Network} from "@/pages/settings/Network.tsx"
import {RiArrowRightSLine} from "@remixicon/react"
import Icon from "@/shared/components/Icons/Icon"
import Account from "@/pages/settings/Account"
import WalletSettings from "./WalletSettings"
import SystemSettings from "./SystemSettings"
import Backup from "@/pages/settings/Backup"
import Subscription from "./Subscription"
import PrivacySettings from "./Privacy"
import {Helmet} from "react-helmet"
import classNames from "classnames"
import Content from "./Content"
import {useUserStore} from "@/stores/user"

interface SettingsItem {
  icon: string | ReactElement
  iconBg: string
  message: string
  path: string
}

interface SettingsGroup {
  title: string
  items: SettingsItem[]
}

function Settings() {
  const location = useLocation()
  const isSettingsRoot = location.pathname === "/settings"
  const [pubkey, setPubkey] = useState<string | undefined>(undefined)
  const {isSubscriber, isLoading, tier} = useSubscriptionStatus(pubkey)

  useEffect(() => {
    // Get the user's pubkey from zustand store instead of localStorage
    const userStore = useUserStore.getState()
    if (userStore.publicKey) {
      setPubkey(userStore.publicKey)
    }
    
    const unsubscribe = useUserStore.subscribe((state, prevState) => {
      if (state.publicKey && state.publicKey !== prevState.publicKey) {
        setPubkey(state.publicKey)
      }
    })
    
    return () => unsubscribe()
  }, [])

  const renderSubscriptionIcon = () => {
    if (isLoading || !isSubscriber)
      return getSubscriptionIconComponent(undefined, "text-white", 18)
    return getSubscriptionIconComponent(tier, "text-white", 18)
  }

  const settingsGroups: SettingsGroup[] = [
    {
      title: "User",
      items: [
        {
          icon: "profile",
          iconBg: "bg-green-500",
          message: "Profile",
          path: "/settings/profile",
        },
        {
          icon: "wallet-outline",
          iconBg: "bg-emerald-500",
          message: "Wallet",
          path: "/settings/wallet",
        },
        {
          icon: "profile",
          iconBg: "bg-purple-500",
          message: "iris.to username",
          path: "/settings/iris",
        },
        ...(CONFIG.features.showSubscriptionSettings
          ? [
              {
                icon: renderSubscriptionIcon(),
                iconBg: "bg-warning",
                message: "Subscription",
                path: "/settings/subscription",
              },
            ]
          : []),
      ],
    },
    {
      title: "Application",
      items: [
        {
          icon: "stars",
          iconBg: "bg-purple-500",
          message: "Appearance",
          path: "/settings/appearance",
        },
        {
          icon: "hard-drive",
          iconBg: "bg-yellow-500",
          message: "Content",
          path: "/settings/content",
        },
        {
          icon: "bell-outline",
          iconBg: "bg-green-500",
          message: "Notifications",
          path: "/settings/notifications",
        },
        {
          icon: "closedeye",
          iconBg: "bg-red-500",
          message: "Privacy",
          path: "/settings/privacy",
        },
        {
          icon: "gear",
          iconBg: "bg-indigo-500",
          message: "System",
          path: "/settings/system",
        },
      ],
    },
    {
      title: "Data",
      items: [
        {
          icon: "relay",
          iconBg: "bg-blue-500",
          message: "Network",
          path: "/settings/network",
        },
        {
          icon: "media",
          iconBg: "bg-blue-500",
          message: "Media Servers",
          path: "/settings/mediaservers",
        },
        {
          icon: "key",
          iconBg: "bg-gray-500",
          message: "Backup",
          path: "/settings/backup",
        },
        {
          icon: "link",
          iconBg: "bg-teal-500",
          message: "Social Graph",
          path: "/settings/social-graph",
        },
      ],
    },
    {
      title: "Log out",
      items: [
        {
          icon: "key",
          iconBg: "bg-red-500",
          message: "Log out",
          path: "/settings/account",
        },
      ],
    },
  ]

  return (
    <div className="flex flex-1 h-full relative">
      <nav
        className={`sticky top-0 w-full lg:w-64 p-4 lg:h-screen ${
          isSettingsRoot ? "block" : "hidden"
        } lg:block lg:border-r border-custom`}
      >
        <div className="flex flex-col">
          {settingsGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="mb-4">
              <h3 className="font-bold text-xs text-base-content/50 uppercase tracking-wide mb-2">
                {group.title}
              </h3>
              {group.items.map(({icon, iconBg, message, path}, index) => (
                <Link
                  to={path}
                  key={path}
                  className={classNames(
                    "px-2.5 py-1.5 flex justify-between items-center border border-custom hover:bg-base-300",
                    {
                      "rounded-t-xl": index === 0,
                      "rounded-b-xl": index === group.items.length - 1,
                      "border-t-0": index !== 0,
                      "bg-base-100":
                        location.pathname === path ||
                        (isSettingsRoot && path === "/settings/profile"),
                    }
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-1 ${iconBg} rounded-lg flex justify-center items-center text-white`}
                    >
                      {typeof icon === "string" ? <Icon name={icon} size={18} /> : icon}
                    </div>
                    <span className="text-base font-semibold flex-grow">{message}</span>
                  </div>
                  <RiArrowRightSLine size={18} className="text-base-content" />
                </Link>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="md:hidden">
        <Header title="Settings" slideUp={false} />
      </div>
      <div className={`flex-1 ${isSettingsRoot ? "hidden lg:block" : "block"}`}>
        <Header title="Settings" slideUp={false} />
        <div className="p-4 mx-4 md:p-8 rounded-lg bg-base-100 shadow">
          <Routes>
            <Route path="account" element={<Account />} />
            <Route path="network" element={<Network />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="iris" element={<IrisSettings />} />
            <Route path="content" element={<Content />} />
            <Route path="wallet" element={<WalletSettings />} />
            <Route path="backup" element={<Backup />} />
            <Route path="appearance" element={<Appearance />} />
            <Route path="mediaservers" element={<MediaServers />} />
            <Route path="social-graph" element={<SocialGraphSettings />} />
            <Route path="notifications" element={<NotificationSettings />} />
            <Route path="privacy" element={<PrivacySettings />} />
            <Route path="system" element={<SystemSettings />} />
            <Route path="subscription" element={<Subscription />} />
            <Route path="/" element={<ProfileSettings />} />
          </Routes>
        </div>
      </div>
      <Helmet>
        <title>Settings</title>
      </Helmet>
    </div>
  )
}

export default Settings
