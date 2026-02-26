import SocialGraphSettings from "@/pages/settings/SocialGraph"
import {useLocation, Link} from "@/navigation"
import MediaServers from "@/pages/settings/Mediaservers.tsx"
import {ProfileSettings} from "@/pages/settings/Profile.tsx"
import NotificationSettings from "./NotificationSettings"
import Appearance from "@/pages/settings/Appearance.tsx"
import Header from "@/shared/components/header/Header"
import IrisSettings from "./IrisAccount/IrisSettings"
import {Network} from "@/pages/settings/Network.tsx"
import {RiArrowRightSLine, RiComputerLine} from "@remixicon/react"
import Icon from "@/shared/components/Icons/Icon"
import Keys from "@/pages/settings/Keys"
import Logout from "@/pages/settings/Logout"
import DeleteAccount from "@/pages/settings/DeleteAccount"
import WalletSettings from "./WalletSettings"
import SystemSettings from "./SystemSettings"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {Helmet} from "react-helmet"
import classNames from "classnames"
import {ReactElement} from "react"
import Content from "./Content"
import {isTauri} from "@/utils/utils"
import LocalData from "./local/LocalData"
import MessagesSettings from "./Messages"
import DevicesTab from "@/pages/chats/devices"

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
          icon: "message-chat-circle",
          iconBg: "bg-orange-500",
          message: "Messages",
          path: "/settings/messages",
        },
        {
          icon: <RiComputerLine size={16} />,
          iconBg: "bg-cyan-500",
          message: "Devices",
          path: "/settings/devices",
        },
        {
          icon: "bell-outline",
          iconBg: "bg-green-500",
          message: "Notifications",
          path: "/settings/notifications",
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
          icon: "link",
          iconBg: "bg-teal-500",
          message: "Social Graph",
          path: "/settings/social-graph",
        },
        {
          icon: "hard-drive",
          iconBg: "bg-purple-500",
          message: "Local",
          path: "/settings/local",
        },
        {
          icon: "key",
          iconBg: "bg-gray-500",
          message: "Keys",
          path: "/settings/keys",
        },
      ],
    },
    ...(isTauri()
      ? [
          {
            title: "Account",
            items: [
              {
                icon: "trash" as const,
                iconBg: "bg-red-600",
                message: "Delete account",
                path: "/settings/delete-account",
              },
              {
                icon: "key" as const,
                iconBg: "bg-red-500",
                message: "Log out",
                path: "/settings/logout",
              },
            ],
          },
        ]
      : [
          {
            title: "Log out",
            items: [
              {
                icon: "key" as const,
                iconBg: "bg-red-500",
                message: "Log out",
                path: "/settings/logout",
              },
            ],
          },
        ]),
  ]

  const getSettingsTitle = () => {
    const pathSegments = location.pathname.split("/").filter(Boolean)
    const settingsPath = pathSegments[1] || ""

    const titleMap: Record<string, string> = {
      "": "Settings",
      keys: "Keys",
      logout: "Log out",
      "delete-account": "Delete account",
      network: "Network",
      profile: "Profile",
      iris: "iris.to username",
      content: "Content",
      wallet: "Wallet",
      appearance: "Appearance",
      mediaservers: "Media Servers",
      "social-graph": "Social Graph",
      local: "Local",
      messages: "Messages",
      devices: "Devices",
      notifications: "Notifications",
      system: "System",
    }

    return titleMap[settingsPath] || "Settings"
  }

  return (
    <div className="flex flex-col h-full">
      <Header title={getSettingsTitle()} />
      <div
        className="flex flex-1 overflow-y-scroll overflow-x-hidden scrollbar-hide relative"
        data-main-scroll-container="true"
        data-header-scroll-target
      >
        <div className="pt-[calc(4rem+env(safe-area-inset-top))] md:pt-0 flex w-full flex-col h-full">
          <div className="flex w-full flex-1">
            <nav
              className={`sticky top-0 w-full lg:w-64 p-4 lg:h-screen bg-base-200 ${
                isSettingsRoot ? "block" : "hidden"
              } lg:block lg:border-r border-custom`}
            >
              <div className="flex flex-col gap-6">
                {settingsGroups.map((group, groupIndex) => (
                  <SettingsGroup key={groupIndex} title={group.title}>
                    {group.items.map(({icon, iconBg, message, path}, index) => (
                      <Link
                        to={path}
                        key={path}
                        className={classNames({
                          "bg-base-200":
                            location.pathname === path ||
                            (isSettingsRoot && path === "/settings/profile"),
                        })}
                      >
                        <SettingsGroupItem
                          variant="navigation"
                          isLast={index === group.items.length - 1}
                        >
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <div
                                className={`p-1 ${iconBg} rounded-lg flex justify-center items-center text-white`}
                              >
                                {typeof icon === "string" ? (
                                  <Icon name={icon} size={16} />
                                ) : (
                                  icon
                                )}
                              </div>
                              <span className="text-base font-medium flex-grow">
                                {message}
                              </span>
                            </div>
                            <RiArrowRightSLine
                              size={18}
                              className="text-base-content/50"
                            />
                          </div>
                        </SettingsGroupItem>
                      </Link>
                    ))}
                  </SettingsGroup>
                ))}
                {/* Spacer for mobile footer on settings list */}
                <div className="h-44 lg:hidden" aria-hidden="true" />
              </div>
            </nav>
            <div
              className={`flex-1 ${isSettingsRoot ? "hidden lg:block" : "block"} overflow-y-scroll overflow-x-hidden scrollbar-hide`}
            >
              <div className="md:px-2">
                {(() => {
                  // Determine which component to show based on the path
                  const pathSegments = location.pathname.split("/").filter(Boolean)
                  const settingsPath = pathSegments[1] || "" // After filtering, settings is at index 0, subpage at index 1

                  switch (settingsPath) {
                    case "keys":
                      return <Keys />
                    case "logout":
                      return <Logout />
                    case "delete-account":
                      return <DeleteAccount />
                    case "network":
                      return <Network />
                    case "profile":
                      return <ProfileSettings />
                    case "iris":
                      return <IrisSettings />
                    case "content":
                      return <Content />
                    case "messages":
                      return <MessagesSettings />
                    case "devices":
                      return <DevicesTab />
                    case "wallet":
                      return <WalletSettings />
                    case "appearance":
                      return <Appearance />
                    case "mediaservers":
                      return <MediaServers />
                    case "social-graph":
                      return <SocialGraphSettings />
                    case "local":
                      return <LocalData />
                    case "notifications":
                      return <NotificationSettings />
                    case "system":
                      return <SystemSettings />
                    default:
                      return <ProfileSettings />
                  }
                })()}

                {/* Mobile footer spacing */}
                <div className="h-44 md:hidden" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <Helmet>
        <title>Settings</title>
      </Helmet>
    </div>
  )
}

export default Settings
