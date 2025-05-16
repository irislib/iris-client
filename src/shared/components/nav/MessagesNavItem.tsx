import UnseenMessagesBadge from "@/shared/components/messages/UnseenMessagesBadge"
import Icon from "@/shared/components/Icons/Icon"
import {MouseEventHandler} from "react"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import NavLink from "./NavLink"

interface MessagesNavItemProps {
  to: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export const MessagesNavItem = ({to, onClick}: MessagesNavItemProps) => {
  const {setIsSidebarOpen} = useUIStore()

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
    setIsSidebarOpen(false)
    onClick?.(e)
  }

  return (
    <li>
      <NavLink
        title="Messages"
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
            <UnseenMessagesBadge />
            <Icon name={`mail-${isActive ? "solid" : "outline"}`} className="w-6 h-6" />
            <span className="inline md:hidden xl:inline">Messages</span>
          </span>
        )}
      </NavLink>
    </li>
  )
}
