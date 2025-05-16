import UnseenNotificationsBadge from "@/shared/components/header/UnseenNotificationsBadge"
import Icon from "@/shared/components/Icons/Icon"
import {MouseEventHandler} from "react"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import NavLink from "./NavLink"

interface NotificationNavItemProps {
  to: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export const NotificationNavItem = ({to, onClick}: NotificationNavItemProps) => {
  const {setIsSidebarOpen} = useUIStore()

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
    setIsSidebarOpen(false)
    onClick?.(e)
  }

  return (
    <li>
      <NavLink
        title="Notifications"
        to={to}
        onClick={handleClick}
        className={({isActive}) =>
          classNames({
            "bg-base-100": isActive,
            "rounded-full md:aspect-square xl:aspect-auto flex items-center": true,
          })
        }
      >
        {({isActive}) => (
          <span className="indicator flex items-center gap-2">
            <UnseenNotificationsBadge />
            <Icon name={`bell-${isActive ? "solid" : "outline"}`} className="w-6 h-6" />
            <span className="inline md:hidden xl:inline">Notifications</span>
          </span>
        )}
      </NavLink>
    </li>
  )
}
