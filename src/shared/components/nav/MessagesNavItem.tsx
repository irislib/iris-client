import UnseenMessagesBadge from "@/shared/components/messages/UnseenMessagesBadge"
import Icon from "@/shared/components/Icons/Icon"
import {MouseEventHandler} from "react"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import NavLink from "./NavLink"

interface MessagesNavItemProps {
  label: string
  to: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export const MessagesNavItem = ({label, to, onClick}: MessagesNavItemProps) => {
  const {setIsSidebarOpen} = useUIStore()

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
    setIsSidebarOpen(false)
    onClick?.(e)
  }

  return (
    <li>
      <NavLink
        title={label}
        to={to}
        onClick={handleClick}
        className={({isActive}) =>
          classNames(
            {
              "bg-base-100": isActive,
            },
            "rounded-full flex flex-row items-center gap-3 px-4 py-2 hover:bg-base-300 transition"
          )
        }
      >
        {({isActive}) => (
          <>
            <Icon
              name={`mail-${isActive ? "solid" : "outline"}`}
              className="sidebar-nav-icon"
            />
            <span className="sidebar-nav-label">{label}</span>
            <UnseenMessagesBadge />
          </>
        )}
      </NavLink>
    </li>
  )
}
