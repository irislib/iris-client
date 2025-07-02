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
          classNames(
            {
              "bg-base-100": isActive,
            },
            "sidebar-nav-row indicator"
          )
        }
      >
        {({isActive}) => (
          <>
            <Icon
              name={`bell-${isActive ? "solid" : "outline"}`}
              className="sidebar-nav-icon"
            />
            <span className="sidebar-nav-label">Notifications</span>
            <UnseenNotificationsBadge />
          </>
        )}
      </NavLink>
    </li>
  )
}
