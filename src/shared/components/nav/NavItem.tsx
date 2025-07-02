import {ReactNode, MouseEventHandler} from "react"
import Icon from "@/shared/components/Icons/Icon"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import NavLink from "./NavLink"

interface NavItemProps {
  to: string
  icon?: string
  activeIcon?: string
  inactiveIcon?: string
  label: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
  children?: ReactNode
  className?: string
  badge?: string | number
}

export const NavItem = ({
  to,
  icon,
  activeIcon,
  inactiveIcon,
  label,
  onClick,
  children,
  className,
  badge,
}: NavItemProps) => {
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
            className,
            {
              "bg-base-100": isActive,
            },
            "sidebar-nav-row"
          )
        }
      >
        {({isActive}) => (
          <>
            <Icon
              className="sidebar-nav-icon"
              name={
                (isActive ? activeIcon : inactiveIcon) ||
                (icon ? `${icon}-${isActive ? "solid" : "outline"}` : "")
              }
            />
            <span className="sidebar-nav-label">{label}</span>
            {badge && (
              <span className="badge badge-sm absolute bottom-0 xl:bottom-auto xl:top-1/2 xl:-translate-y-1/2 xl:right-2">
                {badge}
              </span>
            )}
            {children}
          </>
        )}
      </NavLink>
    </li>
  )
}
